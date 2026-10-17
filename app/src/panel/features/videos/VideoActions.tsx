/**
 * A video's actions, for the selected card (`bar`) and each row. A published
 * or public video offers Watch (+ Copy link on the bar); an unpublished one
 * offers Publish instead — its watch link would only say "still preparing".
 */
import type { StudioProjectItem } from "../../api/studio";
import { isWatchable } from "../../domain/videos";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioProjectUrl, videoWatchUrl } from "../../platform/web-links";
import { BarAction, IconAction } from "../../ui/items";
import { useCopy } from "../../ui/useCopy";

const watchUrl = (v: StudioProjectItem) => videoWatchUrl(v.slug ?? v.id);

export function VideoActions({
  video,
  bar,
  publish,
  publishing,
}: {
  video: StudioProjectItem;
  bar?: boolean;
  publish: (id: string) => void;
  publishing: boolean;
}) {
  const { copy, copiedKey } = useCopy();
  const Action = bar ? BarAction : IconAction;
  const edit = <Action icon="pen" label={t("action_edit")} onClick={() => openTab(studioProjectUrl(video.id))} />;

  if (!isWatchable(video)) {
    return (
      <>
        <Action icon="share" label={t("videos_publish")} busy={publishing} onClick={() => publish(video.id)} />
        {edit}
      </>
    );
  }
  const copied = copiedKey === video.id;
  return (
    <>
      <Action icon="play" label={t("videos_watch")} onClick={() => openTab(watchUrl(video))} />
      {bar ? (
        <Action icon={copied ? "check" : "link"} label={copied ? t("common_copied") : t("action_copyLink")} onClick={() => void copy(video.id, watchUrl(video))} />
      ) : null}
      {edit}
    </>
  );
}
