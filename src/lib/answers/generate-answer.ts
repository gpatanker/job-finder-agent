import Anthropic from "@anthropic-ai/sdk";
import type { StoryBankEntry } from "@/lib/db/schema";
import { selectRelevantStories } from "./select-stories";

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
 */
export async function generateAnswer(params: {
  prompt: string;
  company: string;
  title: string;
  jobDescription?: string | null;
  stories: StoryBankEntry[];
}): Promise<{ answer: string; sourceStories: string[] }> {
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
- Concise unless the question explicitly asks for depth/detail.
- Emphasize fit for the specific role and company where the stories genuinely support it.
- Use quantified impact from the stories when present.
${isPalantir ? "" : "- Do not mention Palantir or make this Palantir-specific — this role is not at Palantir."}
- Output ONLY the answer text. No preamble, no "Here's a draft", no markdown formatting.`;

    const userMessage = `COMPANY: ${params.company}\nROLE: ${params.title}\n${params.jobDescription ? `JOB CONTEXT: ${params.jobDescription}\n` : ""}\nQUESTION: ${params.prompt}\n\nCANDIDATE'S RELEVANT STORIES:\n${storiesText}\n\nDraft the answer.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
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
