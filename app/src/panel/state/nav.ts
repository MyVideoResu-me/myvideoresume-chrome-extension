/** Which screen is showing (and which of its tabs), with a back stack. */
import { resolveRoute, type RouteName, type ScreenName, type ScreenTab } from "../domain/routes";
import { createStore } from "./store";

type Entry = { route: ScreenName; tab: ScreenTab | null };

export const navStore = createStore<{ route: ScreenName; tab: ScreenTab | null; stack: Entry[] }>({
  route: "home",
  tab: null,
  stack: [],
});

export function navigate(to: RouteName): void {
  const { screen, tab } = resolveRoute(to);
  const { route: current, tab: currentTab, stack } = navStore.get();
  if (screen === current) {
    if (tab && tab !== currentTab) navStore.set({ tab });
    return;
  }
  navStore.set({
    route: screen,
    tab,
    stack: screen === "home" ? [] : [...stack, { route: current, tab: currentTab }],
  });
}

/** Switch tabs on the current screen (not a back-stack step). */
export function setTab(tab: ScreenTab): void {
  navStore.set({ tab });
}

export function goBack(): void {
  const { stack } = navStore.get();
  const prev = stack[stack.length - 1] ?? { route: "home" as const, tab: null };
  navStore.set({ route: prev.route, tab: prev.tab, stack: stack.slice(0, -1) });
}
