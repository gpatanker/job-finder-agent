"use client";

import { useState } from "react";
import type { CandidateProfile, ResumeProfile, StoryBankEntry } from "@/lib/db/schema";
import { ProfileSection } from "./profile-section";
import { ResumeSection } from "./resume-section";
import { StoryBankSection } from "./story-bank-section";

const TABS = ["Profile", "Resume", "Story bank"] as const;
type Tab = (typeof TABS)[number];

export function SettingsClient({
  profile,
  resume,
  stories,
}: {
  profile: CandidateProfile | null;
  resume: ResumeProfile | null;
  stories: StoryBankEntry[];
}) {
  const [tab, setTab] = useState<Tab>("Profile");

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-2 border-b border-black/10 dark:border-white/15">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${
              tab === t
                ? "border-b-2 border-black font-medium dark:border-white"
                : "text-black/60 dark:text-white/60"
            }`}
            data-testid={`settings-tab-${t.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Profile" && <ProfileSection profile={profile} />}
      {tab === "Resume" && <ResumeSection resume={resume} />}
      {tab === "Story bank" && <StoryBankSection stories={stories} />}
    </div>
  );
}
