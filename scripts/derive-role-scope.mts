/**
 * Turns the candidate's own description of what they want into the role scope
 * the title filter uses, then shows it for review before anything is saved.
 *
 * Run:  npm run db:derive-role-scope            (reads the profile in the DB)
 *       npm run db:derive-role-scope -- --write  (also saves it to the profile)
 *       npm run db:derive-role-scope -- --statement "backend SWE, senior IC, no management"
 *
 * Why a one-off setup script rather than something search calls every run:
 * search stays deterministic and free, the generated word lists are visible in
 * the profile where a human can read and hand-tune them, and a bad generation
 * shows up once at setup instead of being silently re-rolled on every search.
 * Re-run it when what you're looking for changes.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, type SearchCriteria } from "@/lib/db/schema";
import { deriveRoleScope } from "@/lib/search/role-scope-agent";
import { classifyRoleFamily } from "@/lib/search/known-company-boards";
import { isOverSeniorTitle, isUnderLeveledTitle } from "@/lib/search/job-search-agent";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const WRITE = process.argv.includes("--write");
/**
 * Lets a caller supply the target titles inline instead of reading the stored
 * ones. Needed because the two inputs must describe the SAME job: passing a
 * statement that contradicts the profile's roleFamilies produces a scope that
 * correctly rejects those families, and the self-check then refuses it — which
 * is right, but baffling unless you know that's what happened.
 */
const ROLE_FAMILIES_ARG = arg("role-families");

const [profile] = await db.select().from(candidateProfile).limit(1);
if (!profile) {
  console.error("No candidate profile seeded yet. Run `npm run db:seed-profile` first.");
  process.exit(1);
}

const criteria: SearchCriteria | null = profile.searchCriteria ?? null;
const statement = arg("statement") ?? criteria?.targetStatement ?? "";
const roleFamilies = ROLE_FAMILIES_ARG
  ? ROLE_FAMILIES_ARG.split(",").map((r) => r.trim()).filter(Boolean)
  : (criteria?.roleFamilies ?? []);

console.log("Deriving a role scope from:");
console.log(`  roleFamilies:    ${roleFamilies.length ? roleFamilies.join(", ") : "(none)"}`);
console.log(`  functionTags:    ${profile.functionTags?.join(", ") || "(none)"}`);
console.log(`  targetStatement: ${statement || "(none)"}`);
if (!statement && roleFamilies.length === 0) {
  console.error(
    "\nNothing to derive from. Set searchCriteria.roleFamilies and/or searchCriteria.targetStatement\n" +
      "in local/profile.seed.json and re-seed, or pass --statement \"...\" directly."
  );
  process.exit(1);
}
console.log("\nCalling Claude…\n");

const result = await deriveRoleScope({
  roleFamilies,
  targetStatement: statement,
  functionTags: profile.functionTags ?? [],
});

if (!result.ok) {
  console.error(`Could not derive a usable scope: ${result.error}`);
  if (/rejects EVERY role family/.test(result.error) && !ROLE_FAMILIES_ARG) {
    // The usual cause is not vagueness but disagreement: the statement describes
    // one job and the stored roleFamilies describe another, so any scope faithful
    // to the statement rejects the families — and the self-check refuses it.
    console.error(
      "\nThe two inputs disagree. Your profile's roleFamilies are:\n" +
        `  ${roleFamilies.join(", ")}\n` +
        "but the statement describes a different job family. They have to describe the SAME\n" +
        "role, because the generated scope is checked against those titles.\n\n" +
        "Either update searchCriteria.roleFamilies in local/profile.seed.json and re-seed, or\n" +
        "pass both inline:\n" +
        '  npm run db:derive-role-scope -- --role-families "Senior Software Engineer,Backend Engineer" \\\n' +
        '    --statement "backend SWE, senior IC, no management"'
    );
  } else {
    console.error(
      "\nNothing was saved. Most often this means the description was too vague to pin down a\n" +
        "job family — try naming concrete job titles you'd apply to, your level, and what you\n" +
        "explicitly don't want."
    );
  }
  process.exit(1);
}

const { scope, warnings } = result;
console.log(JSON.stringify(scope, null, 2));

if (warnings.length > 0) {
  console.log("\nWarnings — worth reading before you accept this:");
  for (const w of warnings) console.log(`  ! ${w}`);
}

// Show it working, since the word lists on their own are hard to judge. Mixing
// the candidate's stated targets with deliberate near-misses is the quickest
// way to see whether the gate is actually shaped right.
const probes = [
  ...roleFamilies.slice(0, 6),
  "Director of Engineering",
  "Recruiting Coordinator",
  "Marketing Manager",
  "Intern, Operations",
];
console.log("\nHow this scope classifies titles (your stated targets first):\n");
for (const t of probes) {
  if (!t?.trim()) continue;
  const tier = classifyRoleFamily(t, scope);
  const over = isOverSeniorTitle(t, scope);
  const under = isUnderLeveledTitle(t, scope);
  const verdict = over ? "REJECTED (too senior)" : under ? "REJECTED (too junior)" : tier === null ? "REJECTED (not your function)" : `accepted — ${tier}`;
  console.log(`  ${t.padEnd(42)} ${verdict}`);
}

if (!WRITE) {
  console.log(
    "\nNot saved. Review the lists above, then re-run with --write to save to your profile:\n" +
      "  npm run db:derive-role-scope -- --write\n" +
      "You can also paste the JSON into searchCriteria.roleScope in local/profile.seed.json\n" +
      "and hand-edit it — that is the expected workflow if anything above looks wrong."
  );
  process.exit(0);
}

const nextCriteria: SearchCriteria = {
  roleFamilies,
  locations: criteria?.locations ?? [],
  industries: criteria?.industries ?? [],
  ...(criteria?.salaryFloor !== undefined ? { salaryFloor: criteria.salaryFloor } : {}),
  ...(statement ? { targetStatement: statement } : {}),
  roleScope: scope,
};
await db
  .update(candidateProfile)
  .set({ searchCriteria: nextCriteria, updatedAt: new Date() })
  .where(eq(candidateProfile.id, profile.id));
console.log("\nSaved to searchCriteria.roleScope. Search will use it on the next run.");
console.log(
  "Copy it into local/profile.seed.json too, or re-seeding will overwrite it."
);
process.exit(0);
