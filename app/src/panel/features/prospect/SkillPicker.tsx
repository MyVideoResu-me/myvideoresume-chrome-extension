/** Pick which of my résumé's skills a pitch / reply features. */
import { useEffect, useState } from "preact/hooks";
import { resumeContent } from "../../state/resumes";
import { t } from "../../platform/i18n";

const MAX_SHOWN = 10;

export function useResumeSkills(resumeId: string | null): readonly string[] {
  const [skills, setSkills] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!resumeId) return;
    void resumeContent(resumeId)
      .then((c) => setSkills((c.skills ?? []).map((s) => s.name ?? "").filter(Boolean).slice(0, MAX_SHOWN)))
      .catch(() => setSkills([]));
  }, [resumeId]);
  return skills;
}

export function SkillPicker({
  skills,
  picked,
  onChange,
}: {
  skills: readonly string[];
  picked: readonly string[];
  onChange: (next: readonly string[]) => void;
}) {
  if (!skills.length) return <p class="muted small">{t("prospect_noSkills")}</p>;
  return (
    <div class="row wrap" role="group" aria-label={t("prospect_skills")}>
      {skills.map((s) => {
        const on = picked.includes(s);
        return (
          <button
            type="button"
            key={s}
            class={`chip-btn ${on ? "on" : ""}`}
            aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((p) => p !== s) : [...picked, s])}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
