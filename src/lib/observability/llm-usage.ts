export type LlmCallSite =
  | "tailoring"
  | "generate_answer"
  | "question_bank"
  | "find_direct_source"
  | "job_search"
  | "score_job_url"
  | "perplexity_discovery";

// Approximate published per-million-token rates. These drive an *estimated*
// cost KPI, not a billing reconciliation — update if Anthropic publishes
// different Sonnet 5 rates.
const ANTHROPIC_PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
};
const ANTHROPIC_FALLBACK_PRICING = { input: 2, output: 10 };

// Perplexity Search API: flat $5 per 1,000 requests, no per-token billing —
// see the same figure in src/lib/search/perplexity-discover.ts.
const PERPLEXITY_COST_PER_REQUEST = 0.005;

export function estimateAnthropicCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = ANTHROPIC_PRICING_PER_MILLION_TOKENS[model] ?? ANTHROPIC_FALLBACK_PRICING;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export function estimatePerplexityCostUsd(requestCount: number): number {
  return requestCount * PERPLEXITY_COST_PER_REQUEST;
}

/**
 * Records one API call's estimated cost for the Overview page's cost KPIs.
 * Never throws — a logging failure should never break the feature that
 * triggered it, matching the try/catch-and-fall-back style already used at
 * every LLM call site in this codebase. The db client is imported lazily
 * inside the try block (rather than at module scope) so that merely
 * importing this module — which every instrumented call site now does —
 * doesn't eagerly open a DB connection; that matters for unit tests, which
 * exercise these call sites without DATABASE_URL set.
 */
export async function logLlmUsage(params: {
  callSite: LlmCallSite;
  provider: "anthropic" | "perplexity";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  requestCount?: number;
  estimatedCostUsd: number;
  jobId?: string;
}): Promise<void> {
  try {
    const { db } = await import("@/lib/db/client");
    const { llmUsageLog } = await import("@/lib/db/schema");
    await db.insert(llmUsageLog).values({
      callSite: params.callSite,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens ?? null,
      outputTokens: params.outputTokens ?? null,
      requestCount: params.requestCount ?? 1,
      estimatedCostUsd: params.estimatedCostUsd,
      jobId: params.jobId ?? null,
    });
  } catch (err) {
    console.error("Failed to log LLM usage:", err);
  }
}

/**
 * Convenience wrapper for the common case (an Anthropic messages.create()
 * response) — reads token counts defensively (`?? 0`, never a direct
 * `response.usage.input_tokens`) so a response shape that omits `usage`
 * entirely (e.g. a mocked response in a unit test) can never throw *before*
 * logLlmUsage's own try/catch takes over, which would otherwise surface as
 * the call site's outer catch-all swallowing the whole operation.
 */
export async function logAnthropicUsage(params: {
  callSite: LlmCallSite;
  model: string;
  response: { usage?: { input_tokens?: number; output_tokens?: number } };
  jobId?: string;
}): Promise<void> {
  const inputTokens = params.response.usage?.input_tokens ?? 0;
  const outputTokens = params.response.usage?.output_tokens ?? 0;
  await logLlmUsage({
    callSite: params.callSite,
    provider: "anthropic",
    model: params.model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateAnthropicCostUsd(params.model, inputTokens, outputTokens),
    jobId: params.jobId,
  });
}
