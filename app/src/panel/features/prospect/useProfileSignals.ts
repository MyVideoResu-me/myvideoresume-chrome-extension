/** A few specifics from the prospect's profile for the pitch (read once per profile). */
import { useEffect, useState } from "preact/hooks";
import type { DetectedProfile } from "../../domain/entities";
import { profileSignals } from "../../domain/profile-signals";
import { readProfileContent } from "../profile-import/profile-text";

export function useProfileSignals(prospect: DetectedProfile): { signals: string[]; loading: boolean } {
  const [signals, setSignals] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    setSignals(null);
    readProfileContent(prospect.sourceUrl)
      .then((content) => live && setSignals(profileSignals(content, prospect)))
      .catch(() => live && setSignals(profileSignals(null, prospect)));
    return () => {
      live = false;
    };
  }, [prospect.sourceUrl]);
  return { signals: signals ?? [], loading: signals === null };
}
