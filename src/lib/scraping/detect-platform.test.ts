import { describe, expect, it } from "vitest";
import { detectPlatform } from "./index";

describe("detectPlatform", () => {
  it("detects greenhouse for both the legacy and job-boards subdomains", () => {
    expect(detectPlatform("https://boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectPlatform("https://job-boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
  });

  it("detects ashby", () => {
    expect(detectPlatform("https://jobs.ashbyhq.com/acme/123")).toBe("ashby");
  });

  it("falls back to generic for anything else, including invalid URLs", () => {
    expect(detectPlatform("https://acme.com/careers/123")).toBe("generic");
    expect(detectPlatform("not a url")).toBe("generic");
  });
});
