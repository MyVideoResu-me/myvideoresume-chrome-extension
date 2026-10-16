/**
 * Profile → my résumé.
 *   Own profile: Vendor Sync. /import reads the page into a merge analysis
 *     against my master (nothing saved); /execute applies the decisions I
 *     made, as a new version or onto the master.
 *   Someone else's profile: /api/resumes/parse turns the visible text into
 *     résumé content (nothing saved) so the panel can compare it with mine.
 */
import type { BasicDecisions, MergeAnalysis, MergeDecision } from "@shared/resume-merge-decisions";
import type { ResumeContent } from "@shared/resume";
import { request } from "./http";

export type VendorConnector = {
  id: string;
  label: string;
  editProfileUrl: string;
  supportsExtensionExtract: boolean;
};

let connectorsCache: Promise<VendorConnector[]> | null = null;

/** The vendors the platform can import from (cached per panel session). */
export function fetchConnectors(): Promise<VendorConnector[]> {
  if (!connectorsCache) {
    connectorsCache = request<{ connectors?: VendorConnector[] }>("/api/vendor-sync/connectors").then(
      (out) => out.connectors ?? [],
    );
    connectorsCache.catch(() => (connectorsCache = null));
  }
  return connectorsCache;
}

export type ProfileImport = {
  syncRunId: string;
  /** The profile as résumé content — sent back unchanged to /execute. */
  sourceContent: Record<string, unknown>;
  targetContent: Record<string, unknown>;
  analysis: MergeAnalysis;
};

export function importProfile(
  connectorId: string,
  input: { html: string; sourceUrl: string; targetResumeId: string },
): Promise<ProfileImport> {
  return request<ProfileImport>(`/api/vendor-sync/${encodeURIComponent(connectorId)}/import`, {
    method: "POST",
    body: input,
  });
}

export type ImportResult = {
  resumeId: string;
  title: string;
  mergedSections: number;
  skippedSections: number;
  newSections: number;
};

export function executeImport(
  connectorId: string,
  input: {
    syncRunId: string;
    sourceContent: Record<string, unknown>;
    targetResumeId: string;
    decisions: MergeDecision[];
    basicDecisions: BasicDecisions;
  } & ({ createNew: true; newTitle: string } | { createNew: false }),
): Promise<ImportResult> {
  return request<ImportResult>(`/api/vendor-sync/${encodeURIComponent(connectorId)}/execute`, {
    method: "POST",
    body: input,
  });
}

/** Visible profile text → résumé content. The API answers with a JSON string. */
export async function parseProfileText(text: string): Promise<ResumeContent> {
  const out = await request<{ result?: string | Record<string, unknown> }>("/api/resumes/parse", {
    method: "POST",
    body: { content: text },
  });
  const raw = out.result;
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return (parsed && typeof parsed === "object" ? parsed : {}) as ResumeContent;
}
