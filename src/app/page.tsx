import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold">Job Finder Agent</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Signed in as {user?.email}. Pipeline dashboard coming next.
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
          data-testid="sign-out"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
