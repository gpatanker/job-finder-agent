const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "have",
  "has", "this", "that", "from", "into", "who", "what", "when", "where",
  "why", "how", "all", "any", "can", "may", "must", "should", "would",
  "job", "role", "team", "work", "years", "year", "experience", "including",
  "such", "etc", "able", "strong", "using", "used", "use", "including",
  "across", "within", "about", "other", "than", "also", "more", "most",
  "we're", "we", "they", "their", "them", "its", "it's", "on", "in", "to",
  "of", "a", "an", "is", "as", "at", "by", "or", "be", "not",
]);

export function extractKeywords(text: string, limit = 40): string[] {
  const counts = new Map<string, number>();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}
