/**
 * My content › Videos: every video project. The selected one shows its
 * thumbnail with its actions; each row has the same actions (VideoActions —
 * Publish until the video is published, then Watch).
 */
import { useEffect, useState } from "preact/hooks";
import { setProjectVisibility, type StudioProjectItem } from "../../api/studio";
import { VIDEO_STATUS_LABEL, listVideos } from "../../domain/videos";
import { navigate } from "../../state/nav";
import { useStore } from "../../state/store";
import { videos } from "../../state/videos";
import { openTab } from "../../platform/chrome";
import { shortDate, t } from "../../platform/i18n";
import { webStudioUrl } from "../../platform/web-links";
import { Button, Eyebrow, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { EmptyState, IconAction, ItemList, ItemRow, SelectedItem } from "../../ui/items";
import { ListSearch } from "../../ui/ListSearch";
import { useKeyedAction } from "../../ui/useAction";
import type { ContentTabProps } from "../content/tab";
import { VideoActions } from "./VideoActions";

const title = (v: StudioProjectItem) => v.title || t("videos_untitled");
const meta = (v: StudioProjectItem) =>
  [t(VIDEO_STATUS_LABEL[v.status] ?? "videoStatus_draft"), shortDate(v.updatedAt)].filter(Boolean).join(" · ");

export function VideosTab({ header }: ContentTabProps) {
  const { items, loaded, error } = useStore(videos.store, (s) => s);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Make it public, then reload so the row offers Watch.
  const publish = useKeyedAction(async (id: string) => {
    await setProjectVisibility(id, true);
    await videos.load(true);
  });
  const publishRow = (id: string) => void publish.run(id);
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
        <ErrorNotice error={error ?? publish.error} />
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
            actions={<VideoActions video={selected} bar publish={publishRow} publishing={publish.busyKey === selected.id} />}
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
                  actions={<VideoActions video={v} publish={publishRow} publishing={publish.busyKey === v.id} />}
                />
              ))}
            </ItemList>
          </section>
        ) : null}
      </div>
    </>
  );
}
