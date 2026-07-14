import type { StoryBankEntry } from "@/lib/db/schema";
import { extractKeywords } from "@/lib/text/keywords";

/** Ranks story bank entries by keyword overlap with the prompt + job context. */
export function selectRelevantStories(
  stories: StoryBankEntry[],
  queryText: string,
  limit = 3
): StoryBankEntry[] {
  const queryKeywords = new Set(extractKeywords(queryText, 25));

  const scored = stories.map((story, index) => {
    const storyTerms = [
      ...story.tags.map((t) => t.toLowerCase()),
      ...extractKeywords(story.title + " " + story.content, 40),
    ];
    const score = storyTerms.reduce(
      (sum, term) => sum + (queryKeywords.has(term) ? 1 : 0),
      0
    );
    return { story, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.story);
}
