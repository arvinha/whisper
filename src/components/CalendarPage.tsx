"use client";

import { useState, type FormEvent } from "react";
import {
  addAgendaItems,
  defaultEnd,
  deleteAgendaItem,
  endsAt,
  fromSummary,
  localMs,
  setAgendaDone,
  toCalendarEvent,
  toLocal,
  updateAgendaItem,
  useAgenda,
  useNow,
  type AgendaItem,
  type NewAgendaItem,
} from "@/lib/client/agenda";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { formatLocal, icsUrl } from "@/lib/client/summaries";
import type { Dict } from "@/lib/i18n";
import { googleCalendarUrl } from "@/lib/shared/calendar";
import type { SummaryEvent } from "@/lib/shared/types";
import { BellIcon, CheckIcon, SendIcon } from "./icons";
import { Page } from "./Page";

const REMIND_VALUES = ["none", "0", "10", "30", "60", "1440"] as const;
/** The calendar link carries the entries in its address, which the server caps at 8000 characters. */
const MAX_EXPORT = 12;

const SMALL_BUTTON =
  "inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-200 active:bg-white/10";

type GroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "noDate" | "done";

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupOf(item: AgendaItem, now: number): GroupKey {
  if (item.done) return "done";
  if (!item.start) return "noDate";
  if (endsAt(item) < now) return item.type === "task" ? "overdue" : "done";
  const day = Math.round((startOfDay(localMs(item.start)) - startOfDay(now)) / 86_400_000);
  if (day <= 0) return "today";
  if (day === 1) return "tomorrow";
  if (day <= 7) return "week";
  return "later";
}

export function whenLabel(item: AgendaItem, t: Dict): string {
  if (!item.start) return "";
  const date = formatLocal(item.start, t.locale);
  return item.allDay ? `${date} · ${t.calendar.allDay}` : date;
}

/** Upcoming entries, soonest first, for the home screen. */
export function upcoming(items: AgendaItem[], now: number, limit: number): AgendaItem[] {
  return items
    .filter((x) => !x.done && x.start && endsAt(x) >= now)
    .sort((a, b) => localMs(a.start) - localMs(b.start))
    .slice(0, limit);
}

function remindLabel(item: AgendaItem, t: Dict): string {
  if (item.remindMinutes === null || !item.start) return "";
  const label = t.calendar.remindOptions[String(item.remindMinutes)];
  return label ? t.calendar.remindsBefore(label) : "";
}

interface FormState {
  title: string;
  date: string;
  time: string;
  remind: (typeof REMIND_VALUES)[number];
  notes: string;
  task: boolean;
}

function toForm(item: AgendaItem | null): FormState {
  if (!item) {
    return { title: "", date: toLocal(Date.now(), false), time: "", remind: "30", notes: "", task: false };
  }
  const remind = REMIND_VALUES.find((v) => v === String(item.remindMinutes)) ?? "none";
  return {
    title: item.title,
    date: item.start.slice(0, 10),
    time: item.start.length > 10 ? item.start.slice(11, 16) : "",
    remind: item.remindMinutes === null ? "none" : remind,
    notes: item.notes,
    task: item.type === "task",
  };
}

function fromForm(f: FormState, previous: AgendaItem | null): NewAgendaItem {
  const start = f.date ? (f.time ? `${f.date}T${f.time}` : f.date) : "";
  const sameStart = previous && previous.start === start;
  return {
    type: f.task ? "task" : "event",
    title: f.title.trim(),
    start,
    end: sameStart ? previous.end : defaultEnd(start, f.task ? 15 : 60),
    allDay: !!start && !f.time,
    remindMinutes: f.remind === "none" || !start ? null : Number(f.remind),
    location: previous?.location ?? "",
    notes: f.notes.trim(),
    who: previous?.who ?? "",
    source: previous?.source ?? "",
  };
}

const INPUT =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-base outline-none focus:border-violet-400/60";

function ItemForm({ item, onDone }: { item: AgendaItem | null; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState<FormState>(() => toForm(item));
  const set = (patch: Partial<FormState>) => setF((x) => ({ ...x, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    const next = fromForm(f, item);
    if (item) updateAgendaItem(item.id, next);
    else addAgendaItems([next]);
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-violet-400/25 bg-violet-500/5 p-4">
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">{t.calendar.form.title}</span>
        <input
          value={f.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t.calendar.form.titlePlaceholder}
          maxLength={200}
          className={INPUT}
          autoFocus
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0">
          <span className="mb-1 block text-sm text-zinc-300">{t.calendar.form.date}</span>
          <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className={INPUT} />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-sm text-zinc-300">{t.calendar.form.time}</span>
          <input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} className={INPUT} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">{t.calendar.form.remind}</span>
        <select
          value={f.remind}
          onChange={(e) => set({ remind: e.target.value as FormState["remind"] })}
          className={INPUT}
          disabled={!f.date}
        >
          {REMIND_VALUES.map((v) => (
            <option key={v} value={v}>
              {t.calendar.remindOptions[v]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-300">{t.calendar.form.notes}</span>
        <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={600} className={INPUT} />
      </label>
      <label className="flex items-center gap-2.5 text-sm text-zinc-300">
        <input type="checkbox" checked={f.task} onChange={(e) => set({ task: e.target.checked })} className="size-4 accent-violet-500" />
        {t.calendar.form.isTask}
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="flex-1 rounded-xl bg-white/5 py-2.5 text-sm text-zinc-300">
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={!f.title.trim()}
          className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {t.common.save}
        </button>
      </div>
    </form>
  );
}

function ItemCard({ item, now, onEdit }: { item: AgendaItem; now: number; onEdit: () => void }) {
  const t = useT();
  const event: SummaryEvent | null = toCalendarEvent(item, t.notes.responsible);
  const remind = remindLabel(item, t);
  const past = endsAt(item) < now;
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex items-start gap-3">
        {item.type === "task" ? (
          <button
            type="button"
            onClick={() => setAgendaDone(item.id, !item.done)}
            aria-label={item.title}
            aria-pressed={item.done}
            className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${
              item.done ? "border-emerald-400 bg-emerald-500 text-black" : "border-zinc-500"
            }`}
          >
            {item.done && <CheckIcon width={14} height={14} strokeWidth={3} />}
          </button>
        ) : (
          <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${past ? "bg-zinc-600" : "bg-violet-400"}`} />
        )}
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${item.done ? "text-zinc-500 line-through" : "text-zinc-100"}`}>{item.title}</p>
          <p className="mt-0.5 text-sm text-zinc-400">
            {[whenLabel(item, t), item.location, item.who && t.notes.responsible(item.who)].filter(Boolean).join(" · ")}
          </p>
          {remind && !item.done && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
              <BellIcon width={12} height={12} /> {remind}
            </p>
          )}
          {item.notes && <p className="mt-1 text-sm text-zinc-400">{item.notes}</p>}
          {item.source && <p className="mt-1 text-xs text-zinc-600">{t.calendar.from(item.source)}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event && !item.done && (
              <>
                <a href={icsUrl([event])} target="_blank" rel="noopener" className={SMALL_BUTTON}>
                  {t.calendar.toPhone}
                </a>
                <a href={googleCalendarUrl(event)} target="_blank" rel="noopener" className={SMALL_BUTTON}>
                  {t.calendar.google}
                </a>
              </>
            )}
            <button type="button" onClick={onEdit} className={SMALL_BUTTON}>
              {t.common.change}
            </button>
            <button type="button" onClick={() => deleteAgendaItem(item.id)} className={SMALL_BUTTON}>
              {t.common.delete}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function AskAivia() {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const instruction = text.trim();
    if (!instruction || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await getEngine().askCalendar(instruction);
      const added = addAgendaItems(fromSummary(result));
      if (added > 0) {
        setText("");
        setMessage({ text: t.calendar.added(added), ok: true });
      } else {
        setMessage({ text: result.reply || t.calendar.nothingAdded, ok: false });
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : t.calendar.askFailed, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-2 text-sm font-medium text-zinc-200">{t.calendar.askTitle}</h2>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.calendar.askPlaceholder}
          maxLength={500}
          enterKeyHint="send"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-base outline-none focus:border-violet-400/60"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label={t.common.add}
          className="grid w-11 shrink-0 place-items-center rounded-xl bg-violet-500 text-white disabled:opacity-40"
        >
          {busy ? "…" : <SendIcon width={18} height={18} />}
        </button>
      </div>
      {busy && <p className="mt-2 text-sm text-zinc-400">{t.calendar.asking}</p>}
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-emerald-300" : "text-amber-200"}`}>{message.text}</p>}
    </form>
  );
}

export function CalendarPage() {
  const t = useT();
  const items = useAgenda();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showDone, setShowDone] = useState(false);
  const now = useNow();

  const groups = new Map<GroupKey, AgendaItem[]>();
  for (const item of items) {
    const key = groupOf(item, now);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const byStart = (a: AgendaItem, b: AgendaItem) =>
    (a.start ? localMs(a.start) : Infinity) - (b.start ? localMs(b.start) : Infinity) || b.createdAt - a.createdAt;
  const order: Array<Exclude<GroupKey, "done">> = ["overdue", "today", "tomorrow", "week", "later", "noDate"];
  const done = (groups.get("done") ?? []).sort((a, b) => b.createdAt - a.createdAt);

  const coming = items
    .filter((x) => !x.done && x.start && endsAt(x) >= now)
    .map((x) => toCalendarEvent(x, t.notes.responsible))
    .filter((e): e is SummaryEvent => e !== null)
    .slice(0, MAX_EXPORT);

  const renderItem = (item: AgendaItem) =>
    editing === item.id ? (
      <li key={item.id}>
        <ItemForm item={item} onDone={() => setEditing(null)} />
      </li>
    ) : (
      <ItemCard key={item.id} item={item} now={now} onEdit={() => setEditing(item.id)} />
    );

  return (
    <Page
      title={t.calendar.title}
      action={
        editing !== "new" && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-full bg-white/10 px-3.5 py-2 text-sm font-medium text-zinc-100 active:bg-white/15"
          >
            {t.calendar.addOwn}
          </button>
        )
      }
    >
      <div className="space-y-5">
        {editing === "new" && <ItemForm item={null} onDone={() => setEditing(null)} />}
        <AskAivia />

        {items.length === 0 && <p className="px-1 text-sm leading-relaxed text-zinc-500">{t.calendar.empty}</p>}

        {order.map((key) => {
          const list = groups.get(key);
          if (!list?.length) return null;
          const title = t.calendar.groups[key];
          return (
            <section key={key}>
              <h2
                className={`mb-2 px-1 text-xs font-semibold tracking-wide uppercase ${
                  key === "overdue" ? "text-rose-300" : key === "today" ? "text-violet-300" : "text-zinc-500"
                }`}
              >
                {title}
              </h2>
              <ul className="space-y-2">{list.sort(byStart).map(renderItem)}</ul>
            </section>
          );
        })}

        {done.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="mb-2 px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
            >
              {t.calendar.groups.done(done.length)} {showDone ? "▴" : "▾"}
            </button>
            {showDone && <ul className="space-y-2">{done.map(renderItem)}</ul>}
          </section>
        )}

        {coming.length > 1 && (
          <a
            href={icsUrl(coming)}
            target="_blank"
            rel="noopener"
            className="flex w-full justify-center rounded-xl bg-violet-500 py-3 text-sm font-semibold text-white"
          >
            {t.calendar.allToPhone(coming.length)}
          </a>
        )}
        <p className="px-1 text-xs leading-relaxed text-zinc-500">{t.calendar.note}</p>
      </div>
    </Page>
  );
}
