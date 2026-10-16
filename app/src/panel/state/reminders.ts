/**
 * "Remind me to apply · Friday". The API's saved jobs have no reminder
 * field, so a reminder is a chrome.alarms alarm + a row in local storage
 * ({ [jobId]: { at, title, due? } }). app/service-worker.js flags the row
 * `due` and shows "!" on the toolbar when the alarm fires (the extension
 * has no notifications permission); the job screen shows it.
 */
import { onStorageChange, sendToWorker, storageGet, storageSet } from "../platform/chrome";
import { createStore } from "./store";

/** Keep in step with app/service-worker.js. */
export const REMINDERS_KEY = "applyReminders";
const ALARM_PREFIX = "applyReminder:";

export type Reminder = { at: number; title: string; due?: boolean };
type Reminders = Record<string, Reminder>;

export const remindersStore = createStore<{ all: Reminders }>({ all: {} });

let started = false;

async function load(): Promise<void> {
  remindersStore.set({ all: (await storageGet<Reminders>(REMINDERS_KEY)) ?? {} });
}

/** Read the saved reminders once and follow changes (the worker flags them due). */
export function startReminders(): void {
  if (started) return;
  started = true;
  void load();
  onStorageChange(REMINDERS_KEY, (value) => remindersStore.set({ all: (value as Reminders | undefined) ?? {} }));
}

async function write(all: Reminders): Promise<void> {
  remindersStore.set({ all });
  await storageSet({ [REMINDERS_KEY]: all });
}

/** `at` = when to remind (ms epoch); null clears it. */
export async function setReminder(jobId: string, title: string, at: number | null): Promise<void> {
  const all = { ...remindersStore.get().all };
  await chrome.alarms.clear(ALARM_PREFIX + jobId);
  if (at === null) {
    const wasDue = all[jobId]?.due;
    delete all[jobId];
    if (wasDue) void sendToWorker({ action: "clearReminderBadge" });
  } else {
    all[jobId] = { at, title };
    await chrome.alarms.create(ALARM_PREFIX + jobId, { when: at });
  }
  await write(all);
}

/** Morning (9:00 local) `days` from today. */
export function reminderTime(days: number, now = new Date()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}
