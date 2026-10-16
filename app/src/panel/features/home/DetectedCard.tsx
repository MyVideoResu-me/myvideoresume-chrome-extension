/** "On this page" — the detected job / profile / post, or how to give us one. */
import { useState } from "preact/hooks";
import type { PageEntity } from "../../domain/entities";
import { navigate } from "../../state/nav";
import { scanPage, takeSelectionAsPost } from "../../state/page";
import { launchPicker } from "../../platform/picker";
import { t } from "../../platform/i18n";
import { Button, Card } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";
import { useTrackedJobFor } from "../job/useTrackedJob";

function JobCard({ entity }: { entity: Extract<PageEntity, { kind: "job" }> }) {
  const tracked = useTrackedJobFor(entity.sourceUrl);
  return (
    <Card class="detected">
      <div class="detected-row">
        <span class="entity-icon entity-job">
          <Icon name="briefcase" />
        </span>
        <div class="detected-text">
          <div class="detected-title">{entity.title}</div>
          <div class="muted small">{[entity.company, entity.location].filter(Boolean).join(" · ")}</div>
        </div>
        <Button variant={tracked ? "secondary" : "primary"} size="sm" icon={tracked ? "check" : "bookmark"} onClick={() => navigate("job")}>
          {tracked ? t("job_tracked") : t("job_track")}
        </Button>
      </div>
    </Card>
  );
}

function ProfileCard({ entity }: { entity: Extract<PageEntity, { kind: "profile" }> }) {
  return (
    <Card class="detected">
      <div class="detected-row">
        <span class="entity-icon entity-person">
          <Icon name="user" />
        </span>
        <div class="detected-text">
          <div class="detected-title">{entity.name}</div>
          <div class="muted small">{[entity.title, entity.company].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
    </Card>
  );
}

function PostCard({ entity }: { entity: Extract<PageEntity, { kind: "post" }> }) {
  return (
    <Card class="detected">
      <div class="detected-row">
        <span class="entity-icon entity-person">
          <Icon name="message" />
        </span>
        <div class="detected-text">
          <div class="detected-title">{entity.author || t("post_unknownAuthor")}</div>
          <p class="quote">{entity.text.slice(0, 220)}</p>
        </div>
      </div>
    </Card>
  );
}

function NothingCard() {
  const [noSelection, setNoSelection] = useState(false);
  const selection = useAction(async () => setNoSelection(!(await takeSelectionAsPost())));
  return (
    <Card class="detected">
      <div class="detected-title">{t("home_nothing")}</div>
      <p class="muted small">{t("home_nothing_hint")}</p>
      <div class="row wrap">
        <Button size="sm" icon="scan" onClick={() => void scanPage()}>
          {t("home_scanAgain")}
        </Button>
        <Button size="sm" icon="target" onClick={() => void launchPicker("job")}>
          {t("home_pickJob")}
        </Button>
        <Button size="sm" icon="message" busy={selection.busy} onClick={() => void selection.run()}>
          {t("home_useSelection")}
        </Button>
      </div>
      {noSelection ? <p class="muted small" role="status">{t("home_noSelection")}</p> : null}
    </Card>
  );
}

export function DetectedCard({ entity }: { entity: PageEntity | null }) {
  if (!entity) return <NothingCard />;
  switch (entity.kind) {
    case "job":
      return <JobCard entity={entity} />;
    case "profile":
      return <ProfileCard entity={entity} />;
    case "post":
      return <PostCard entity={entity} />;
  }
}
