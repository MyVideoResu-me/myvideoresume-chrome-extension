/** Presentational controls. Styling lives in sidepanel.css → styles/*.css (theme tokens in styles/tokens.css). */
import type { ComponentChildren, JSX } from "preact";
import { useIsPro } from "../state/session";
import { t } from "../platform/i18n";
import { Icon, type IconName } from "./Icon";

type ButtonProps = {
  variant?: "primary" | "promote" | "secondary" | "ghost";
  size?: "md" | "sm";
  icon?: IconName;
  iconAfter?: IconName;
  busy?: boolean;
  block?: boolean;
  /** Secondary button with the promote (video) accent text. */
  accent?: "promote";
  disabled?: boolean;
  /** "submit" for a form's primary button; plain "button" otherwise. */
  type?: "button" | "submit";
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, "size" | "icon" | "class" | "className" | "type">;

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  busy,
  block,
  accent,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", block ? "btn-block" : "", accent ? `text-${accent}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} class={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span class="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconAfter && !busy ? <Icon name={iconAfter} /> : null}
    </button>
  );
}

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "primary" | "pro";
  children: ComponentChildren;
}) {
  return <span class={`chip chip-${tone}`}>{children}</span>;
}

export function Card({ children, class: extra }: { children: ComponentChildren; class?: string }) {
  return <section class={`card ${extra ?? ""}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: ComponentChildren }) {
  return <div class="eyebrow">{children}</div>;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  /** null = none of the options is current. */
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  label,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Meter({ value, label, ghost }: { value: number; label: string; ghost?: number }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <div class="meter" role="img" aria-label={label}>
      {ghost != null ? <span class="meter-ghost" style={{ width: `${clamp(ghost)}%` }} /> : null}
      <span class="meter-fill" style={{ width: `${clamp(value)}%` }} />
    </div>
  );
}

export function TextArea({
  id,
  label,
  value,
  rows = 6,
  onInput,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  rows?: number;
  onInput: (v: string) => void;
  hint?: ComponentChildren;
}) {
  return (
    <div class="field">
      <label for={id} class="field-label">
        {label}
      </label>
      <textarea id={id} class="textarea" rows={rows} value={value} onInput={(e) => onInput(e.currentTarget.value)} />
      {hint ? <div class="field-hint">{hint}</div> : null}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onInput,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div class="field">
      <label for={id} class="field-label small">
        {label}
      </label>
      <input
        id={id}
        class="input"
        type="text"
        value={value}
        placeholder={placeholder}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </div>
  );
}

/** The inline "Pro" badge — shows for free accounts only. */
export function ProBadge() {
  return useIsPro() ? null : <Chip tone="pro">{t("common_pro")}</Chip>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
