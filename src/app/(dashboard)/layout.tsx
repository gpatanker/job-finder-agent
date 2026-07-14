import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/sidebar-nav";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1">
      <aside className="flex w-56 shrink-0 flex-col border-r border-black/10 p-4 dark:border-white/15">
        <div className="mb-6">
          <p className="text-sm font-semibold">Job Finder Agent</p>
          <p className="truncate text-xs text-black/50 dark:text-white/50">
            {user?.email}
          </p>
        </div>
        <SidebarNav />
        <form action={signOut} className="mt-auto pt-4">
          <button
            type="submit"
            className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            data-testid="sign-out"
          >
            Sign out
          </button>
        </form>
      </aside>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
