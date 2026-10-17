/** What every "My content" tab is given: the header to render, with its own key actions. */
import type { ComponentChildren, JSX } from "preact";

export type ContentTabProps = { header: (actions: ComponentChildren) => JSX.Element };
