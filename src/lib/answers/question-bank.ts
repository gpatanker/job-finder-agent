import Anthropic from "@anthropic-ai/sdk";
import type { QuestionBankEntry } from "@/lib/db/schema";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";

const MODEL = "claude-sonnet-5";
const TOOL_NAME = "match_question_bank";

/**
 * Checks an incoming application question against the candidate's fixed
 * question bank — pre-written, already-polished answers to recurring
 * question archetypes ("greatest achievement," "why this company," etc.),
 * each keyed by paraphrased variants. Keyword overlap (as used for the
 * story bank) is too brittle here: variants for the same underlying
 * question often share almost no vocabulary (e.g. "greatest achievement"
 * vs. "most exceptional thing you've built"), which is exactly the kind of
 * paraphrase matching an LLM handles and keyword scoring doesn't. A single
 * tool-use call both decides whether there's a real match and, if so,
 * adapts the matched answer's wording/emphasis for the specific company
 * and role — strictly bounded to facts already in that answer, never
 * inventing anything new.
 */
export async function adaptFromQuestionBank(params: {
  prompt: string;
  company: string;
  title: string;
  jobDescription?: string | null;
  entries: QuestionBankEntry[];
  jobId?: string;
}): Promise<{ answer: string; matchedEntryId: string } | null> {
  const { prompt, company, title, jobDescription, entries, jobId } = params;

  if (!process.env.ANTHROPIC_API_KEY || entries.length === 0) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const bankText = entries
      .map(
        (e, i) =>
          `[${i}] Variants: ${e.questionVariants.join(" | ")}\nAnswer: ${e.answer}`
      )
      .join("\n\n");

    const tool = {
      name: TOOL_NAME,
      description:
        "Report whether the incoming question matches a question-bank entry, and if so, the adapted answer.",
      input_schema: {
        type: "object" as const,
        properties: {
          matched: { type: "boolean" },
          entryIndex: {
            type: "integer",
            description: "Index of the matched bank entry, only when matched is true.",
          },
          adaptedAnswer: {
            type: "string",
            description: "The matched answer, adapted for this company/role. Only when matched is true.",
          },
        },
        required: ["matched"],
      },
    };

    const systemPrompt = `You match an incoming job-application question against a fixed bank of pre-written answers the candidate already uses, and adapt the matched answer for a specific company/role when there's a good match.

Rules:
- Only report matched=true if the incoming question asks for substantially the same thing as one of the bank entries — even if worded very differently — not just a loosely related topic. Be conservative: a wrong match is worse than no match.
- If matched, adapt the answer's wording, emphasis, and framing for the specific company and role, and replace any [COMPANY]/[PROBLEM]-style placeholders with real specifics grounded in the job info given. Never invent new facts, experiences, numbers, or claims beyond what's already in the matched answer.
- Keep the same overall length and style as the original answer — don't pad it out or add stacked statistics beyond what it already has.
- If nothing matches well, report matched=false and nothing else.
- Respond only via the ${TOOL_NAME} tool.`;

    const userMessage = `INCOMING QUESTION: ${prompt}

COMPANY: ${company}
ROLE: ${title}
${jobDescription ? `JOB CONTEXT: ${jobDescription}\n` : ""}
QUESTION BANK:
${bankText}`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });
    await logAnthropicUsage({ callSite: "question_bank", model: MODEL, response, jobId });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return null;
    }

    const input = toolUse.input as {
      matched?: boolean;
      entryIndex?: number;
      adaptedAnswer?: string;
    };

    if (
      !input.matched ||
      typeof input.adaptedAnswer !== "string" ||
      !input.adaptedAnswer.trim() ||
      typeof input.entryIndex !== "number" ||
      !entries[input.entryIndex]
    ) {
      return null;
    }

    return { answer: input.adaptedAnswer.trim(), matchedEntryId: entries[input.entryIndex].id };
  } catch (err) {
    console.error("Question bank matching failed, falling back:", err);
    return null;
  }
}
