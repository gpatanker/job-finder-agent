import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { companyProfiles, type CompanyProfile } from "@/lib/db/schema";
import { estimatePerplexityCostUsd, logAnthropicUsage, logLlmUsage } from "@/lib/observability/llm-usage";

/**
 * Employer research for the Resume Tailoring Agent.
 *
 * The agent otherwise sees a job description and a company name and nothing
 * else, so it can't tell that Google Cloud's AI2 team is infrastructure-adjacent
 * — which is the single fact that decides whether this candidate should lead
 * with GPU-capacity work or with generic BizOps process work.
 *
 * Cached per company, not per job. This pipeline sees the same ~200 employers
 * over and over (Anduril alone appears 25+ times), so researching per job would
 * buy the same answer dozens of times. A profile is refreshed only when it ages
 * out — companies don't change what they do very often, and a stale-but-roughly
 * -right profile is far better than an extra API call per resume.
 *
 * Fails soft everywhere: no key, no network, bad JSON, or a thin result all
 * return null, and the caller simply tailors without company context exactly as
 * it did before. Company research is an enhancement, never a dependency.
 */

const PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search";
const MODEL = "claude-sonnet-5";
const MAX_RESULTS = 8;
const MAX_TOKENS_PER_PAGE = 512;

/** Profiles older than this are re-researched on next use. */
const STALE_AFTER_DAYS = 120;

export function companyKeyFor(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type PerplexityResult = { title: string; url: string; snippet: string };

async function searchCompany(company: string): Promise<{ text: string; urls: string[]; cost: number }> {
  const queries = [
    `What does ${company} do? products, customers, business model`,
    `${company} engineering and infrastructure — technology stack, scale, what the company is known for`,
  ];

  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const res = await fetch(PERPLEXITY_SEARCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, max_results: MAX_RESULTS, max_tokens_per_page: MAX_TOKENS_PER_PAGE }),
      });
      if (!res.ok) throw new Error(`Perplexity ${res.status}`);
      const body = await res.json();
      return (Array.isArray(body.results) ? body.results : []) as PerplexityResult[];
    })
  );

  const results = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const text = results
    .map((r) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`)
    .join("\n");
  const urls = [...new Set(results.map((r) => r.url))];
  return { text, urls, cost: estimatePerplexityCostUsd(queries.length) };
}

const TOOL = {
  name: "submit_company_profile",
  description: "Summarize what this employer does and what it appears to value in an operations hire.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "2-4 sentences: what the company builds, who its customers are, and how it makes money. Concrete and factual. If the search results are too thin to say anything specific, return an empty string rather than guessing.",
      },
      domains: {
        type: "array",
        items: { type: "string" },
        description: 'Up to 5 short domain tags, e.g. "AI infrastructure", "cloud computing", "fintech", "defense".',
      },
      valuedSignals: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 5 short phrases describing what this employer would most value in a business/strategy operations hire, inferred from what the company actually does — e.g. \"GPU capacity planning\", \"vendor negotiation at scale\", \"regulated-industry process rigor\". These steer resume emphasis, so keep them specific to this company rather than generic.",
      },
    },
    required: ["summary", "domains", "valuedSignals"],
  },
};

async function summarize(
  company: string,
  research: string
): Promise<{ summary: string; domains: string[]; valuedSignals: string[] } | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system:
      "You summarize employers for a resume-tailoring system. Base everything on the supplied search results. Never invent facts about a company; if the results are too thin, say so by returning an empty summary. Respond only via the submit_company_profile tool.",
    messages: [{ role: "user", content: `COMPANY: ${company}\n\nSEARCH RESULTS:\n${research}` }],
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
  });
  await logAnthropicUsage({ callSite: "company_research", model: MODEL, response });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (toolUse?.type !== "tool_use") return null;
  const input = toolUse.input as Record<string, unknown>;
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) return null;
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  return { summary, domains: arr(input.domains), valuedSignals: arr(input.valuedSignals) };
}

function isStale(profile: CompanyProfile): boolean {
  const age = Date.now() - new Date(profile.researchedAt).getTime();
  return age > STALE_AFTER_DAYS * 86_400_000;
}

/**
 * Returns a cached profile, researching once if absent or stale.
 * Returns null — never throws — when research isn't possible or isn't useful.
 */
export async function getCompanyContext(company: string): Promise<CompanyProfile | null> {
  const key = companyKeyFor(company);
  if (!key) return null;

  // Imported lazily rather than at module scope so that merely importing this
  // module doesn't open a DB connection — the same convention llm-usage.ts uses,
  // and what lets the pure helpers here be unit-tested without DATABASE_URL.
  const { db } = await import("@/lib/db/client");

  const [existing] = await db.select().from(companyProfiles).where(eq(companyProfiles.companyKey, key));
  if (existing && !isStale(existing)) return existing;

  if (!process.env.PERPLEXITY_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    return existing ?? null; // stale beats nothing
  }

  try {
    const { text, urls, cost } = await searchCompany(company);
    await logLlmUsage({
      callSite: "company_research",
      provider: "perplexity",
      model: "sonar",
      requestCount: 2,
      estimatedCostUsd: cost,
    });
    if (!text.trim()) return existing ?? null;

    const profile = await summarize(company, text);
    if (!profile) return existing ?? null;

    const values = {
      companyKey: key,
      companyName: company,
      summary: profile.summary,
      domains: profile.domains,
      valuedSignals: profile.valuedSignals,
      sourceUrls: urls.slice(0, 10),
      estimatedCostUsd: cost,
      researchedAt: new Date(),
      updatedAt: new Date(),
    };

    const [saved] = await db
      .insert(companyProfiles)
      .values(values)
      .onConflictDoUpdate({ target: companyProfiles.companyKey, set: values })
      .returning();
    return saved ?? existing ?? null;
  } catch {
    // Research is an enhancement — never let it break resume generation.
    return existing ?? null;
  }
}

/** Renders a profile into the block handed to the tailoring prompt. */
export function formatCompanyContext(profile: CompanyProfile | null): string {
  if (!profile) return "";
  const lines = [`ABOUT ${profile.companyName.toUpperCase()}:`, profile.summary];
  if (profile.domains.length) lines.push(`Domains: ${profile.domains.join(", ")}`);
  if (profile.valuedSignals.length) {
    lines.push(
      `Likely valued in an operations hire here: ${profile.valuedSignals.join("; ")}.`,
      "Where the candidate's existing bullets genuinely demonstrate one of these, order and word them so that lands first. Do not claim anything the bullets don't already support."
    );
  }
  return lines.join("\n");
}
