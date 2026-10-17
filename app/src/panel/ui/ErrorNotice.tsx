/**
 * Explains a failed action in plain words, with the one thing to do next
 * (upgrade, sign in, try again). Renders nothing when there is no error.
 */
import type { ComponentChildren } from "preact";
import { CANDIDATE_CONSENT_REQUIRED_CODE } from "@shared/candidate-video-consent";
import { ApiError } from "../api/http";
import { webUrl } from "../platform/config";
import { openTab } from "../platform/chrome";
import { t, type MessageKey } from "../platform/i18n";
import { Button } from "./controls";
import { Icon } from "./Icon";

const KIND_MESSAGE: Record<ApiError["kind"], MessageKey> = {
  auth: "error_auth",
  pro: "error_pro",
  limit: "error_limit",
  notFound: "error_notFound",
  conflict: "error_conflict",
  invalid: "error_invalid",
  network: "error_network",
  server: "error_server",
};

/** Codes with their own explanation (checked before the kind). */
const CODE_MESSAGE: Readonly<Record<string, MessageKey>> = {
  CONSENT_EMAIL_MISMATCH: "error_consentEmailMismatch",
  CONSENT_EMAIL_NOT_ALLOWED: "error_consentEmailNotAllowed",
  // A candidate video the candidate hasn't approved (or that changed since).
  [CANDIDATE_CONSENT_REQUIRED_CODE]: "error_consentRequired",
};

/** Open the upgrade page (the API may hand back a relative or absolute URL). */
export function openUpgrade(url?: string | null): void {
  openTab(url && /^https?:\/\//.test(url) ? url : webUrl(url || "/pricing"));
}

export function ErrorNotice({ error, fallback }: { error: unknown; fallback?: MessageKey }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const kind = apiError?.kind ?? "server";
  const codeKey = apiError ? CODE_MESSAGE[apiError.code] : undefined;
  const message = t(codeKey ?? (apiError ? KIND_MESSAGE[kind] : (fallback ?? "error_server")));
  const showUpgrade = kind === "pro" || kind === "limit";
  return (
    <div class="notice notice-error" role="alert">
      <Icon name="alert" />
      <div class="notice-body">
        <div>{message}</div>
        {showUpgrade ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => openUpgrade(apiError?.upgradeUrl)}
          >
            {t("common_upgrade")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function InfoNotice({ children }: { children: ComponentChildren }) {
  return (
    <div class="notice notice-info" role="status">
      <Icon name="check" />
      <div class="notice-body">{children}</div>
    </div>
  );
}
