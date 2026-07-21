import { redirect } from "next/navigation";
import { Briefcase, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/sidebar-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
    <div className="flex flex-1 bg-background">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border p-4">
        <div className="mb-4 flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Briefcase className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Job Finder Agent</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </div>
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Separator />
          <ThemeToggle />
          <form action={signOut}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              data-testid="sign-out"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-x-hidden">{children}</div>
    </div>
  );
}
