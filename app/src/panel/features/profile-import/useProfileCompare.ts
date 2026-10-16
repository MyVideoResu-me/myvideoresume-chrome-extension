/**
 * Compare someone else's profile with my master and keep only what I
 * confirm: skills I have, a headline I wrote. Saved as a NEW VERSION of the
 * master — the master itself is never written here.
 */
import { useState } from "preact/hooks";
import type { ResumeContent } from "@shared/resume";
import { saveVersion } from "../../api/resumes";
import type { DetectedProfile } from "../../domain/entities";
import {
  applyConfirmedSuggestions,
  compareProfiles,
  hasConfirmedChanges,
  type ProfileComparison,
} from "../../domain/profile-compare";
import { loadResumes, resumeContent } from "../../state/resumes";
import { useAction } from "../../ui/useAction";
import { readProfileContent } from "./profile-text";

export function useProfileCompare(profile: DetectedProfile, masterId: string | null) {
  const [mine, setMine] = useState<ResumeContent | null>(null);
  const [comparison, setComparison] = useState<ProfileComparison | null>(null);
  const [skills, setSkills] = useState<ReadonlySet<string>>(new Set());
  const [headline, setHeadline] = useState("");
  const [saved, setSaved] = useState<{ resumeId: string; title: string } | null>(null);

  const read = useAction(async () => {
    if (!masterId) return;
    const [theirs, my] = await Promise.all([readProfileContent(profile.sourceUrl), resumeContent(masterId)]);
    setMine(my);
    setComparison(compareProfiles(my, theirs));
    setHeadline(my.basics?.label ?? "");
    setSkills(new Set());
    setSaved(null);
  });

  const confirmed = { skills: [...skills], headline };
  const changes = mine ? hasConfirmedChanges(mine, confirmed) : false;

  const save = useAction(async (title: string) => {
    if (!mine || !masterId || !changes) return;
    const out = await saveVersion(masterId, { content: applyConfirmedSuggestions(mine, confirmed), title });
    setSaved({ resumeId: out.resumeId, title: out.title });
    await loadResumes(true).catch(() => undefined);
  });

  const toggleSkill = (name: string) =>
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return { comparison, skills, toggleSkill, headline, setHeadline, changes, read, save, saved };
}

export type ProfileCompare = ReturnType<typeof useProfileCompare>;
