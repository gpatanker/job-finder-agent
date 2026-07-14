import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5";
const TOOL_NAME = "submit_direct_url";

const submitTool = {
  name: TOOL_NAME,
  description: "Report whether a direct source URL for the role was found.",
  input_schema: {
    type: "object" as const,
    properties: {
      found: { type: "boolean" },
      applyUrl: {
        type: "string",
        description: "The direct, specific posting URL — only set when found is true.",
      },
    },
    required: ["found"],
  },
};

/**
 * Recovery step: when a candidate's original applyUrl fails our checks
 * (paywalled source, generic careers page, closed/stale), give the agent
 * one more targeted search for the SAME role directly on the company's own
 * careers page or ATS, rather than just dropping a possibly-good match.
 * Returns null if no direct, specific posting can be found — the caller
 * still re-validates whatever comes back through the same checks, so this
 * can't itself introduce a bad link.
 */
export async function findDirectSourceUrl(params: {
  company: string;
  title: string;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `A previous search found a candidate job role, but the link for it was unusable (paywalled, a generic careers page instead of the specific posting, or stale/closed). Use web_search to find the SAME role directly from the company's own careers page or their ATS (Greenhouse, Ashby, Lever, or similar) — it must be a deep link with a job ID or role-specific slug, not a generic landing page, and not a third-party aggregator. If you find a direct match for this exact role, call ${TOOL_NAME} with found=true and the URL. If you search and cannot find a direct, specific posting for this exact role, call ${TOOL_NAME} with found=false — do not guess or substitute a different role.`;

    const userMessage = `Company: ${params.company}\nRole title: ${params.title}\n\nFind the direct source posting for this specific role.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }, submitTool],
    });

    const toolUse = response.content.find(
      (c) => c.type === "tool_use" && c.name === TOOL_NAME
    );
    if (!toolUse || toolUse.type !== "tool_use") return null;

    const input = toolUse.input as { found?: boolean; applyUrl?: string };
    if (!input.found || typeof input.applyUrl !== "string" || !input.applyUrl) {
      return null;
    }
    return input.applyUrl;
  } catch (err) {
    console.error("findDirectSourceUrl failed:", err);
    return null;
  }
}
