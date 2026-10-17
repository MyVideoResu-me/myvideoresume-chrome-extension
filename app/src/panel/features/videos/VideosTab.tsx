/**
 * My content › Videos: every video project. The selected one shows its
 * thumbnail with its actions; each row has the same actions.
 */
import { useEffect, useState } from "preact/hooks";
import type { StudioProjectItem } from "../../api/studio";
import { VIDEO_STATUS_LABEL, canWatch, listVideos } from "../../domain/videos";
import { navigate } from "../../state/nav";
import { useStore } from "../../state/store";
import { videos } from "../../state/videos";
import { openTab } from "../../platform/chrome";
import { shortDate, t } from "../../platform/i18n";
import { studioProjectUrl, videoWatchUrl, webStudioUrl } from "../../platform/web-links";
import { Button, Eyebrow, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { BarAction, EmptyState, IconAction, ItemList, ItemRow, SelectedItem } from "../../ui/items";
import { ListSearch } from "../../ui/ListSearch";
import { useCopy } from "../../ui/useCopy";
import type { ContentTabProps } from "../content/tab";

const watchUrl = (v: StudioProjectItem) => videoWatchUrl(v.slug ?? v.id);
const title = (v: StudioProjectItem) => v.title || t("videos_untitled");
const meta = (v: StudioProjectItem) =>
  [t(VIDEO_STATUS_LABEL[v.status] ?? "videoStatus_draft"), shortDate(v.updatedAt)].filter(Boolean).join(" · ");

export function VideosTab({ header }: ContentTabProps) {
  const { items, loaded, error } = useStore(videos.store, (s) => s);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { copy, copiedKey } = useCopy();
  useEffect(() => {
    void videos.load();
  }, []);

  const all = listVideos(items);
  const shown = listVideos(items, query);
  const selected = all.find((v) => v.id === selectedId) ?? all[0] ?? null;
  const newVideo = () => navigate("promote");

  return (
    <>
      {header(
        <>
          <IconAction icon="video" primary label={t("videos_new")} onClick={newVideo} />
          <IconAction icon="external" label={t("videos_openStudio")} onClick={() => openTab(webStudioUrl())} />
        </>,
      )}
      <div class="view-body">
        <ErrorNotice error={error} />
        {!loaded ? <Spinner label={t("common_loading")} /> : null}
        {loaded && !error && !all.length ? (
          <EmptyState hint={t("videos_empty")}>
            <Button variant="primary" icon="video" onClick={newVideo}>
              {t("videos_new")}
            </Button>
          </EmptyState>
        ) : null}
        {selected ? (
          <SelectedItem
            key={selected.id}
            eyebrow={t("content_selected")}
            icon="video"
            tone="video"
            title={title(selected)}
            meta={meta(selected)}
            actions={
              <>
                <BarAction icon="play" disabled={!canWatch(selected)} onClick={() => openTab(watchUrl(selected))} label={t("videos_watch")} />
                <BarAction icon={copiedKey === selected.id ? "check" : "link"} disabled={!canWatch(selected)} onClick={() => void copy(selected.id, watchUrl(selected))} label={copiedKey === selected.id ? t("common_copied") : t("action_copyLink")} />
                <BarAction icon="pen" onClick={() => openTab(studioProjectUrl(selected.id))} label={t("action_edit")} />
              </>
            }
          >
            {selected.thumbnailUrl ? <img class="video-thumb" src={selected.thumbnailUrl} alt="" /> : null}
          </SelectedItem>
        ) : null}
        {all.length ? (
          <section class="stack-sm">
            <Eyebrow>{t("videos_all", { count: all.length })}</Eyebrow>
            <ListSearch id="video-search" count={all.length} value={query} onInput={setQuery} />
            {!shown.length ? <p class="muted small">{t("content_noMatch")}</p> : null}
            <ItemList label={t("content_tab_videos")}>
              {shown.map((v) => (
                <ItemRow
                  key={v.id}
                  icon="video"
                  tone="video"
                  title={title(v)}
                  meta={meta(v)}
                  selected={v.id === selected?.id}
                  selectLabel={t("content_show")}
                  onSelect={() => setSelectedId(v.id)}
                  actions={
                    <>
                      <IconAction icon="play" label={t("videos_watch")} disabled={!canWatch(v)} onClick={() => openTab(watchUrl(v))} />
                      <IconAction icon="pen" label={t("action_edit")} onClick={() => openTab(studioProjectUrl(v.id))} />
                    </>
                  }
                />
              ))}
            </ItemList>
          </section>
        ) : null}
      </div>
    </>
  );
}
