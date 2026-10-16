/** Signed out: what the extension does + sign in (login.html handles every method). */
import { extensionUrl } from "../platform/chrome";
import { t } from "../platform/i18n";
import { Button } from "../ui/controls";
import { Icon, type IconName } from "../ui/Icon";

const POINTS: ReadonlyArray<{ icon: IconName; key: "signedOut_point1" | "signedOut_point2" | "signedOut_point3" }> = [
  { icon: "bookmark", key: "signedOut_point1" },
  { icon: "target", key: "signedOut_point2" },
  { icon: "video", key: "signedOut_point3" },
];

export function SignedOut() {
  return (
    <div class="signed-out">
      <h1 class="view-title">{t("signedOut_title")}</h1>
      <p class="muted">{t("signedOut_sub")}</p>
      <ul class="points">
        {POINTS.map((p) => (
          <li key={p.key}>
            <span class="point-icon">
              <Icon name={p.icon} />
            </span>
            {t(p.key)}
          </li>
        ))}
      </ul>
      <Button variant="primary" block onClick={() => (window.location.href = extensionUrl("login.html"))}>
        {t("signedOut_cta")}
      </Button>
    </div>
  );
}
