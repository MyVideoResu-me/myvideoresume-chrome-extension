/**
 * The job's headline facts as chips: where (location / remote), how
 * (employment type), pay, and the site it came from. Pure; a fact the
 * job doesn't state is left out.
 */
import type { Job } from "../../api/jobs";
import { t, uiLocale, type MessageKey } from "../../platform/i18n";

type JobFacts = Pick<Job, "location" | "sourceUrl"> &
  Partial<Pick<Job, "employmentType" | "workSetting" | "salaryMin" | "salaryMax" | "salaryCurrency">>;

const WORK_SETTING_LABEL: Partial<Record<string, MessageKey>> = {
  remote: "job_remote",
  hybrid: "job_hybrid",
};

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function salary(job: JobFacts): string {
  const { salaryMin: min, salaryMax: max } = job;
  if (!min && !max) return "";
  try {
    const fmt = new Intl.NumberFormat(uiLocale(), {
      style: "currency",
      currency: job.salaryCurrency || "USD",
      notation: "compact",
      maximumFractionDigits: 0,
    });
    return min && max && min !== max ? `${fmt.format(min)}–${fmt.format(max)}` : fmt.format((min || max)!);
  } catch {
    return "";
  }
}

export function jobMetaChips(job: JobFacts): string[] {
  const settingKey = job.workSetting ? WORK_SETTING_LABEL[job.workSetting] : undefined;
  const setting = settingKey ? t(settingKey) : "";
  const where =
    setting && job.location && !job.location.toLowerCase().includes(setting.toLowerCase())
      ? `${setting} (${job.location})`
      : job.location || setting;
  return [where, job.employmentType ?? "", salary(job), siteOf(job.sourceUrl)].filter(Boolean);
}

/** The company's initial for its tile. */
export function companyInitial(company: string): string {
  return (company.trim()[0] ?? "").toUpperCase();
}
