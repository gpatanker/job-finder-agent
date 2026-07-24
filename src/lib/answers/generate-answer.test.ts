import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionBankEntry, StoryBankEntry } from "@/lib/db/schema";

const stories: StoryBankEntry[] = [
  {
    id: "story-1",
    slug: "background",
    title: "Background",
    tags: ["background"],
    content: "I've worked in business operations across a few enterprise software and infrastructure companies.",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const questionBank: QuestionBankEntry[] = [
  {
    id: "qb-1",
    questionVariants: ["What is your greatest achievement?"],
    answer: "I built a reporting pipeline from scratch at Example Corp that cut manual validation work by 80%.",
    hitCount: 0,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("generateAnswer", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it(
    "regression: checks the question bank first and uses its adapted answer directly, " +
      "without falling through to story-bank synthesis, when there's a match",
    async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const create = vi.fn().mockResolvedValue({
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "match_question_bank",
            input: { matched: true, entryIndex: 0, adaptedAnswer: "Adapted answer from the bank." },
          },
        ],
      });
      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = { create };
        },
      }));

      const { generateAnswer } = await import("./generate-answer");
      const result = await generateAnswer({
        prompt: "What is your greatest achievement?",
        company: "Acme",
        title: "Analyst",
        stories,
        questionBank,
      });

      expect(result.answer).toBe("Adapted answer from the bank.");
      expect(result.matchedQuestionBank).toBe(true);
      expect(result.matchedEntryId).toBe("qb-1");
      expect(result.sourceStories).toEqual([]);
      // Only the question-bank matcher's API call should have happened —
      // story-bank synthesis should never fire once the bank matches.
      expect(create).toHaveBeenCalledTimes(1);
    }
  );

  it("falls back to story-bank synthesis when the question bank has no match", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "match_question_bank",
            input: { matched: false },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Synthesized from the story bank." }],
      });
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { generateAnswer } = await import("./generate-answer");
    const result = await generateAnswer({
      prompt: "Tell us about your background.",
      company: "Acme",
      title: "Analyst",
      stories,
      questionBank,
    });

    expect(result.answer).toBe("Synthesized from the story bank.");
    expect(result.matchedQuestionBank).toBeUndefined();
    expect(result.sourceStories).toEqual(["background"]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("skips the question-bank step entirely when none is provided, behaving as before", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Synthesized from the story bank." }],
    });
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { generateAnswer } = await import("./generate-answer");
    const result = await generateAnswer({
      prompt: "Tell us about your background.",
      company: "Acme",
      title: "Analyst",
      stories,
    });

    expect(result.answer).toBe("Synthesized from the story bank.");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
