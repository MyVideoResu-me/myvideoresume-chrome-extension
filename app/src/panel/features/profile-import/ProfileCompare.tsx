/**
 * "Improve my résumé from this profile": what their profile does that mine
 * doesn't — as suggestions. Nothing of theirs is copied: I tick the skills I
 * have, write my own headline, and add my own entries in Studio. Saves a new
 * version with only what I confirmed.
 */
import { useState } from "preact/hooks";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { Button, Card, Eyebrow } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { NoProfileTextError } from "./profile-text";
import type { ProfileCompare as Compare } from "./useProfileCompare";

const pct = (ratio: number) => Math.round(ratio * 100);

export function ProfileCompare({ compare, masterId, name }: { compare: Compare; masterId: string; name: string }) {
  const [title, setTitle] = useState("");
  const { comparison: c, read, save, saved } = compare;
  const versionTitle = title.trim() || t("compare_versionTitle", { name });

  if (!c) {
    return (
      <div class="view-body">
        <Card>
          <p class="small">{t("compare_intro", { name })}</p>
          <Button variant="primary" block icon="scan" busy={read.busy} onClick={() => void read.run()}>
            {t("compare_read")}
          </Button>
          <ErrorNotice error={read.error instanceof NoProfileTextError ? null : read.error} fallback="error_readPage" />
          {read.error instanceof NoProfileTextError ? <p class="small text-warn">{t("error_readPage")}</p> : null}
        </Card>
      </div>
    );
  }

  const nothing = !c.missingSkills.length && !c.missingSections.length && !c.quantifyTip && !c.headline.theirs;

  return (
    <>
      <div class="view-body">
        <p class="muted small">{t("compare_neverCopy")}</p>
        {nothing ? <p class="small">{t("compare_nothing", { name })}</p> : null}

        {c.missingSkills.length ? (
          <>
            <Eyebrow>{t("compare_skills", { count: c.missingSkills.length })}</Eyebrow>
            {c.missingSkills.map((skill) => {
              const on = compare.skills.has(skill);
              return (
                <label key={skill} class={`suggest-item ${on ? "on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => compare.toggleSkill(skill)} />
                  <span class="suggest-body">
                    <b>{skill}</b>
                    <span class="muted">{t("compare_haveSkill")}</span>
                  </span>
                </label>
              );
            })}
          </>
        ) : null}

        {c.headline.theirs ? (
          <>
            <Eyebrow>{t("compare_headline")}</Eyebrow>
            <div class="compare-col">
              <b>{t("compare_theirHeadline")}</b>
              {c.headline.theirs}
            </div>
            <div class="field">
              <label for="compare-headline" class="field-label">
                {t("compare_myHeadline")}
              </label>
              <input
                id="compare-headline"
                class="input"
                value={compare.headline}
                onInput={(e) => compare.setHeadline(e.currentTarget.value)}
              />
              <div class="muted small">{t("compare_headlineHint")}</div>
            </div>
          </>
        ) : null}

        {c.summary.theirs > 0 && c.summary.mine === 0 ? <p class="small">{t("compare_noSummary")}</p> : null}

        {c.missingSections.length ? (
          <>
            <Eyebrow>{t("compare_sections")}</Eyebrow>
            {c.missingSections.map((s) => (
              <div key={s.id} class="row between suggest-item">
                <span class="small">{t("compare_addSection", { section: t(s.labelKey) })}</span>
                <Button size="sm" icon="external" onClick={() => openTab(studioResumeUrl(masterId))}>
                  {t("compare_addInStudio")}
                </Button>
              </div>
            ))}
          </>
        ) : null}

        {c.quantifyTip ? (
          <Card>
            <div class="strong small">{t("compare_numbers")}</div>
            <p class="small">
              {t("compare_numbersHint", { mine: pct(c.density.mine.ratio), theirs: pct(c.density.theirs.ratio) })}
            </p>
          </Card>
        ) : null}

        {saved ? (
          <InfoNotice>
            {t("import_saved", { title: saved.title })}
            <Button size="sm" icon="external" onClick={() => openTab(studioResumeUrl(saved.resumeId))}>
              {t("common_openStudio")}
            </Button>
          </InfoNotice>
        ) : compare.changes ? (
          <div class="field">
            <label for="compare-title" class="field-label">
              {t("import_versionName")}
            </label>
            <input
              id="compare-title"
              class="input"
              value={title}
              placeholder={versionTitle}
              onInput={(e) => setTitle(e.currentTarget.value)}
            />
          </div>
        ) : null}
      </div>
      {saved ? null : (
        <footer class="view-footer">
          <Button
            variant="primary"
            block
            icon="check"
            busy={save.busy}
            disabled={!compare.changes}
            onClick={() => void save.run(versionTitle)}
          >
            {t("compare_save")}
          </Button>
          <div class="muted small center">{t("compare_saveHint")}</div>
          <ErrorNotice error={save.error} />
        </footer>
      )}
    </>
  );
}
