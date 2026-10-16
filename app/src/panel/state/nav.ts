/** Which screen is showing, with a back stack. */
import type { RouteName } from "../domain/routes";
import { createStore } from "./store";

export const navStore = createStore<{ route: RouteName; stack: RouteName[] }>({ route: "home", stack: [] });

export function navigate(route: RouteName): void {
  const { route: current, stack } = navStore.get();
  if (route === current) return;
  navStore.set({ route, stack: route === "home" ? [] : [...stack, current] });
}

export function goBack(): void {
  const { stack } = navStore.get();
  const prev = stack[stack.length - 1] ?? "home";
  navStore.set({ route: prev, stack: stack.slice(0, -1) });
}
