import { describe, expect, it } from "vitest";
import { selectRelevantStories } from "./select-stories";
import type { StoryBankEntry } from "@/lib/db/schema";

function makeStory(overrides: Partial<StoryBankEntry>): StoryBankEntry {
  return {
    id: overrides.slug ?? "story",
    slug: "story",
    title: "A story",
    tags: [],
    content: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const stories: StoryBankEntry[] = [
  makeStory({
    slug: "fraud-risk",
    title: "Fraud and risk management",
    tags: ["fraud-prevention", "risk-management"],
    content: "Reduced bad debt from 4.8% to 1.5% using a fraud detection framework.",
  }),
  makeStory({
    slug: "gpu-dashboard",
    title: "GPU capacity dashboard",
    tags: ["gpu-infrastructure", "python", "tableau"],
    content: "Built a Python and Tableau dashboard to track GPU capacity for sales teams.",
  }),
  makeStory({
    slug: "cricket",
    title: "Cricket in India",
    tags: ["resilience", "personal-story"],
    content: "Moved to India to play cricket and faced injuries and setbacks.",
  }),
];

describe("selectRelevantStories", () => {
  it("ranks the most keyword-relevant story first", () => {
    const result = selectRelevantStories(stories, "Tell me about a GPU infrastructure project with Python and Tableau", 3);
    expect(result[0].slug).toBe("gpu-dashboard");
  });

  it("respects the limit", () => {
    const result = selectRelevantStories(stories, "fraud risk GPU python", 1);
    expect(result).toHaveLength(1);
  });

  it("does not surface an unrelated story ahead of relevant ones", () => {
    const result = selectRelevantStories(stories, "fraud risk management bad debt", 3);
    expect(result[0].slug).toBe("fraud-risk");
    expect(result.map((s) => s.slug)).not.toEqual(["cricket", "fraud-risk", "gpu-dashboard"]);
  });
});
