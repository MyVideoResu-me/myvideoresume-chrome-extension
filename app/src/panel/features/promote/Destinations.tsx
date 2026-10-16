/** "Post to": tick the connected accounts and the résumé page; a platform not connected yet offers Connect. */
import { socialPlatformMeta } from "@shared/social-platforms";
import { t } from "../../platform/i18n";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import type { useSocialPublish } from "../video/useSocialPublish";
import { RESUME_PAGE, type Destination } from "./usePromotePost";

type Social = ReturnType<typeof useSocialPublish>;

function Tick({ id, label, checked, done, onToggle }: { id: Destination; label: string; checked: boolean; done: boolean; onToggle: (d: Destination) => void }) {
  return (
    <label class={`dest ${checked ? "on" : ""}`}>
      {done ? <Icon name="check" size={14} /> : <input type="checkbox" checked={checked} onChange={() => onToggle(id)} />}
      <span class="dest-label">{label}</span>
    </label>
  );
}

export function Destinations({
  social,
  checked,
  onToggle,
  onResumePage,
  hasResume,
}: {
  social: Social;
  checked: ReadonlySet<Destination>;
  onToggle: (d: Destination) => void;
  onResumePage: boolean;
  hasResume: boolean;
}) {
  return (
    <fieldset class="stack-sm">
      <legend class="strong">{t("video_postTo")}</legend>
      <div class="dest-grid">
        {social.platforms.map((p) => {
          const label = socialPlatformMeta(p).label;
          const state = social.stateOf(p);
          return state === "notConnected" ? (
            <button key={p} type="button" class="dest dest-connect" onClick={() => void social.connect.run(p)}>
              <Icon name="link" size={14} />
              <span class="dest-label">{t("video_connect", { platform: label })}</span>
            </button>
          ) : (
            <Tick key={p} id={p} label={label} checked={checked.has(p)} done={state === "posted"} onToggle={onToggle} />
          );
        })}
        {hasResume ? (
          <Tick id={RESUME_PAGE} label={t("promote_resumePage")} checked={checked.has(RESUME_PAGE)} done={onResumePage} onToggle={onToggle} />
        ) : null}
      </div>
      <ErrorNotice error={social.connect.error} />
    </fieldset>
  );
}
