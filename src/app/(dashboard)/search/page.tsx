import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobSearchSuggestions } from "@/lib/db/schema";
import { SearchClient } from "./search-client";

export default async function SearchPage() {
  const suggestions = await db
    .select()
    .from(jobSearchSuggestions)
    .where(eq(jobSearchSuggestions.status, "new"))
    .orderBy(desc(jobSearchSuggestions.matchScore));

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Search / Import</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        The search agent looks up currently-open postings matching your profile and scores them — it never adds
        jobs to your pipeline directly. Review each suggestion and promote the ones worth tracking.
      </p>
      <SearchClient initialSuggestions={suggestions} />
    </main>
  );
}
