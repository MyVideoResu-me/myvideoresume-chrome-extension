/** A labelled set of radio cards (title + one-line hint each). Options are data. */
import type { ComponentChildren } from "preact";

export type RadioCardOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  /** Shown at the right of the title (a status pill, a Pro badge). */
  badge?: ComponentChildren;
};

export function RadioCards<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: ReadonlyArray<RadioCardOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="stack-sm">
      <legend class="strong radio-legend">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} class={`radio-card ${o.value === value ? "on" : ""}`}>
          <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span class="radio-card-body">
            <span class="row between">
              <b>{o.label}</b>
              {o.badge}
            </span>
            {o.hint ? <small>{o.hint}</small> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
