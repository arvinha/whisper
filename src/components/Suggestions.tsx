"use client";

import { useState } from "react";
import { fromSummary, remindAt, toCalendarEvent, toLocal, type NewAgendaItem } from "@/lib/client/agenda";
import { useT } from "@/lib/client/i18n";
import type { Dict } from "@/lib/i18n";
import { formatLocal, icsUrl, type SavedSummary } from "@/lib/client/summaries";
import { googleCalendarUrl } from "@/lib/shared/calendar";
import type { SummaryEvent } from "@/lib/shared/types";
import { BellIcon, CalendarIcon } from "./icons";
import { Sheet } from "./Sheet";

/** The shortcut's exact name; the link below runs it by name. */
export const SHORTCUT_NAME = "Whisper påminnelse";
const SHORTCUT_KEY = "psst.remindersShortcut";

const BUTTON =
  "inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-100 active:bg-white/10";

function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

/** Runs the shortcut with two lines: what, and when to be reminded ("YYYY-MM-DD HH:mm"). */
function remindersUrl(item: NewAgendaItem): string {
  const lines = [item.title];
  const at = remindAt(item) ?? (item.start ? remindAt({ ...item, remindMinutes: 0 }) : null);
  if (at !== null) lines.push(toLocal(at, true).replace("T", " "));
  const query = new URLSearchParams({ name: SHORTCUT_NAME, input: "text", text: lines.join("\n") });
  return `shortcuts://run-shortcut?${query.toString().replace(/\+/g, "%20")}`;
}

/** When, where and who, on one line. */
export function itemDetails(item: NewAgendaItem, t: Dict): string {
  return [item.start ? formatLocal(item.start, t.locale) : t.notes.noDate, item.location, item.who && t.notes.responsible(item.who)]
    .filter(Boolean)
    .join(" · ");
}

function shortcutReady(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUT_KEY) === "1";
  } catch {
    return false;
  }
}

function ShortcutSetup({ url, onDone, onClose }: { url: string; onDone: () => void; onClose: () => void }) {
  const t = useT();
  const s = t.notes.shortcut;
  return (
    <Sheet title={s.title} onClose={onClose}>
      <div className="space-y-4 pb-6 text-sm leading-relaxed text-zinc-300">
        <p>{s.intro}</p>
        {url ? (
          <a href={url} target="_blank" rel="noopener" className="flex w-full justify-center rounded-xl bg-violet-500 py-3 font-semibold text-white">
            {s.get}
          </a>
        ) : (
          <ol className="list-decimal space-y-2 pl-5">
            {s.steps(SHORTCUT_NAME).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        <p className="text-xs text-zinc-500">{s.once}</p>
        <button type="button" onClick={onDone} className="w-full rounded-xl bg-white py-3 font-semibold text-black">
          {s.done}
        </button>
      </div>
    </Sheet>
  );
}

/** Puts one entry in the phone's calendar, Google Calendar or Apple's Reminders. */
export function PhoneButtons({ item, shortcutUrl }: { item: NewAgendaItem; shortcutUrl: string }) {
  const t = useT();
  const [setup, setSetup] = useState(false);
  const event = toCalendarEvent(item, t.notes.responsible);
  const apple = isApple();
  if (!event && !apple) return null;

  const remind = () => {
    if (shortcutReady()) window.location.assign(remindersUrl(item));
    else setSetup(true);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {event && (
        <>
          <a href={icsUrl([event])} target="_blank" rel="noopener" className={BUTTON}>
            <CalendarIcon width={13} height={13} /> {t.calendar.toPhone}
          </a>
          <a href={googleCalendarUrl(event)} target="_blank" rel="noopener" className={BUTTON}>
            {t.calendar.google}
          </a>
        </>
      )}
      {apple && (
        <button type="button" onClick={remind} className={BUTTON}>
          <BellIcon width={13} height={13} /> {t.notes.toReminders}
        </button>
      )}
      {setup && (
        <ShortcutSetup
          url={shortcutUrl}
          onClose={() => setSetup(false)}
          onDone={() => {
            try {
              window.localStorage.setItem(SHORTCUT_KEY, "1");
            } catch {
              // private mode
            }
            setSetup(false);
            window.location.assign(remindersUrl(item));
          }}
        />
      )}
    </div>
  );
}

/**
 * What Aivia found to put in a calendar or a reminder. Everything is already in Whisper's own
 * calendar; these buttons put it in the phone's apps too.
 */
export function Suggestions({ s, shortcutUrl }: { s: SavedSummary; shortcutUrl: string }) {
  const t = useT();
  const items = fromSummary(s);
  if (items.length === 0) return null;
  const events = items
    .map((item) => toCalendarEvent(item, t.notes.responsible))
    .filter((e): e is SummaryEvent => e !== null);

  return (
    <section className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-300 uppercase">
        <CalendarIcon width={14} height={14} /> {t.notes.suggestTitle}
      </h4>
      <p className="mt-1 text-xs text-zinc-400">{t.notes.suggestHint}</p>
      <ul className="mt-2.5 space-y-2.5">
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`} className="rounded-lg bg-black/20 p-2.5">
            <p className="text-sm font-medium text-zinc-100">{item.title}</p>
            <p className="text-xs text-zinc-500">{itemDetails(item, t)}</p>
            <div className="mt-2">
              <PhoneButtons item={item} shortcutUrl={shortcutUrl} />
            </div>
          </li>
        ))}
      </ul>
      {events.length > 1 && (
        <a
          href={icsUrl(events)}
          target="_blank"
          rel="noopener"
          className="mt-3 flex w-full justify-center rounded-lg bg-emerald-500/20 py-2 text-sm font-medium text-emerald-100 active:bg-emerald-500/30"
        >
          {t.calendar.allToPhone(events.length)}
        </a>
      )}
    </section>
  );
}
