// Standard profile/PII/EEO fields we never want to surface as "candidate-written prompts",
// even if a platform happens to expose them as a labeled text field.
const EXCLUDED_KEYWORDS = [
  "first name",
  "last name",
  "full name",
  "preferred name",
  "preferred first name",
  "email",
  "phone",
  "resume",
  "cv",
  "cover letter",
  "linkedin",
  "github",
  "portfolio",
  "website",
  "location",
  "city",
  "state",
  "country",
  "address",
  "zip",
  "postal",
  "work authorization",
  "authorized to work",
  "sponsorship",
  "visa",
  "veteran",
  "disability",
  "race",
  "ethnicity",
  "gender",
  "pronoun",
  "sexual orientation",
  "how did you hear",
  "referral",
];

export function isStandardField(label: string): boolean {
  const normalized = label.toLowerCase();
  return EXCLUDED_KEYWORDS.some((kw) => normalized.includes(kw));
}
