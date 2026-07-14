import { test, expect } from "@playwright/test";

/**
 * End-to-end smoke test for the full pipeline -> resume -> packet ->
 * apply-agent -> queue flow, against a real running dev server, a real
 * Supabase instance, and the real Claude API. Requires:
 *   - The app running locally with a seeded candidate profile/resume/story
 *     bank (npm run db:seed-profile)
 *   - E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD env vars for a real Supabase Auth
 *     account (see .env.local — never hardcode real credentials here, this
 *     file is public)
 *
 * This is an integration test, not a CI-safe unit test — it costs real API
 * calls and mutates real data (a job it creates and deletes itself).
 */

const EMAIL = process.env.E2E_LOGIN_EMAIL;
const PASSWORD = process.env.E2E_LOGIN_PASSWORD;

test.skip(!EMAIL || !PASSWORD, "Set E2E_LOGIN_EMAIL/E2E_LOGIN_PASSWORD to run this test");

test("full flow: pipeline -> resume -> packet -> apply agent -> run queue", async ({ page }) => {
  await test.step("log in", async () => {
    await page.goto("/login");
    await page.fill('[data-testid="login-email"]', EMAIL!);
    await page.fill('[data-testid="login-password"]', PASSWORD!);
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL("/");
  });

  let jobId = "";

  await test.step("create and approve a job", async () => {
    const createRes = await page.request.post("/api/jobs", {
      data: {
        company: "E2E Test Co",
        title: "Business Operations Manager",
        applyUrl: "https://job-boards.greenhouse.io/snorkelai/jobs/5689470004",
        jobDescription: "GPU infrastructure, vendor negotiation, Python, SQL, fraud/risk analytics.",
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { job } = await createRes.json();
    jobId = job.id;

    const patchRes = await page.request.patch(`/api/jobs/${jobId}`, {
      data: { status: "approved", approvalStatus: "approved" },
    });
    expect(patchRes.ok()).toBeTruthy();
  });

  await test.step("generate and attach a tailored resume", async () => {
    await page.goto(`/tailor/${jobId}`);
    await page.click('[data-testid="generate-resume-button"]');
    await page.waitForSelector('[data-testid="download-resume-link"]', { timeout: 30_000 });
    await expect(page.locator('[data-testid="diff-view"]')).toBeVisible();

    const resumeHref = await page.getAttribute('[data-testid="download-resume-link"]', "href");
    const pdfRes = await page.request.get(resumeHref!);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toBe("application/pdf");
  });

  await test.step("scrape prompts, generate and approve an answer", async () => {
    await page.goto(`/packet/${jobId}`);
    await page.click('[data-testid="scrape-prompts-button"]');
    await page.waitForSelector('[data-testid^="question-"]', { timeout: 20_000 });

    const questionTestId = await page
      .locator('[data-testid^="question-"]')
      .first()
      .getAttribute("data-testid");
    const questionId = questionTestId!.replace("question-", "");

    await page.click(`[data-testid="generate-answer-${questionId}"]`);
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`[data-testid="answer-${id}"]`) as HTMLTextAreaElement | null;
        return (el?.value.length ?? 0) > 0;
      },
      questionId,
      { timeout: 30_000 }
    );

    await page.click(`[data-testid="approve-question-${questionId}"]`);
    await expect(page.locator('[data-testid="packet-readiness"]')).toHaveText("Prompts approved");
  });

  await test.step("complete the Apply Agent checklist and queue a run", async () => {
    await page.goto("/apply-agent");
    await page.waitForSelector(`[data-testid="apply-card-${jobId}"]`);
    await page.check(`[data-testid="confirm-review-${jobId}"]`);
    await expect(page.locator(`[data-testid="start-apply-run-${jobId}"]`)).toBeEnabled();

    const [startResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/start-apply-run")),
      page.click(`[data-testid="start-apply-run-${jobId}"]`),
    ]);
    expect(startResp.status()).toBe(201);
  });

  await test.step("run appears in the Run Queue and can transition status", async () => {
    const runsRes = await page.request.get("/api/agent-runs?status=queued");
    const { runs } = await runsRes.json();
    const run = runs.find((r: { jobId: string }) => r.jobId === jobId);
    expect(run).toBeTruthy();

    await page.goto("/run-queue");
    await page.waitForSelector(`[data-testid="run-${run.id}"]`);
    await page.click(`[data-testid="mark-in-progress-${run.id}"]`);
    await expect(page.locator(`[data-testid="run-${run.id}"]`)).toContainText("In Progress");
  });

  await test.step("cleanup", async () => {
    const deleteRes = await page.request.delete(`/api/jobs/${jobId}`);
    expect(deleteRes.ok()).toBeTruthy();
  });
});
