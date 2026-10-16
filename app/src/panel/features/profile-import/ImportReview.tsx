/**
 * What importing my profile would change, item by item: new entries to add
 * (on/off), entries that differ (combine / keep mine / use profile), and
 * basics that differ (keep mine / use profile).
 */
import { newItemKey } from "@shared/resume-merge-decisions";
import { MATCH_CHOICES, SECTION_LABEL, describeEntry, fieldLabelKey, reviewableMatches } from "../../domain/merge-review";
import { t } from "../../platform/i18n";
import { Eyebrow, Segmented } from "../../ui/controls";
import type { OwnImport } from "./useOwnImport";

export function ImportReview({ review }: { review: OwnImport }) {
  const a = review.analysis;
  if (!a) return null;
  const matches = reviewableMatches(a);
  const nothing = !a.newSections.length && !matches.length && !a.basics.conflicts.length;
  if (nothing) return <p class="muted small">{t("import_nothingNew")}</p>;

  return (
    <div class="stack-sm">
      {a.newSections.length ? (
        <>
          <Eyebrow>{t("import_newItems", { count: a.newSections.length })}</Eyebrow>
          {a.newSections.map((item) => {
            const key = newItemKey(item.sectionType, item.sourceIndex);
            const on = review.newItems.get(key) === true;
            const { label, secondary } = describeEntry(item.item);
            return (
              <label key={key} class={`suggest-item ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => review.toggleNewItem(key)} />
                <span class="suggest-body">
                  <span class="tag tag-primary">{t(SECTION_LABEL[item.sectionType])}</span>
                  <b>{label || t("import_untitled")}</b>
                  {secondary ? <span class="muted">{secondary}</span> : null}
                  {item.crossSectionConflict ? <span class="text-warn small">{t("import_maybeMisplaced")}</span> : null}
                </span>
              </label>
            );
          })}
        </>
      ) : null}

      {matches.length ? (
        <>
          <Eyebrow>{t("import_conflicts", { count: matches.length })}</Eyebrow>
          {matches.map((i) => {
            const m = a.sectionMatches[i];
            const fields = [...new Set(Object.keys(m.scalarDiffs ?? {}).map((f) => t(fieldLabelKey(f))))];
            return (
              <div key={`${m.sectionType}:${m.sourceIndex}`} class="review-item">
                <span class="tag tag-warn">{t(SECTION_LABEL[m.sectionType])}</span>
                <span class="small">
                  {fields.length ? t("import_differs", { fields: fields.join(", ") }) : t("import_differsBullets")}
                </span>
                <Segmented
                  label={t("import_conflictChoice")}
                  value={review.choices[i] ?? "combine"}
                  options={MATCH_CHOICES.map((c) => ({ value: c.id, label: t(c.labelKey) }))}
                  onChange={(v) => review.setChoice(i, v)}
                />
              </div>
            );
          })}
        </>
      ) : null}

      {a.basics.conflicts.length ? (
        <>
          <Eyebrow>{t("import_basics")}</Eyebrow>
          {a.basics.conflicts.map((c) => {
            const side = review.basics[c.field] ?? "target";
            return (
              <div key={c.field} class="review-item">
                <span class="tag tag-warn">{t(fieldLabelKey(c.field))}</span>
                <div class="compare-grid">
                  <div class="compare-col">
                    <b>{t("import_mine")}</b>
                    {c.targetValue || "—"}
                  </div>
                  <div class="compare-col">
                    <b>{t("import_profile")}</b>
                    {c.sourceValue || "—"}
                  </div>
                </div>
                <Segmented
                  label={t("import_conflictChoice")}
                  value={side}
                  options={[
                    { value: "target" as const, label: t("import_keepMine") },
                    { value: "source" as const, label: t("import_useProfile") },
                  ]}
                  onChange={(v) => review.setBasic(c.field, v)}
                />
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
