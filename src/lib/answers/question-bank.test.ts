import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionBankEntry } from "@/lib/db/schema";

const entries: QuestionBankEntry[] = [
  {
    id: "qb-1",
    questionVariants: ["What is your greatest achievement?", "What are you most proud of?"],
    answer: "I built a reporting pipeline from scratch at Example Corp that cut manual validation work by 80%.",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function toolResponse(input: Record<string, unknown>) {
  return {
    content: [
      { type: "tool_use", id: "toolu_1", name: "match_question_bank", input },
    ],
  };
}

describe("adaptFromQuestionBank", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns null immediately when there's no API key, without calling the API", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { adaptFromQuestionBank } = await import("./question-bank");
    const result = await adaptFromQuestionBank({
      prompt: "What are you most proud of?",
      company: "Acme",
      title: "Analyst",
      entries,
    });
    expect(result).toBeNull();
  });

  it("returns null when there are no entries to match against", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { adaptFromQuestionBank } = await import("./question-bank");
    const result = await adaptFromQuestionBank({
      prompt: "What are you most proud of?",
      company: "Acme",
      title: "Analyst",
      entries: [],
    });
    expect(result).toBeNull();
  });

  it("returns the adapted answer when the tool reports a match", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const create = vi.fn().mockResolvedValue(
      toolResponse({
        matched: true,
        entryIndex: 0,
        adaptedAnswer: "At Acme, I'd bring the same instinct that led me to build that reporting pipeline at Example Corp.",
      })
    );
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { adaptFromQuestionBank } = await import("./question-bank");
    const result = await adaptFromQuestionBank({
      prompt: "What's the proudest thing you've accomplished?",
      company: "Acme",
      title: "Analyst",
      entries,
    });

    expect(result).toBe("At Acme, I'd bring the same instinct that led me to build that reporting pipeline at Example Corp.");
  });

  it("returns null when the tool reports no match, so the caller falls back to story-bank synthesis", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const create = vi.fn().mockResolvedValue(toolResponse({ matched: false }));
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { adaptFromQuestionBank } = await import("./question-bank");
    const result = await adaptFromQuestionBank({
      prompt: "Describe your ideal vacation.",
      company: "Acme",
      title: "Analyst",
      entries,
    });

    expect(result).toBeNull();
  });

  it("falls back to null (rather than throwing) if the API call fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const create = vi.fn().mockRejectedValue(new Error("API down"));
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { adaptFromQuestionBank } = await import("./question-bank");
    const result = await adaptFromQuestionBank({
      prompt: "What are you most proud of?",
      company: "Acme",
      title: "Analyst",
      entries,
    });

    expect(result).toBeNull();
  });
});
