/**
 * The one way every list screen shows things:
 *  - `IconAction`: a labelled icon button (screen header and row actions).
 *  - `SelectedItem`: the item being worked on, with all of its actions in
 *    one `ActionBar`.
 *  - `ItemRow`: one item of a list; picking it selects it, its own actions
 *    sit at the end of the row.
 * Presentational only — screens own the data and what each action does.
 */
import type { ComponentChildren } from "preact";
import { Card, Eyebrow } from "./controls";
import { Icon, type IconName } from "./Icon";

export type Tone = "doc" | "job" | "person" | "video";

export function IconAction({
  icon,
  label,
  onClick,
  busy,
  primary,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      class={`icon-btn ${primary ? "icon-btn-primary" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? <span class="spinner" aria-hidden="true" /> : <Icon name={icon} />}
    </button>
  );
}

/**
 * One action of the selected item: icon + label, and icon only when the
 * panel is narrow (the label stays its tooltip and accessible name).
 */
export function BarAction({
  icon,
  label,
  onClick,
  busy,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      class="btn btn-secondary btn-sm bar-action"
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? <span class="spinner" aria-hidden="true" /> : <Icon name={icon} />}
      <span class="bar-action-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

/** The selected item's `BarAction`s, side by side and equal width. */
export function ActionBar({ children }: { children: ComponentChildren }) {
  return <div class="action-bar">{children}</div>;
}

function ItemIcon({ icon, tone }: { icon: IconName; tone: Tone }) {
  return (
    <span class={`item-icon item-icon-${tone}`} aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}

export function SelectedItem({
  eyebrow,
  icon,
  tone,
  title,
  meta,
  actions,
  children,
}: {
  eyebrow: string;
  icon: IconName;
  tone: Tone;
  title: string;
  meta?: ComponentChildren;
  /** `BarAction`s. */
  actions: ComponentChildren;
  /** What an action opened (a check result, a preview, a status picker). */
  children?: ComponentChildren;
}) {
  return (
    <section class="stack-sm">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Card class="selected-item">
        <div class="item-head">
          <ItemIcon icon={icon} tone={tone} />
          <div class="item-text">
            <b class="item-title-lg">{title}</b>
            {meta ? <div class="item-meta">{meta}</div> : null}
          </div>
        </div>
        <ActionBar>{actions}</ActionBar>
        {children}
      </Card>
    </section>
  );
}

export function ItemRow({
  icon,
  tone,
  title,
  meta,
  selected,
  onSelect,
  selectLabel,
  actions,
  nested,
}: {
  icon: IconName;
  tone: Tone;
  title: string;
  meta?: ComponentChildren;
  selected?: boolean;
  /** Omit for rows that can't be selected. */
  onSelect?: () => void;
  /** What picking the row does, for screen readers ("Use this résumé"). */
  selectLabel?: string;
  /** `IconAction`s for this row. */
  actions?: ComponentChildren;
  /** A version under its master. */
  nested?: boolean;
}) {
  const body = (
    <>
      <ItemIcon icon={icon} tone={tone} />
      <span class="item-text">
        <span class="item-title">{title}</span>
        {meta ? <span class="item-meta">{meta}</span> : null}
      </span>
      {selected ? <Icon name="check" size={14} /> : null}
    </>
  );
  return (
    <div role="listitem" class={`item-row ${selected ? "on" : ""} ${nested ? "item-row-nested" : ""}`}>
      {onSelect ? (
        <button
          type="button"
          class="item-main"
          aria-current={selected || undefined}
          aria-label={selectLabel ? `${selectLabel}: ${title}` : undefined}
          onClick={onSelect}
        >
          {body}
        </button>
      ) : (
        <div class="item-main">{body}</div>
      )}
      {actions ? <div class="item-actions">{actions}</div> : null}
    </div>
  );
}

/** A bordered list of `ItemRow`s. */
export function ItemList({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="item-list" role="list" aria-label={label}>
      {children}
    </div>
  );
}

/** A list with nothing in it yet: why, and the one thing to do about it. */
export function EmptyState({ hint, children }: { hint: string; children?: ComponentChildren }) {
  return (
    <Card class="empty-state">
      <p class="muted small">{hint}</p>
      {children}
    </Card>
  );
}
