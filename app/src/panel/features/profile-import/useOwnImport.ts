/**
 * Import MY profile into my master: read the page (Vendor Sync /import —
 * nothing saved), let me decide per item, then save as a new version or,
 * after an explicit confirm, onto the master (/execute).
 */
import { useState } from "preact/hooks";
import {
  buildBasicDecisions,
  buildNewItemDecisions,
  type BasicDecisions,
} from "@shared/resume-merge-decisions";
import {
  executeImport,
  fetchConnectors,
  importProfile,
  type ImportResult,
  type ProfileImport,
  type VendorConnector,
} from "../../api/profile-import";
import { connectorForUrl } from "../../domain/connectors";
import type { DetectedProfile } from "../../domain/entities";
import { finalImportDecisions, initialChoices, type MatchChoice } from "../../domain/merge-review";
import { capturePageHtml } from "../../platform/page-html";
import { loadResumes } from "../../state/resumes";
import { useAction } from "../../ui/useAction";

export class NoProfilePageError extends Error {}
export class UnsupportedSiteError extends Error {}

export type SaveMode = { createNew: true; newTitle: string } | { createNew: false };

export function useOwnImport(profile: DetectedProfile, masterId: string | null) {
  const [run, setRun] = useState<{ connector: VendorConnector; data: ProfileImport } | null>(null);
  const [choices, setChoices] = useState<MatchChoice[]>([]);
  const [newItems, setNewItems] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [basics, setBasics] = useState<BasicDecisions>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  const read = useAction(async () => {
    if (!masterId) return;
    const page = await capturePageHtml("profile");
    if (!page) throw new NoProfilePageError();
    const sourceUrl = page.url || profile.sourceUrl;
    const connector = connectorForUrl(sourceUrl, await fetchConnectors());
    if (!connector) throw new UnsupportedSiteError();
    const data = await importProfile(connector.id, { html: page.html, sourceUrl, targetResumeId: masterId });
    setRun({ connector, data });
    setChoices(initialChoices(data.analysis));
    setNewItems(buildNewItemDecisions(data.analysis));
    setBasics(buildBasicDecisions(data.analysis));
    setResult(null);
  });

  const save = useAction(async (mode: SaveMode) => {
    if (!run || !masterId) return;
    const out = await executeImport(run.connector.id, {
      syncRunId: run.data.syncRunId,
      sourceContent: run.data.sourceContent,
      targetResumeId: masterId,
      decisions: finalImportDecisions(run.data.analysis, choices, newItems),
      basicDecisions: basics,
      ...mode,
    });
    setResult(out);
    await loadResumes(true).catch(() => undefined);
  });

  const setChoice = (index: number, choice: MatchChoice) =>
    setChoices((prev) => prev.map((c, i) => (i === index ? choice : c)));
  const toggleNewItem = (key: string) =>
    setNewItems((prev) => new Map(prev).set(key, !prev.get(key)));
  const setBasic = (field: string, side: "source" | "target") => setBasics((prev) => ({ ...prev, [field]: side }));

  return {
    analysis: run?.data.analysis ?? null,
    connector: run?.connector ?? null,
    choices,
    newItems,
    basics,
    result,
    read,
    save,
    setChoice,
    toggleNewItem,
    setBasic,
  };
}

export type OwnImport = ReturnType<typeof useOwnImport>;
