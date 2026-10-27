"use client";

import { useState } from "react";
import type { NewAgendaItem } from "@/lib/client/agenda";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { acceptSuggestion, dismissSuggestion, useInbox } from "@/lib/client/inbox";
import { BellIcon, CheckIcon } from "./icons";
import { itemDetails, PhoneButtons } from "./Suggestions";
import { timeLabel } from "./phase";

const VISIBLE = 3;

/** Appointments and to-dos Aivia picked up by herself, to add with one tap. */
export function InboxCard({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const t = useT();
  const inbox = useInbox();
  const [accepted, setAccepted] = useState<NewAgendaItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  if (inbox.length === 0 && accepted.length === 0) return null;
  const shortcutUrl = getEngine().getState().config?.remindersShortcutUrl ?? "";
  const visible = showAll ? inbox : inbox.slice(0, VISIBLE);

  return (
    <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
        <BellIcon width={18} height={18} className="text-emerald-300" /> {t.inbox.title}
      </h2>
      {inbox.length > 0 && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t.inbox.hint}</p>}
      <ul className="mt-3 space-y-2">
        {accepted.map((item, i) => (
          <li key={`ok-${i}`} className="rounded-xl bg-black/20 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-200">
              <CheckIcon width={14} height={14} /> {item.title}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {t.inbox.added} ·{" "}
              <button type="button" onClick={onOpenCalendar} className="text-violet-300 active:text-violet-200">
                {t.notes.openCalendar}
              </button>
            </p>
            <div className="mt-2 flex items-start gap-2">
              <div className="flex-1">
                <PhoneButtons item={item} shortcutUrl={shortcutUrl} />
              </div>
              <button
                type="button"
                onClick={() => setAccepted((list) => list.filter((x) => x !== item))}
                className="px-1 py-1.5 text-xs text-zinc-500 active:text-zinc-300"
              >
                {t.common.close}
              </button>
            </div>
          </li>
        ))}
        {visible.map((s) => (
          <li key={s.id} className="rounded-xl bg-black/20 p-3">
            <p className="text-sm font-medium text-zinc-100">{s.item.title}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{itemDetails(s.item, t)}</p>
            <p className="mt-0.5 text-xs text-zinc-600">
              {t.inbox.heard(heardLabel(s.heardAt, t.locale, t.memory.yesterday))}
              {s.item.source && ` · ${s.item.source}`}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const item = acceptSuggestion(s.id);
                  if (item) setAccepted((list) => [item, ...list]);
                }}
                className="flex-1 rounded-lg bg-white py-2 text-sm font-semibold text-black active:bg-zinc-200"
              >
                {t.inbox.add}
              </button>
              <button
                type="button"
                onClick={() => dismissSuggestion(s.id)}
                className="flex-1 rounded-lg bg-white/5 py-2 text-sm text-zinc-300 active:bg-white/10"
              >
                {t.inbox.dismiss}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {inbox.length > VISIBLE && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-2 w-full py-1.5 text-xs text-zinc-400 active:text-zinc-200">
          {t.inbox.more(inbox.length - VISIBLE)}
        </button>
      )}
    </section>
  );
}

function heardLabel(at: number, locale: string, yesterday: string): string {
  const d = new Date(at);
  const now = new Date();
  const time = timeLabel(at, locale);
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `${yesterday.toLowerCase()} ${time}`;
  return `${d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}
