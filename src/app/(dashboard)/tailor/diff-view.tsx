import type { ResumeData } from "@/lib/db/schema";
import type { TailoringPlan } from "@/lib/resume/types";
import { applyTailoring } from "@/lib/resume/apply-tailoring";

export function DiffView({
  resume,
  plan,
}: {
  resume: ResumeData;
  plan: TailoringPlan;
}) {
  const tailored = applyTailoring(resume, plan);

  return (
    <div className="space-y-4" data-testid="diff-view">
      {plan.rationale && (
        <p className="rounded-md bg-secondary/60 p-3 text-sm">{plan.rationale}</p>
      )}

      {tailored.experience.map((exp, expIndex) => {
        const baseExp = resume.experience[expIndex];
        const baseOrder = baseExp.bullets.map((b) => b.id);

        return (
          <div key={exp.company} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{exp.company}</p>
            <ol className="mt-2 space-y-2 text-sm">
              {exp.bullets.map((bullet, newIndex) => {
                const originalIndex = baseOrder.indexOf(bullet.id);
                const baseBullet = baseExp.bullets.find((b) => b.id === bullet.id);
                const moved = originalIndex !== newIndex;
                const textChanged = baseBullet && baseBullet.text !== bullet.text;

                return (
                  <li key={bullet.id} className="border-l-2 border-border pl-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>#{newIndex + 1}</span>
                      {moved && <span>(was #{originalIndex + 1})</span>}
                    </div>
                    {textChanged && baseBullet ? (
                      <>
                        <p className="text-destructive/70 line-through">{baseBullet.text}</p>
                        <p className="text-success">{bullet.text}</p>
                      </>
                    ) : (
                      <p>{bullet.text}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <div className="rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Skills order</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {tailored.skills.map((s) => s.category).join(" → ")}
        </p>
      </div>
    </div>
  );
}
