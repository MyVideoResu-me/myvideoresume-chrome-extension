/** The search box of a list — only once the list is long enough to need one. */
import { t } from "../platform/i18n";
import { TextField } from "./controls";

/** Lists longer than this get a search box. */
export const SEARCH_AFTER = 5;

export function ListSearch({ id, count, value, onInput }: { id: string; count: number; value: string; onInput: (v: string) => void }) {
  if (count <= SEARCH_AFTER) return null;
  return <TextField id={id} label={t("content_search")} value={value} onInput={onInput} placeholder={t("content_searchHint")} />;
}
