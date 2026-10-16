/**
 * Ask the candidate before a public post: their email (fixed to the
 * talent-pool row's when it has one, else prefilled when known) and an
 * optional note → an approval request. Then the request's status, with
 * Resend while it's unanswered — or, once the server refused an approval
 * (withdrawn, or the video changed), the form again with why.
 */
import { useState } from "preact/hooks";
import { ASK_AGAIN_MESSAGE, CONSENT_STATUS_VIEW, canResend, isEmail } from "../../domain/consent";
import { t } from "../../platform/i18n";
import { Button, Chip, TextArea } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import type { ConsentState } from "./useConsent";

/** The current request's status — or "Ask again" once the server refused it. */
export function ConsentPill({ consent, askAgain = false }: { consent: ConsentState["current"]; askAgain?: boolean }) {
  if (askAgain) return <Chip tone="warn">{t("consent_askAgain")}</Chip>;
  if (!consent) return null;
  const view = CONSENT_STATUS_VIEW[consent.status];
  return <Chip tone={view.tone}>{t(view.labelKey)}</Chip>;
}

export function ConsentPanel({
  consent,
  name,
  poolEmail,
  defaultEmail,
  hasProject,
  poolKnown,
}: {
  consent: ConsentState;
  name: string;
  /** The talent-pool row's email — when set, the request can only go there (the server rejects any other). */
  poolEmail: string | null;
  defaultEmail: string | null;
  hasProject: boolean;
  /** The talent-pool row is known — the server can fill a missing email from it. */
  poolKnown: boolean;
}) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [note, setNote] = useState("");
  const { current, askAgain } = consent;

  if (!hasProject) return <p class="muted small consent-box">{t("consent_needProject")}</p>;
  if (!consent.loaded) return null;

  if (current && !askAgain) {
    return (
      <div class="consent-box stack-sm" role="status">
        <div class="row between wrap">
          <span class="small">{t("consent_sentTo", { email: current.candidateEmail })}</span>
          <ConsentPill consent={current} />
        </div>
        {current.status === "approved" ? <p class="small text-ok">{t("consent_approvedHint", { name })}</p> : null}
        {canResend(current) ? (
          <Button size="sm" busy={consent.resend.busy} onClick={() => void consent.resend.run()}>
            {t("consent_resend")}
          </Button>
        ) : null}
        <ErrorNotice error={consent.resend.error} />
      </div>
    );
  }

  const to = poolEmail ?? email;
  const valid = poolEmail ? true : isEmail(email) || (poolKnown && !email.trim());
  return (
    <form
      class="consent-box stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void consent.ask.run(to, note);
      }}
    >
      {askAgain ? (
        <p class="small text-warn" role="alert">
          {t(ASK_AGAIN_MESSAGE[askAgain])}
        </p>
      ) : null}
      <p class="small">{t("consent_explain", { name })}</p>
      <div class="field">
        <label for="consent-email" class="field-label">
          {t("consent_email")}
        </label>
        {poolEmail ? (
          <>
            <input id="consent-email" class="input" type="email" value={poolEmail} readOnly aria-describedby="consent-email-hint" />
            <span id="consent-email-hint" class="muted small">
              {t("consent_emailFromPool")}
            </span>
          </>
        ) : (
          <input
            id="consent-email"
            class="input"
            type="email"
            autocomplete="off"
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        )}
      </div>
      <TextArea id="consent-note" label={t("consent_note")} rows={3} value={note} onInput={setNote} />
      <Button type="submit" variant="primary" block busy={consent.ask.busy} disabled={!valid}>
        {askAgain ? t("consent_askAgain") : t("consent_send")}
      </Button>
      <ErrorNotice error={consent.ask.error} />
    </form>
  );
}
