/**
 * Explains a failed action in plain words, with the one thing to do next
 * (upgrade, sign in, try again). Renders nothing when there is no error.
 */
import type { ComponentChildren } from "preact";
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

/** Open the upgrade page (the API may hand back a relative or absolute URL). */
export function openUpgrade(url?: string | null): void {
  openTab(url && /^https?:\/\//.test(url) ? url : webUrl(url || "/pricing"));
}

export function ErrorNotice({ error, fallback }: { error: unknown; fallback?: MessageKey }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const kind = apiError?.kind ?? "server";
  const message = apiError ? t(KIND_MESSAGE[kind]) : t(fallback ?? "error_server");
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
