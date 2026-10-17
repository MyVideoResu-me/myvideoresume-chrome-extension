/** Deep links into the hired.video web app (one place for every route the panel opens). */
import { publicJobPath, publicVideoPath } from "@shared/public-paths";
import { webUrl } from "./config";

export const studioResumeUrl = (resumeId: string): string => webUrl(`/studio/resume/${encodeURIComponent(resumeId)}`);

export const studioProjectUrl = (projectId: string): string => webUrl(`/studio/${encodeURIComponent(projectId)}`);

/** The public watch page for a video (plays once it is published or public). */
export const videoWatchUrl = (slugOrId: string): string => webUrl(publicVideoPath(slugOrId));

/** The web app's home. */
export const webHomeUrl = (): string => webUrl("/");

/** The person's job pipeline on the web. */
export const webJobsUrl = (): string => webUrl("/jobs");

/** The person's résumés on the web. */
export const webResumesUrl = (): string => webUrl("/resumes");

/** A job's public page. */
export const publicJobUrl = (jobId: string): string => webUrl(publicJobPath(jobId));

/** The web Studio home (every project). */
export const webStudioUrl = (): string => webUrl("/studio");

/** The web settings page (the same settings the panel edits). */
export const webSettingsUrl = (): string => webUrl("/settings");

/** The recruiter's talent pool on the web. */
export const webTalentPoolUrl = (): string => webUrl("/resumes?tab=sourced");

/** One talent-pool candidate on the web. */
export const webCandidateUrl = (talentPoolId: string): string => webUrl(`/services/candidates/${encodeURIComponent(talentPoolId)}`);
