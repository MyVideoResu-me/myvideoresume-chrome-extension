/**
 * The written script, scene by scene. `beats` names what each scene does
 * (Hook / Proof / Fit / Ask) when the flow has a fixed arc.
 */
import type { ComponentChildren } from "preact";
import type { VideoScene, VideoScript } from "../../api/studio";
import { t, type MessageKey } from "../../platform/i18n";
import { Card } from "../../ui/controls";

export function sceneLine(scene: Pick<VideoScene, "title" | "subtitle" | "text" | "items">): string {
  const text = Array.isArray(scene.text) ? scene.text.join(" ") : scene.text;
  return [scene.title, scene.subtitle, text, scene.items?.join(", ")].filter(Boolean).join(" — ");
}

/**
 * A four-beat arc mapped onto any number of scenes: the first opens
 * (Hook), the last asks (Ask), the second proves (Proof), the rest fit.
 */
export const FIT_BEATS = {
  first: "video_beatHook",
  second: "video_beatProof",
  middle: "video_beatFit",
  last: "video_beatAsk",
} as const satisfies Record<string, MessageKey>;

export type Beats = typeof FIT_BEATS;

function beatFor(beats: Beats, i: number, n: number): MessageKey {
  if (i === 0) return beats.first;
  if (i === n - 1) return beats.last;
  if (i === 1) return beats.second;
  return beats.middle;
}

export function ScriptCard({
  script,
  beats,
  aside,
  children,
}: {
  script: VideoScript;
  beats?: Beats;
  /** Shown at the right of the heading (length, source). */
  aside?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const n = script.scenes.length;
  return (
    <Card>
      <div class="row between">
        <span class="strong">{t("video_script")}</span>
        <span class="muted small">{aside ?? t("video_seconds", { seconds: Math.round(script.video.duration) })}</span>
      </div>
      <ol class="scenes">
        {script.scenes.map((s, i) => (
          <li key={s.id || i}>
            <span class="scene-n">{i + 1}</span>
            <span class="small">
              {beats && n > 1 ? <b>{t(beatFor(beats, i, n))} — </b> : null}
              {sceneLine(s) || s.type}
            </span>
          </li>
        ))}
      </ol>
      {children}
    </Card>
  );
}
