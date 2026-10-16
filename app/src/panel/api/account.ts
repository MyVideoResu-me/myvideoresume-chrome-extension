/** Account: who is signed in and whether they are on Pro. */
import { request } from "./http";
import type { UserRole } from "@shared/user-roles";

export type Me = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole | string;
  isGuest?: boolean;
};

export type Subscription = { isPro: boolean; planName?: string | null };

export function fetchMe(): Promise<Me> {
  return request<Me>("/api/auth/me");
}

export function fetchSubscription(): Promise<Subscription> {
  return request<Subscription>("/api/billing/subscription");
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}
