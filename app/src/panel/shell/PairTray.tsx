/**
 * "Working on: A + B" — the pair every action uses. The recruiter lens
 * pairs a candidate with a job; the others pair what's on the page with
 * the person's own résumé.
 */
import { entityTitle, type EntityKind } from "../domain/entities";
import { useLens } from "../state/lens";
import { navigate } from "../state/nav";
import { pageStore } from "../state/page";
import { pairStore } from "../state/pair";
import { activeResume, resumesStore } from "../state/resumes";
import { useStore } from "../state/store";
import { t } from "../platform/i18n";
import { Icon, type IconName } from "../ui/Icon";

type Tone = "job" | "person" | "doc";
type Slot = { icon: IconName; tone: Tone; label: string; onClick?: () => void } | null;

const ENTITY_SLOT: Record<EntityKind, { icon: IconName; tone: Tone }> = {
  job: { icon: "briefcase", tone: "job" },
  profile: { icon: "user", tone: "person" },
  post: { icon: "message", tone: "person" },
};

function SlotView({ slot, emptyLabel }: { slot: Slot; emptyLabel: string }) {
  if (!slot) return <div class="pair-slot pair-empty">{emptyLabel}</div>;
  const body = (
    <>
      <span class={`pair-icon pair-${slot.tone}`}>
        <Icon name={slot.icon} size={14} />
      </span>
      <span class="pair-label">{slot.label}</span>
    </>
  );
  return slot.onClick ? (
    <button type="button" class="pair-slot" onClick={slot.onClick}>
      {body}
    </button>
  ) : (
    <div class="pair-slot">{body}</div>
  );
}

export function PairTray() {
  const lens = useLens();
  const entity = useStore(pageStore, (s) => s.entity);
  const pair = useStore(pairStore, (s) => s);
  const resume = useStore(resumesStore, activeResume);

  const resumeSlot: Slot = resume
    ? { icon: "file", tone: "doc", label: resume.title, onClick: () => navigate("resumes") }
    : null;

  let left: Slot;
  let right: Slot;
  if (lens.pairing === "candidateAndJob") {
    left = pair.candidate ? { icon: "user", tone: "person", label: pair.candidate.profile.name } : null;
    right = pair.job ? { icon: "briefcase", tone: "job", label: pair.job.title } : null;
  } else {
    const job = pair.job;
    left = entity
      ? { ...ENTITY_SLOT[entity.kind], label: entityTitle(entity) }
      : job
        ? { icon: "briefcase", tone: "job", label: job.title }
        : null;
    right = resumeSlot;
  }
  if (!left && !right) return null;

  return (
    <footer class="pair" aria-label={t("pair_label")}>
      <div class="pair-caption">{t("pair_label")}</div>
      <div class="pair-row">
        <SlotView slot={left} emptyLabel={t("pair_emptyPage")} />
        <span class="pair-plus" aria-hidden="true">
          +
        </span>
        <SlotView slot={right} emptyLabel={lens.pairing === "candidateAndJob" ? t("pair_emptyJob") : t("pair_emptyResume")} />
      </div>
    </footer>
  );
}
