/** Copy text for one item of a list, and say so on its button for a moment. */
import { useEffect, useState } from "preact/hooks";
import { copyText } from "../platform/chrome";

const SHOW_MS = 1800;

export function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedKey) return;
    const id = setTimeout(() => setCopiedKey(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [copiedKey]);
  const copy = async (key: string, text: string | Promise<string>) => {
    if (await copyText(await text)) setCopiedKey(key);
  };
  return { copy, copiedKey };
}
