import Anthropic from "@anthropic-ai/sdk";
import type { ResumeData } from "@/lib/db/schema";
import { deterministicTailoringPlan } from "./deterministic-tailoring";
import { missingKeywords, scoreCoverage } from "./keyword-coverage";
import { applyTailoring } from "./apply-tailoring";
import { emptyTailoringPlan, type TailoringPlan } from "./types";
import { logAnthropicUsage } from "@/lib/observability/llm-usage";

const MODEL = "claude-sonnet-5";
const COVERAGE_RETRY_THRESHOLD = 55;

const TOOL_NAME = "submit_tailoring_plan";

function buildTool(resume: ResumeData) {
  const bulletOrderProps: Record<string, unknown> = {};
  for (const exp of resume.experience) {
    bulletOrderProps[exp.company] = {
      type: "array",
      items: { type: "string", enum: exp.bullets.map((b) => b.id) },
      description: `Ordering of ${exp.company}'s bullet IDs, most relevant to this job first. Must include every ID exactly once.`,
    };
  }

  return {
    name: TOOL_NAME,
    description:
      "Submit the resume tailoring plan: bullet ordering per company, optional pre-approved phrasing swaps, and skill category ordering.",
    input_schema: {
      type: "object" as const,
      properties: {
        bulletOrder: {
          type: "object",
          properties: bulletOrderProps,
          required: resume.experience.map((e) => e.company),
        },
        phraseChoices: {
          type: "object",
          description:
            'Optional. Map of bulletId -> { originalPhrase: chosenText }. chosenText MUST be exactly one of the pre-approved synonym options given for that bullet/phrase — never invent new wording. Do not use this for a bullet you are rewording via bulletRewrites.',
        },
        bulletRewrites: {
          type: "object",
          description:
            "Optional. Map of bulletId -> reworded bullet text, rephrased to use the job posting's own vocabulary so it scores better in ATS keyword matching and reads better to a human reviewer. HARD RULES, enforced in code after you respond — a rewrite that breaks any of them is discarded: (1) Copy every number EXACTLY as written in the original, character for character. \"$3M\" must stay \"$3M\" — not \"$3 million\", not \"$3,000,000\". (2) Never add a number that is not already in that bullet. (3) Keep every proper noun and acronym from the original (NVIDIA, Netbox, JIRA, Tableau, Python, CSP, SLA, POS, Public Sector Partners...) and never introduce a company, tool, system or certification the original does not name. (4) Do not change what was accomplished, the scope, or the candidate's role in it — only the wording. (5) The rewrite must be NO LONGER than the original, measured in characters — the resume is one page and already full, so a longer rewrite is thrown away by the layout step. Substitute wording rather than adding it. USE THIS ACTIVELY. Work through every bullet and reword the ones where the posting has its own term for something the bullet already describes — that keyword match is what the ATS scores. Expect to reword roughly half the bullets on a well-matched posting. Only skip a bullet when the posting genuinely has no language for what it describes. Rewording is safe: the constraints above are verified in code after you respond, so attempt the rewrite rather than leaving a keyword on the table.",
        },
        skillsOrder: {
          type: "array",
          items: {
            type: "string",
            enum: resume.skills.map((s) => s.category),
          },
          description: "Skill categories in display order, most relevant first. Must include every category exactly once.",
        },
        rationale: {
          type: "string",
          description: "1-2 sentence explanation of the tailoring choices, for display to the candidate.",
        },
      },
      required: ["bulletOrder", "skillsOrder"],
    },
  };
}

function buildInventoryDescription(resume: ResumeData): string {
  const lines: string[] = [];
  for (const exp of resume.experience) {
    lines.push(`\n## ${exp.company} — ${exp.role}`);
    for (const bullet of exp.bullets) {
      const synonymLines = Object.entries(bullet.synonyms)
        .map(([phrase, options]) => `    - "${phrase}" can become: ${options.map((o) => `"${o}"`).join(" / ")}`)
        .join("\n");
      lines.push(
        `- [${bullet.id}] ${bullet.text}\n  keywords: ${bullet.keywords.join(", ")}${synonymLines ? "\n" + synonymLines : ""}`
      );
    }
  }
  lines.push("\n## Skill categories");
  for (const skill of resume.skills) {
    lines.push(`- ${skill.category}: ${skill.items.join(", ")}`);
  }
  return lines.join("\n");
}

function validatePlan(raw: unknown, resume: ResumeData): TailoringPlan {
  const plan = emptyTailoringPlan();
  if (!raw || typeof raw !== "object") return plan;
  const input = raw as Record<string, unknown>;

  const bulletOrderInput = input.bulletOrder as Record<string, unknown> | undefined;
  if (bulletOrderInput) {
    for (const exp of resume.experience) {
      const requested = bulletOrderInput[exp.company];
      if (Array.isArray(requested)) {
        const validIds = new Set(exp.bullets.map((b) => b.id));
        plan.bulletOrder[exp.company] = requested.filter(
          (id): id is string => typeof id === "string" && validIds.has(id)
        );
      }
    }
  }

  const phraseChoicesInput = input.phraseChoices as
    | Record<string, Record<string, string>>
    | undefined;
  if (phraseChoicesInput && typeof phraseChoicesInput === "object") {
    for (const [bulletId, choices] of Object.entries(phraseChoicesInput)) {
      if (choices && typeof choices === "object") {
        plan.phraseChoices[bulletId] = choices;
      }
    }
  }

  const rewritesInput = input.bulletRewrites as Record<string, unknown> | undefined;
  if (rewritesInput && typeof rewritesInput === "object") {
    const validIds = new Set(resume.experience.flatMap((e) => e.bullets.map((b) => b.id)));
    plan.bulletRewrites = {};
    for (const [bulletId, text] of Object.entries(rewritesInput)) {
      if (validIds.has(bulletId) && typeof text === "string" && text.trim()) {
        // Only shape is checked here; the factual guarantees are enforced by
        // validateRewrite() inside applyTailoring, which is the real boundary.
        plan.bulletRewrites[bulletId] = text.trim();
      }
    }
  }

  const skillsOrderInput = input.skillsOrder;
  if (Array.isArray(skillsOrderInput)) {
    const validCategories = new Set(resume.skills.map((s) => s.category));
    plan.skillsOrder = skillsOrderInput.filter(
      (c): c is string => typeof c === "string" && validCategories.has(c)
    );
  }

  if (typeof input.rationale === "string") {
    plan.rationale = input.rationale;
  }

  return plan;
}

/**
 * Resume Tailoring Agent: given a job description, decides bullet order,
 * phrasing swaps, bullet rewording, and skill emphasis. Bounded — Claude may
 * reword a bullet into the posting's vocabulary, but every rewrite is re-checked
 * by validateRewrite() inside applyTailoring and discarded unless it preserves
 * the original's numbers verbatim and its named entities, so no rewrite can
 * introduce a fabricated metric, tool or claim. Bullet IDs and skill categories
 * are still validated against the fixed inventory. Runs a keyword-coverage
 * self-check and retries once if coverage is weak, then falls back to
 * deterministic keyword-overlap ordering if the API is unavailable or the
 * plan doesn't validate to anything useful.
 */
export async function generateTailoringPlan(
  resume: ResumeData,
  jobDescription: string,
  jobId?: string
): Promise<TailoringPlan> {
  if (!jobDescription.trim()) {
    return emptyTailoringPlan();
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return deterministicTailoringPlan(resume, jobDescription);
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tool = buildTool(resume);
    const inventory = buildInventoryDescription(resume);

    const systemPrompt =
      "You are a resume-tailoring assistant. Your job is to make this resume score well in an ATS keyword scan AND read well to a human reviewer, by aligning it with the job posting's own language.\n\n" +
      "You have three tools for that: reorder bullets so the most relevant come first, swap in phrasing from the pre-approved synonym lists, and reword bullet text via bulletRewrites to match the posting's vocabulary.\n\n" +
      "Rewording is the main lever for ATS keyword matching, so use it on every bullet where the posting has its own term for work the bullet already describes. Mirror the posting's nouns and verbs.\n\n" +
      "THE RESUME MUST FIT ON ONE PAGE, and it is already full. Every rewrite MUST be the same length as the original or SHORTER — count the characters. A rewrite that runs longer is discarded by the layout step, so a longer rewrite is simply a wasted one. Swap words rather than adding them: replace a weaker verb or phrase with the posting's term, don't append the posting's term to what is already there.\n\n" +
      "A HUMAN READS THIS TOO. A reworded bullet must read as natural professional English, not as keyword insertion. Never bolt a posting term onto a sentence where it doesn't belong grammatically, and never repeat the same inserted phrase across multiple bullets — two bullets in a row ending up with \"at scale\" tacked on is exactly the tell a recruiter notices. If a term can only be added awkwardly, leave that bullet alone: a clean un-reworded bullet beats a stuffed one.\n\n" +
      "REWORDING IS REPHRASING, NOT REWRITING THE FACTS. Every number must be copied exactly as written, character for character. Never add a number. Never add a company, tool, system, metric or credential the bullet does not already name, and never drop one. Never change what was achieved, how big it was, or what the candidate's role in it was. If the posting's language genuinely doesn't fit a bullet, leave that bullet alone — an un-reworded bullet is always better than an inaccurate one.\n\n" +
      "You must NEVER invent new bullets or new skills. Every bullet ID for a company must appear exactly once in that company's order. Every skill category must appear exactly once in skillsOrder. Respond only via the submit_tailoring_plan tool.";

    // Hand the model the exact keyword gap rather than making it infer one.
    const gaps = missingKeywords(resume, jobDescription).slice(0, 25);
    const gapLine = gaps.length
      ? `\n\nJOB-POSTING TERMS NOT CURRENTLY IN THE RESUME: ${gaps.join(", ")}\nWhere one of these genuinely describes work a bullet already covers, use that exact term when rewording it — and make it read naturally in the sentence. Ignore any that do not honestly apply; most of this list will not apply, and forcing them in reads as keyword stuffing to a human reviewer. Never reuse the same inserted phrase in more than one bullet.`
      : "";

    const userMessage = `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME BULLET INVENTORY (the facts are fixed; the wording may be aligned to the posting):\n${inventory}${gapLine}\n\nProduce the tailoring plan that best aligns this resume with the job description. Use bulletRewrites on every bullet where the posting has its own wording for work the bullet already describes — that keyword overlap is what the ATS scores, and it is also what makes the resume read as written for this role. Keep all numbers and named entities exactly as they appear.`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages,
      tools: [tool],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });
    await logAnthropicUsage({ callSite: "tailoring", model: MODEL, response, jobId });

    let toolUse = response.content.find((c) => c.type === "tool_use");
    let plan = validatePlan(toolUse?.type === "tool_use" ? toolUse.input : null, resume);
    const tailored = applyTailoring(resume, plan);
    let coverage = scoreCoverage(tailored, jobDescription);

    if (coverage < COVERAGE_RETRY_THRESHOLD && toolUse?.type === "tool_use") {
      const gaps = missingKeywords(tailored, jobDescription);
      // A forced tool_use response MUST be followed by a tool_result block
      // referencing its id — the API rejects the request otherwise (400
      // invalid_request_error). The feedback for the retry goes *in* that
      // tool_result rather than as a separate plain-text message.
      messages.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Coverage is weak (${coverage}/100). These job-description keywords aren't reflected yet: ${gaps.slice(0, 15).join(", ")}. If any existing bullet/skill legitimately covers one of these (via its keywords or an approved synonym), revise the plan to surface it. Still choose only from the same fixed inventory — never invent new text. Submit a revised plan.`,
            },
          ],
        }
      );

      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
      });
      await logAnthropicUsage({ callSite: "tailoring", model: MODEL, response, jobId });

      toolUse = response.content.find((c) => c.type === "tool_use");
      const retryPlan = validatePlan(
        toolUse?.type === "tool_use" ? toolUse.input : null,
        resume
      );
      const retryTailored = applyTailoring(resume, retryPlan);
      const retryCoverage = scoreCoverage(retryTailored, jobDescription);

      if (retryCoverage > coverage) {
        plan = retryPlan;
        coverage = retryCoverage;
      }
    }

    plan.coverageScore = coverage;
    return plan;
  } catch (err) {
    console.error("Resume Tailoring Agent failed, falling back:", err);
    const fallback = deterministicTailoringPlan(resume, jobDescription);
    fallback.coverageScore = scoreCoverage(
      applyTailoring(resume, fallback),
      jobDescription
    );
    return fallback;
  }
}
