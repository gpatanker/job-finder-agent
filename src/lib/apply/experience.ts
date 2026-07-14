import type { ResumeExperienceEntry } from "@/lib/db/schema";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function parseMonthYear(text: string, asOf: Date): Date | null {
  const trimmed = text.trim();
  if (/^present$/i.test(trimmed)) return asOf;
  const match = trimmed.match(/^([a-z]+)\.?\s+(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Number(match[2]), month, 1);
}

/** Parses a "MMM YYYY – MMM YYYY" / "MMM YYYY – Present" range. Returns null for anything it can't confidently parse — callers should treat that as "unknown," never guess. */
export function parseDateRange(
  dateRange: string,
  asOf: Date
): { start: Date; end: Date } | null {
  const parts = dateRange.split(/[–—-]/).map((s) => s.trim());
  if (parts.length !== 2) return null;
  const start = parseMonthYear(parts[0], asOf);
  const end = parseMonthYear(parts[1], asOf);
  if (!start || !end) return null;
  return { start, end };
}

/**
 * Total professional experience in months, counting overlapping roles once
 * (merges overlapping intervals rather than summing them independently) —
 * used to answer "do you have at least N years of experience" questions
 * honestly instead of assuming yes.
 */
export function computeTotalExperienceMonths(
  experience: ResumeExperienceEntry[],
  asOf: Date = new Date()
): number {
  const intervals = experience
    .map((e) => parseDateRange(e.dateRange, asOf))
    .filter((r): r is { start: Date; end: Date } => r !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let totalMonths = 0;
  let currentEnd: Date | null = null;
  let currentStart: Date | null = null;

  function monthsBetween(a: Date, b: Date): number {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }

  for (const { start, end } of intervals) {
    if (currentStart === null) {
      currentStart = start;
      currentEnd = end;
      continue;
    }
    if (start.getTime() <= (currentEnd as Date).getTime()) {
      if (end.getTime() > (currentEnd as Date).getTime()) currentEnd = end;
    } else {
      totalMonths += monthsBetween(currentStart, currentEnd as Date);
      currentStart = start;
      currentEnd = end;
    }
  }
  if (currentStart !== null) {
    totalMonths += monthsBetween(currentStart, currentEnd as Date);
  }

  return Math.max(0, totalMonths);
}

export function formatExperienceSummary(
  experience: ResumeExperienceEntry[],
  asOf: Date = new Date()
): string {
  const totalMonths = computeTotalExperienceMonths(experience, asOf);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parsedCount = experience.filter((e) => parseDateRange(e.dateRange, asOf)).length;
  const unparsedNote =
    parsedCount < experience.length
      ? ` (${experience.length - parsedCount} role(s) had a date range that couldn't be parsed and are excluded from this total)`
      : "";
  return `${years} years, ${months} months total${unparsedNote}`;
}
