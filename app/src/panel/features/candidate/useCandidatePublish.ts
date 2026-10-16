/**
 * Going public with a candidate video — only after the candidate approved.
 * Make the project public, then post it to the recruiter's connected
 * accounts. The server enforces consent too: a 403 CONSENT_REQUIRED from
 * either step is handed to `onRefused` (which re-reads consent and asks
 * again) and cleared here, so the screen never sticks on a stale error.
 */
import { useEffect, useState } from "preact/hooks";
import { setProjectVisibility } from "../../api/studio";
import { consentRefusal, type AskAgainReason } from "../../domain/consent";
import { useAction } from "../../ui/useAction";
import { useSocialPublish } from "../video/useSocialPublish";

export function useCandidatePublish(projectId: string | null, title: string, onRefused: (reason: AskAgainReason) => void) {
  const [isPublic, setIsPublic] = useState(false);
  const social = useSocialPublish(projectId, title);

  const makePublic = useAction(async () => {
    if (!projectId) return;
    await setProjectVisibility(projectId, true);
    setIsPublic(true);
  });

  useEffect(() => {
    for (const action of [makePublic, social.post]) {
      const reason = consentRefusal(action.error);
      if (!reason) continue;
      action.clearError();
      onRefused(reason);
    }
  }, [makePublic.error, social.post.error]);

  return { isPublic, makePublic, social };
}

export type CandidatePublish = ReturnType<typeof useCandidatePublish>;
