/**
 * Keep working on the page's entity while the person is in another tab
 * (rendering in Studio clears the page's detection). A different entity
 * of the same kind replaces it; nothing detected keeps the last one.
 */
import { useRef } from "preact/hooks";
import type { PageEntity } from "../../domain/entities";
import { pageStore } from "../../state/page";
import { useStore } from "../../state/store";

export function useStickyEntity<K extends PageEntity["kind"]>(kind: K): Extract<PageEntity, { kind: K }> | null {
  const live = useStore(pageStore, (s) => (s.entity?.kind === kind ? (s.entity as Extract<PageEntity, { kind: K }>) : null));
  const last = useRef(live);
  if (live) last.current = live;
  return last.current;
}
