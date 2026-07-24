import Anthropic from "@anthropic-ai/sdk";
import type { QuestionBankEntry, StoryBankEntry } from "@/lib/db/schema";
import { selectRelevantStories } from "./select-stories";
import { adaptFromQuestionBank } from "./question-bank";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";

const MODEL = "claude-sonnet-5";

function deterministicAnswer(stories: StoryBankEntry[]): string {
  if (stories.length === 0) {
    return "";
  }
  return stories[0].content;
}

/**
 * Answer Generation: a single grounded completion, not an agent loop.
 * Retrieval (selectRelevantStories) is deterministic; only the phrasing is
 * generated, and only from the retrieved stories — the prompt instructs
 * Claude never to add experience beyond what's given, and the deterministic
 * fallback (used if the API is unavailable) simply returns the most
 * relevant story verbatim rather than guessing.
 *
 * Checks the question bank first (pre-written answers to recurring
 * archetypes, adapted rather than synthesized from scratch — see
 * question-bank.ts) and only falls back to story-bank synthesis if nothing
 * in the bank matches closely enough.
 */
export async function generateAnswer(params: {
  prompt: string;
  company: string;
  title: string;
  jobDescription?: string | null;
  stories: StoryBankEntry[];
  questionBank?: QuestionBankEntry[];
  jobId?: string;
}): Promise<{
  answer: string;
  sourceStories: string[];
  matchedQuestionBank?: boolean;
  matchedEntryId?: string;
}> {
  if (params.questionBank && params.questionBank.length > 0) {
    const adapted = await adaptFromQuestionBank({
      prompt: params.prompt,
      company: params.company,
      title: params.title,
      jobDescription: params.jobDescription,
      entries: params.questionBank,
      jobId: params.jobId,
    });
    if (adapted) {
      return {
        answer: adapted.answer,
        sourceStories: [],
        matchedQuestionBank: true,
        matchedEntryId: adapted.matchedEntryId,
      };
    }
  }

  const queryText = [params.prompt, params.company, params.title, params.jobDescription]
    .filter(Boolean)
    .join(" ");
  const relevant = selectRelevantStories(params.stories, queryText, 3);

  if (relevant.length === 0) {
    return { answer: "", sourceStories: [] };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { answer: deterministicAnswer(relevant), sourceStories: relevant.map((s) => s.slug) };
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const storiesText = relevant
      .map((s) => `### ${s.title}\n${s.content}`)
      .join("\n\n");

    const isPalantir = /palantir/i.test(params.company);

    const systemPrompt = `You draft first-person answers to job application questions, grounded strictly in the candidate's provided story bank. Rules:
- Use ONLY facts, numbers, and experiences present in the provided stories below. Never invent experience, employers, numbers, or outcomes.
- First person, natural and human — not generic corporate language.
- Default to 2 short paragraphs or fewer, even for "why this company" style questions — err on the side of shorter unless the question explicitly asks for depth/detail.
- Emphasize fit for the specific role and company where the stories genuinely support it.
- Don't stack numbers — at most one concrete metric only if it's genuinely load-bearing for the point being made. Prioritize narrative fit over a list of quantified stats.
${isPalantir ? "" : "- Do not mention Palantir or make this Palantir-specific — this role is not at Palantir."}
- Output ONLY the answer text. No preamble, no "Here's a draft", no markdown formatting.`;

    const userMessage = `COMPANY: ${params.company}\nROLE: ${params.title}\n${params.jobDescription ? `JOB CONTEXT: ${params.jobDescription}\n` : ""}\nQUESTION: ${params.prompt}\n\nCANDIDATE'S RELEVANT STORIES:\n${storiesText}\n\nDraft the answer.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    await logAnthropicUsage({
      callSite: "generate_answer",
      model: MODEL,
      response,
      jobId: params.jobId,
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const answer = textBlock?.type === "text" ? textBlock.text.trim() : "";

    if (!answer) {
      return { answer: deterministicAnswer(relevant), sourceStories: relevant.map((s) => s.slug) };
    }

    return { answer, sourceStories: relevant.map((s) => s.slug) };
  } catch (err) {
    console.error("Answer generation failed, falling back:", err);
    return { answer: deterministicAnswer(relevant), sourceStories: relevant.map((s) => s.slug) };
  }
}
