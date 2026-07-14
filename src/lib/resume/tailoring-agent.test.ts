import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeData } from "@/lib/db/schema";

const resume: ResumeData = {
  name: "Test",
  contactLine: "test@example.com",
  education: [],
  experience: [
    {
      company: "Acme",
      role: "Analyst",
      dateRange: "2020",
      bullets: [
        { id: "a1", text: "Did a thing.", keywords: [], synonyms: {} },
        { id: "a2", text: "Did another thing.", keywords: [], synonyms: {} },
      ],
    },
  ],
  projects: [],
  skills: [{ category: "Tools", items: ["Excel"] }],
  certifications: [],
};

function toolUseResponse(id: string) {
  return {
    content: [
      {
        type: "tool_use",
        id,
        name: "submit_tailoring_plan",
        input: {
          bulletOrder: { Acme: ["a2", "a1"] },
          skillsOrder: ["Tools"],
          rationale: "test",
        },
      },
    ],
  };
}

describe("generateTailoringPlan retry path", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("regression: the retry message includes a tool_result block matching the first response's tool_use id (API rejects a tool_use with no following tool_result — this crashed in production before the fix)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("toolu_first"))
      .mockResolvedValueOnce(toolUseResponse("toolu_second"));

    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
      },
    }));

    const { generateTailoringPlan } = await import("./tailoring-agent");

    // A job description with ~zero keyword overlap against the fixture
    // resume guarantees coverage < the retry threshold, forcing the retry
    // path to run.
    await generateTailoringPlan(resume, "completely unrelated veterinary animal grooming role");

    expect(create).toHaveBeenCalledTimes(2);

    const secondCallMessages = create.mock.calls[1][0].messages;
    const retryUserMessage = secondCallMessages[secondCallMessages.length - 1];

    expect(retryUserMessage.role).toBe("user");
    expect(Array.isArray(retryUserMessage.content)).toBe(true);
    const toolResultBlock = retryUserMessage.content[0];
    expect(toolResultBlock.type).toBe("tool_result");
    expect(toolResultBlock.tool_use_id).toBe("toolu_first");
  });
});
