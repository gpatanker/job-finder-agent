"use client";

import type { CandidateProfile, ResumeProfile, StoryBankEntry } from "@/lib/db/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProfileSection } from "./profile-section";
import { ResumeSection } from "./resume-section";
import { StoryBankSection } from "./story-bank-section";

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "resume", label: "Resume" },
  { value: "story-bank", label: "Story bank" },
] as const;

export function SettingsClient({
  profile,
  resume,
  stories,
}: {
  profile: CandidateProfile | null;
  resume: ResumeProfile | null;
  stories: StoryBankEntry[];
}) {
  return (
    <div className="max-w-3xl">
      <Tabs defaultValue="profile">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`settings-tab-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="profile">
          <ProfileSection profile={profile} />
        </TabsContent>
        <TabsContent value="resume">
          <ResumeSection resume={resume} />
        </TabsContent>
        <TabsContent value="story-bank">
          <StoryBankSection stories={stories} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
