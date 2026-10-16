/** "Remind me to apply · Friday" on a tracked job that isn't applied yet. */
import type { Job } from "../../api/jobs";
import { reminderTime, remindersStore, setReminder } from "../../state/reminders";
import { useStore } from "../../state/store";
import { t, uiLocale } from "../../platform/i18n";
import { Chip } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";

/** The choices, in days from today (data, not branches). */
const IN_DAYS = [1, 3, 7] as const;

function dayLabel(at: number): string {
  const days = Math.round((at - reminderTime(0)) / 86_400_000);
  const date = new Date(at);
  return days < 7
    ? date.toLocaleDateString(uiLocale(), { weekday: "long" })
    : date.toLocaleDateString(uiLocale(), { weekday: "short", month: "short", day: "numeric" });
}

export function ReminderRow({ job }: { job: Job }) {
  const reminder = useStore(remindersStore, (s) => s.all[job.id] ?? null);
  const save = useAction((at: number | null) => setReminder(job.id, job.title, at));
  if (job.pipelineStatus && job.pipelineStatus !== "tracked") return null;

  const options = IN_DAYS.map((d) => reminderTime(d));
  const current = reminder && !options.includes(reminder.at) ? [reminder.at, ...options] : options;

  return (
    <>
      <label class="row small text-3">
        <Icon name="clock" />
        <span>{t("remind_label")}</span>
        {reminder?.due ? <Chip tone="warn">{t("remind_due")}</Chip> : null}
        <select
          class="select push-right"
          value={reminder ? String(reminder.at) : ""}
          disabled={save.busy}
          onChange={(e) => {
            const v = e.currentTarget.value;
            void save.run(v ? Number(v) : null);
          }}
        >
          <option value="">{t("remind_off")}</option>
          {current.map((at) => (
            <option key={at} value={String(at)}>
              {dayLabel(at)}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice error={save.error} />
    </>
  );
}
