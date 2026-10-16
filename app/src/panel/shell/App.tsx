/**
 * The side panel: header, the current screen, and the pair tray. Screens
 * come from the route registry below — a new screen is a new entry.
 */
import type { ComponentType } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { RouteName } from "../domain/routes";
import { navStore } from "../state/nav";
import { recheckProIfStale, refreshSession, sessionStore } from "../state/session";
import { useStore } from "../state/store";
import { startUser } from "../state/user-reset";
import { t } from "../platform/i18n";
import { Button, Spinner } from "../ui/controls";
import { ApplyView } from "../features/apply/ApplyView";
import { CandidateView } from "../features/candidate/CandidateView";
import { CandidateVideoView } from "../features/candidate/CandidateVideoView";
import { CoverLetterView } from "../features/cover/CoverLetterView";
import { HomeView } from "../features/home/HomeView";
import { JobView } from "../features/job/JobView";
import { OutreachView } from "../features/outreach/OutreachView";
import { PipelineView } from "../features/pipeline/PipelineView";
import { PostReplyView } from "../features/post/PostReplyView";
import { PromoteView } from "../features/promote/PromoteView";
import { ProspectView } from "../features/prospect/ProspectView";
import { ResumesView } from "../features/resumes/ResumesView";
import { StrengthenView } from "../features/strengthen/StrengthenView";
import { AccountMenu } from "./AccountMenu";
import { LensMenu } from "./LensMenu";
import { PairTray } from "./PairTray";
import { SignedOut } from "./SignedOut";

const SCREENS: Record<RouteName, ComponentType> = {
  home: HomeView,
  job: JobView,
  strengthen: StrengthenView,
  coverLetter: CoverLetterView,
  apply: ApplyView,
  promote: PromoteView,
  candidate: CandidateView,
  outreach: OutreachView,
  candidateVideo: CandidateVideoView,
  prospect: ProspectView,
  postReply: PostReplyView,
  pipeline: PipelineView,
  resumes: ResumesView,
};

/** Screens that are lists, not pair work — no pair tray. */
const NO_TRAY: ReadonlySet<RouteName> = new Set(["pipeline", "resumes"]);

function AppHeader() {
  return (
    <header class="app-header">
      <span class="logo" aria-hidden="true">
        h
      </span>
      <span class="brand">hired.video</span>
      <LensMenu />
      <AccountMenu />
    </header>
  );
}

export function App() {
  const session = useStore(sessionStore, (s) => s.session);
  const route = useStore(navStore, (s) => s.route);
  const userId = session.status === "signedIn" ? session.me.id : null;

  const prevUser = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    void startUser(userId, prevUser.current !== null && prevUser.current !== userId);
    prevUser.current = userId;
  }, [userId]);

  // Back from upgrading in another tab → re-read Pro.
  useEffect(() => {
    window.addEventListener("focus", recheckProIfStale);
    return () => window.removeEventListener("focus", recheckProIfStale);
  }, []);

  if (session.status === "loading") {
    return (
      <main class="app">
        <AppHeader />
        <Spinner label={t("common_loading")} />
      </main>
    );
  }
  if (session.status === "offline") {
    return (
      <main class="app">
        <AppHeader />
        <div class="view-body">
          <p class="small">{t("error_network")}</p>
          <Button variant="primary" onClick={refreshSession}>
            {t("common_retry")}
          </Button>
        </div>
      </main>
    );
  }
  if (session.status === "signedOut") {
    return (
      <main class="app">
        <AppHeader />
        <SignedOut />
      </main>
    );
  }

  const Screen = SCREENS[route];
  return (
    <main class="app">
      {route === "home" ? <AppHeader /> : null}
      <div class="screen">
        <Screen />
      </div>
      {NO_TRAY.has(route) ? null : <PairTray />}
    </main>
  );
}
