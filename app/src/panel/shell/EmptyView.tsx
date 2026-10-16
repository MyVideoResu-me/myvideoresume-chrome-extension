/** A flow screen that can't start yet: its header + what's missing. */
import type { ComponentChildren } from "preact";
import { Card } from "../ui/controls";
import { ViewHeader } from "./ViewHeader";

export function EmptyView({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <>
      <ViewHeader title={title} />
      <div class="view-body">{typeof children === "string" ? <Card><p class="small">{children}</p></Card> : children}</div>
    </>
  );
}
