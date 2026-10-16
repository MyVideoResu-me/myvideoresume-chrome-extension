/**
 * Job seeker · Strengthen: a profile page → a better résumé.
 *   My own profile   → import it into my master (review each item; save as a
 *                      new version, or onto the master after a confirm).
 *   Someone else's   → compare with my master, as suggestions I confirm;
 *                      saved as a new version. Their facts are never copied.
 * Whose profile it is is guessed from my name; I can switch it — but
 * calling a profile guessed as someone else's "mine" takes an explicit
 * "This is my profile" tick, and even then it only saves as a new version:
 * the master is updated only from a profile known to be mine.
 */
import { useState } from "preact/hooks";
import type { DetectedProfile } from "../../domain/entities";
import { initialsOf } from "../../domain/profile-owner";
import { t } from "../../platform/i18n";
import { resumesStore } from "../../state/resumes";
import { useIsOwnProfile } from "../../state/own-profile";
import { useStore } from "../../state/store";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { Card, Segmented, Spinner } from "../../ui/controls";
import { useStickyEntity } from "../message/useStickyEntity";
import { NeedsResume } from "../resumes/NeedsResume";
import { OwnImport } from "./OwnImport";
import { ProfileCompare } from "./ProfileCompare";
import { useMasterResume } from "./useMasterResume";
import { useOwnImport } from "./useOwnImport";
import { useProfileCompare } from "./useProfileCompare";

type Whose = "mine" | "theirs";

function ImportFlow({ profile, masterId, masterTitle }: { profile: DetectedProfile; masterId: string; masterTitle: string }) {
  const ownProfile = useIsOwnProfile(profile);
  const [whose, setWhose] = useState<Whose>(() => (ownProfile ? "mine" : "theirs"));
  /** "This is my profile" — required before a profile not known to be mine imports as mine. */
  const [claimed, setClaimed] = useState(false);
  const mineReady = whose === "mine" && (ownProfile || claimed);
  const own = useOwnImport(profile, masterId);
  const compare = useProfileCompare(profile, masterId);
  const name = profile.name.split(/\s+/)[0] || profile.name;

  return (
    <>
      <ViewHeader
        title={whose === "mine" ? t("action_profileImportOwn") : t("action_profileImprove")}
        subtitle={t("import_into", { title: masterTitle })}
      />
      <div class="view-body view-body-head">
        <Card>
          <div class="detected-row">
            <span class="avatar-lg" aria-hidden="true">
              {initialsOf(profile.name)}
            </span>
            <div class="detected-text">
              <div class="detected-title">{profile.name}</div>
              <div class="muted small">{[profile.title, profile.company].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          <Segmented
            label={t("import_whose")}
            value={whose}
            options={[
              { value: "mine", label: t("import_whoseMine") },
              { value: "theirs", label: t("import_whoseTheirs") },
            ]}
            onChange={(next) => {
              setWhose(next);
              if (next === "theirs") setClaimed(false);
            }}
          />
          {whose === "mine" && !ownProfile ? (
            <label class="row small align-start">
              <input type="checkbox" checked={claimed} onChange={(e) => setClaimed(e.currentTarget.checked)} />
              <span>
                <span class="strong">{t("import_claimMine")}</span>
                <span class="muted"> — {t("import_claimMineHint")}</span>
              </span>
            </label>
          ) : null}
        </Card>
      </div>
      {whose === "theirs" ? (
        <ProfileCompare compare={compare} masterId={masterId} name={name} />
      ) : mineReady ? (
        <OwnImport review={own} masterTitle={masterTitle} allowMaster={ownProfile} />
      ) : null}
    </>
  );
}

export function ProfileImportView() {
  const profile = useStickyEntity("profile");
  const master = useMasterResume();
  const resumesLoaded = useStore(resumesStore, (s) => s.loaded);

  if (!profile) return <EmptyView title={t("action_profileImprove")}>{t("import_needProfile")}</EmptyView>;
  if (!master) {
    return (
      <EmptyView title={t("action_profileImprove")}>
        {resumesLoaded ? <NeedsResume /> : <Spinner label={t("common_loading")} />}
      </EmptyView>
    );
  }
  return <ImportFlow key={`${profile.sourceUrl}|${master.id}`} profile={profile} masterId={master.id} masterTitle={master.title} />;
}
