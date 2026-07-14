"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Overview", enabled: true },
  { href: "/pipeline", label: "Pipeline", enabled: true },
  { href: "/tailor", label: "Resume Tailor", enabled: true },
  { href: "/packet", label: "Application Packet", enabled: false },
  { href: "/apply-agent", label: "Apply Agent", enabled: false },
  { href: "/run-queue", label: "Run Queue", enabled: false },
  { href: "/search", label: "Search / Import", enabled: false },
  { href: "/settings", label: "Settings", enabled: true },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 text-sm">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;

        if (!item.enabled) {
          return (
            <span
              key={item.href}
              className="flex items-center justify-between rounded-md px-3 py-2 text-black/35 dark:text-white/35"
            >
              {item.label}
              <span className="text-xs">Soon</span>
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 ${
              isActive
                ? "bg-black/5 font-medium dark:bg-white/10"
                : "hover:bg-black/5 dark:hover:bg-white/10"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
