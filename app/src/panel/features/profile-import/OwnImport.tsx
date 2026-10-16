/**
 * "Import my profile": read my profile on this page, review item by item,
 * then save — as a new version (default) or onto my master after I confirm.
 * `allowMaster` is false unless the profile is known to be mine: then it
 * only ever saves as a new version.
 */
import { useState } from "preact/hooks";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { Button, Card } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { RadioCards } from "../../ui/RadioCards";
import { ImportReview } from "./ImportReview";
import { UnsupportedSiteError, type OwnImport as Review } from "./useOwnImport";

type Target = "version" | "master";

export function OwnImport({
  review,
  masterTitle,
  allowMaster,
}: {
  review: Review;
  masterTitle: string;
  allowMaster: boolean;
}) {
  const [picked, setPicked] = useState<Target>("version");
  const target: Target = allowMaster ? picked : "version";
  const [title, setTitle] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { read, save, result, connector } = review;
  const versionTitle = title.trim() || t("import_versionTitle", { source: connector?.label ?? "" });
  const canSave = !!review.analysis && (target === "version" || confirmed) && !result;

  const onSave = () =>
    void save.run(target === "version" ? { createNew: true, newTitle: versionTitle } : { createNew: false });

  return (
    <>
      <div class="view-body">
        {!review.analysis ? (
          <Card>
            <p class="small">{t("import_ownIntro")}</p>
            <Button variant="primary" block icon="scan" busy={read.busy} onClick={() => void read.run()}>
              {t("import_read")}
            </Button>
            {read.error instanceof UnsupportedSiteError ? (
              <p class="small text-warn" role="alert">
                {t("import_unsupported")}
              </p>
            ) : (
              <ErrorNotice error={read.error} fallback="error_readPage" />
            )}
          </Card>
        ) : (
          <>
            <ImportReview review={review} />
            {result ? null : (
              <>
                {allowMaster ? (
                  <RadioCards
                    name="import-target"
                    legend={t("import_saveAs")}
                    value={target}
                    options={[
                      { value: "version", label: t("import_asVersion"), hint: t("import_asVersionHint") },
                      { value: "master", label: t("import_asMaster"), hint: t("import_asMasterHint", { title: masterTitle }) },
                    ]}
                    onChange={setPicked}
                  />
                ) : (
                  <p class="muted small">{t("import_versionOnly")}</p>
                )}
                {target === "version" ? (
                  <div class="field">
                    <label for="import-title" class="field-label">
                      {t("import_versionName")}
                    </label>
                    <input
                      id="import-title"
                      class="input"
                      value={title}
                      placeholder={versionTitle}
                      onInput={(e) => setTitle(e.currentTarget.value)}
                    />
                  </div>
                ) : (
                  <label class="row small">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.currentTarget.checked)} />
                    {t("import_confirmMaster", { title: masterTitle })}
                  </label>
                )}
              </>
            )}
            {result ? (
              <InfoNotice>
                {t("import_saved", { title: result.title })}
                <Button size="sm" icon="external" onClick={() => openTab(studioResumeUrl(result.resumeId))}>
                  {t("common_openStudio")}
                </Button>
              </InfoNotice>
            ) : null}
          </>
        )}
      </div>
      {review.analysis && !result ? (
        <footer class="view-footer">
          <Button variant="primary" block icon="check" busy={save.busy} disabled={!canSave} onClick={onSave}>
            {target === "version" ? t("import_saveVersion") : t("import_saveMaster")}
          </Button>
          <ErrorNotice error={save.error} />
        </footer>
      ) : null}
    </>
  );
}
