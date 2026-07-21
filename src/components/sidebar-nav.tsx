"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  FileText,
  ClipboardList,
  Bot,
  ListOrdered,
  Search,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: ListChecks },
  { href: "/tailor", label: "Resume Tailor", icon: FileText },
  { href: "/packet", label: "Application Packet", icon: ClipboardList },
  { href: "/apply-agent", label: "Apply Agent", icon: Bot },
  { href: "/run-queue", label: "Run Queue", icon: ListOrdered },
  { href: "/search", label: "Search / Import", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md border-l-2 border-transparent px-3 py-2 transition-colors",
              isActive
                ? "border-l-primary bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
