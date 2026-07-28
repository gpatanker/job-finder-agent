const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "have",
  "has", "this", "that", "from", "into", "who", "what", "when", "where",
  "why", "how", "all", "any", "can", "may", "must", "should", "would",
  "job", "role", "team", "work", "years", "year", "experience", "including",
  "such", "etc", "able", "strong", "using", "used", "use", "including",
  "across", "within", "about", "other", "than", "also", "more", "most",
  "we're", "we", "they", "their", "them", "its", "it's", "on", "in", "to",
  "of", "a", "an", "is", "as", "at", "by", "or", "be", "not",
  // Generic connective/filler words common in job-posting prose that pass
  // the length-3+ filter but carry no signal about the role's requirements
  // — confirmed live via a short real JD whose top-40 extracted "keywords"
  // were dominated by words like these instead of actual skills.
  "does", "did", "was", "were", "been", "being", "do", "each",
  "same", "bring", "brings", "provide", "provides", "providing", "clear",
  "stand", "serve", "serves", "powers", "power", "help", "helps", "helping",
  "make", "makes", "making", "get", "gets", "getting", "take", "takes",
  "taking", "put", "puts", "see", "sees", "look", "looking", "need", "needs",
  "want", "wants", "wanting", "like", "likes", "great", "excellent", "good",
  "best", "new", "high", "highly", "well", "very", "really", "just", "here",
  "there", "these", "those", "which", "while", "because", "if", "so",
  "own", "one", "two", "three", "first", "second", "part", "day", "days",
  "time", "times", "every", "everyone", "someone", "something", "yourself",
  "us", "please", "include", "includes", "included",
]);

export function extractKeywords(text: string, limit = 40): string[] {
  const counts = new Map<string, number>();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}
