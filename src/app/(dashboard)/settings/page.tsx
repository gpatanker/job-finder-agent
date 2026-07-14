import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { candidateProfile, resumeProfile, storyBankEntries } from "@/lib/db/schema";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const [[profile], [resume], stories] = await Promise.all([
    db.select().from(candidateProfile).limit(1),
    db.select().from(resumeProfile).limit(1),
    db.select().from(storyBankEntries).orderBy(asc(storyBankEntries.title)),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <SettingsClient
        profile={profile ?? null}
        resume={resume ?? null}
        stories={stories}
      />
    </main>
  );
}
