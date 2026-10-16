/** Is this detected profile the signed-in user's own? (labels + the import flow). */
import type { PageEntity } from "../domain/entities";
import { isOwnProfile } from "../domain/profile-owner";
import { sessionStore } from "./session";
import { useStore } from "./store";

export function useIsOwnProfile(entity: PageEntity | null): boolean {
  const me = useStore(sessionStore, (s) => (s.session.status === "signedIn" ? s.session.me : null));
  return entity?.kind === "profile" && isOwnProfile(entity, me);
}
