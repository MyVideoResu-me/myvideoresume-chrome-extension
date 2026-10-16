/**
 * Template / Length / Look. Only what the storyboard API takes: the
 * template is the flow's purpose (shown, not picked), length is
 * `targetDuration`, look is `motion`. A tap moves to the next choice;
 * it applies to the next script written. (Voice is picked in Studio.)
 */
import { VIDEO_MOTIONS, type VideoMotion } from "../../api/studio";
import { t, type MessageKey } from "../../platform/i18n";
import type { VideoOptions } from "./useVideoProject";

const LENGTHS = [15, 30, 60] as const;

const MOTION_LABEL: Record<VideoMotion, MessageKey> = {
  minimal: "video_lookMinimal",
  moderate: "video_lookModerate",
  cinematic: "video_lookCinematic",
};

function next<T>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length];
}

export function OptionTiles({
  template,
  options,
  onChange,
}: {
  template: string;
  options: VideoOptions;
  onChange: (next: VideoOptions) => void;
}) {
  return (
    <div class="opt-tiles">
      <div class="opt">
        <b>{t("video_optTemplate")}</b>
        {template}
      </div>
      <button
        type="button"
        class="opt"
        onClick={() => onChange({ ...options, targetDuration: next(LENGTHS, options.targetDuration as (typeof LENGTHS)[number]) })}
      >
        <b>{t("video_optLength")}</b>
        {t("video_seconds", { seconds: options.targetDuration })}
      </button>
      <button type="button" class="opt" onClick={() => onChange({ ...options, motion: next(VIDEO_MOTIONS, options.motion) })}>
        <b>{t("video_optLook")}</b>
        {t(MOTION_LABEL[options.motion])}
      </button>
    </div>
  );
}
