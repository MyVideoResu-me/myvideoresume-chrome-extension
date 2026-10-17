/**
 * The side panel: header, the current screen, and the pair tray. Screens
 * come from the route registry below — a new screen is a new entry.
 */
import type { ComponentType } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ScreenName } from "../domain/routes";
import { navStore } from "../state/nav";
import { recheckProIfStale, refreshSession, sessionStore } from "../state/session";
import { useStore } from "../state/store";
import { startUser } from "../state/user-reset";
import { t } from "../platform/i18n";
import { Button, Spinner } from "../ui/controls";
import { AnalyticsView } from "../features/analytics/AnalyticsView";
import { CandidateView } from "../features/candidate/CandidateView";
import { CandidateVideoView } from "../features/candidate/CandidateVideoView";
import { ContentView } from "../features/content/ContentView";
import { HomeView } from "../features/home/HomeView";
import { JobView } from "../features/job/JobView";
import { TargetView } from "../features/job/TargetView";
import { OutreachView } from "../features/outreach/OutreachView";
import { PostReplyView } from "../features/post/PostReplyView";
import { ProfileImportView } from "../features/profile-import/ProfileImportView";
import { PromoteView } from "../features/promote/PromoteView";
import { ProspectView } from "../features/prospect/ProspectView";
import { SettingsView } from "../features/settings/SettingsView";
import { StrengthenView } from "../features/strengthen/StrengthenView";
import { AppHeader } from "./AppHeader";
import { PairTray } from "./PairTray";
import { SignedOut } from "./SignedOut";

const SCREENS: Record<ScreenName, ComponentType> = {
  home: HomeView,
  job: JobView,
  strengthen: StrengthenView,
  target: TargetView,
  promote: PromoteView,
  candidate: CandidateView,
  outreach: OutreachView,
  candidateVideo: CandidateVideoView,
  prospect: ProspectView,
  postReply: PostReplyView,
  content: ContentView,
  analytics: AnalyticsView,
  settings: SettingsView,
  profileImport: ProfileImportView,
};

/** Screens that are lists, not pair work — no pair tray. */
const NO_TRAY: ReadonlySet<ScreenName> = new Set(["content", "analytics", "settings"]);

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
