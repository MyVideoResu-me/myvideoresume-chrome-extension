/**
 * "Square · 30s · captions on" — what a video will be, read from its real
 * script once written (else the length the flow asks for). Only facts the
 * script states are shown: no aspect or captions line until it says so.
 */
import type { VideoScript } from "../api/studio";
import type { MessageKey } from "../platform/i18n";

type Aspect = NonNullable<VideoScript["video"]["aspect"]>;

const ASPECT_LABEL: Record<Aspect, MessageKey> = {
  "1:1": "videoMeta_square",
  "9:16": "videoMeta_vertical",
  "16:9": "videoMeta_landscape",
};

export type VideoMeta = { aspectKey: MessageKey | null; seconds: number; captions: boolean | null };

function captionsOf(script: VideoScript): boolean | null {
  const raw = script.video.captions ?? script.captions;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "object" && "enabled" in raw) return (raw as { enabled?: unknown }).enabled !== false;
  return true;
}

/** The video's headline: its first titled scene, else the project name. */
export function videoTitle(script: VideoScript | null, fallback: string): string {
  return script?.scenes.find((s) => s.title)?.title || fallback;
}

export function videoMeta(script: VideoScript | null, targetDuration: number): VideoMeta {
  if (!script) return { aspectKey: null, seconds: targetDuration, captions: null };
  const aspect = script.video.aspect;
  return {
    aspectKey: aspect ? ASPECT_LABEL[aspect] : null,
    seconds: Math.round(script.video.duration || targetDuration),
    captions: captionsOf(script),
  };
}
