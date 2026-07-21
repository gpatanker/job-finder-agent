import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./card";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  icon: Icon,
  accent,
  className,
  "data-testid": dataTestId,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "danger";
  className?: string;
  "data-testid"?: string;
}) {
  const accentClass =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
        ? "text-success"
        : accent === "warning"
          ? "text-warning"
          : accent === "danger"
            ? "text-destructive"
            : "text-foreground";

  return (
    <Card className={cn("gap-0 py-0", className)} data-testid={dataTestId}>
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", accentClass)}>
            {value}
          </p>
        </div>
        {Icon && (
          <div className="rounded-md bg-secondary p-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
