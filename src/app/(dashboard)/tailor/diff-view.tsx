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
        <p className="rounded-md bg-black/[0.03] p-3 text-sm dark:bg-white/[0.05]">
          {plan.rationale}
        </p>
      )}

      {tailored.experience.map((exp, expIndex) => {
        const baseExp = resume.experience[expIndex];
        const baseOrder = baseExp.bullets.map((b) => b.id);

        return (
          <div key={exp.company} className="rounded-lg border border-black/10 p-3 dark:border-white/15">
            <p className="text-sm font-medium">{exp.company}</p>
            <ol className="mt-2 space-y-2 text-sm">
              {exp.bullets.map((bullet, newIndex) => {
                const originalIndex = baseOrder.indexOf(bullet.id);
                const baseBullet = baseExp.bullets.find((b) => b.id === bullet.id);
                const moved = originalIndex !== newIndex;
                const textChanged = baseBullet && baseBullet.text !== bullet.text;

                return (
                  <li key={bullet.id} className="border-l-2 border-black/10 pl-3 dark:border-white/15">
                    <div className="flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
                      <span>#{newIndex + 1}</span>
                      {moved && <span>(was #{originalIndex + 1})</span>}
                    </div>
                    {textChanged && baseBullet ? (
                      <>
                        <p className="text-black/40 line-through dark:text-white/40">
                          {baseBullet.text}
                        </p>
                        <p>{bullet.text}</p>
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

      <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
        <p className="text-sm font-medium">Skills order</p>
        <p className="mt-1 text-sm text-black/70 dark:text-white/70">
          {tailored.skills.map((s) => s.category).join(" → ")}
        </p>
      </div>
    </div>
  );
}
