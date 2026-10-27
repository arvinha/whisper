import { useSyncExternalStore } from "react";
import type { SummaryEvent, SummaryResult } from "@/lib/shared/types";
import { getSummaries, type SavedSummary } from "./summaries";

export interface AgendaItem {
  id: string;
  type: "event" | "task";
  title: string;
  /** Local "YYYY-MM-DDTHH:mm", "YYYY-MM-DD" for whole days, or "" for tasks without a date. */
  start: string;
  end: string;
  allDay: boolean;
  /** Minutes before the start; null = no reminder. */
  remindMinutes: number | null;
  location: string;
  notes: string;
  /** Who should do a task, if it is not the user. */
  who: string;
  done: boolean;
  createdAt: number;
  /** Title of the summary it came from, or "". */
  source: string;
  reminded: boolean;
}

export type NewAgendaItem = Omit<AgendaItem, "id" | "createdAt" | "done" | "reminded">;

const STORAGE_KEY = "psst.agenda.v1";
const MAX_ITEMS = 300;
const EMPTY: AgendaItem[] = [];
/** Whole-day entries remind at this hour. */
const ALL_DAY_REMIND_HOUR = 9;
/** Reminders older than this when the app opens are skipped silently. */
const STALE_REMINDER_MS = 12 * 60 * 60_000;

let items: AgendaItem[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function sanitize(raw: unknown): AgendaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  const title = str(v.title, 200).trim();
  const start = str(v.start, 16);
  if (!title || (start && !DATE.test(start) && !DATE_TIME.test(start))) return null;
  const remind = v.remindMinutes === null ? null : Number(v.remindMinutes);
  return {
    id: str(v.id, 40) || newId(),
    type: v.type === "task" ? "task" : "event",
    title,
    start,
    end: str(v.end, 16),
    allDay: v.allDay === true || DATE.test(start),
    remindMinutes: remind === null || !Number.isFinite(remind) ? null : Math.max(0, Math.min(10080, remind)),
    location: str(v.location, 200),
    notes: str(v.notes, 600),
    who: str(v.who, 80),
    done: v.done === true,
    createdAt: Number(v.createdAt) || Date.now(),
    source: str(v.source, 200),
    reminded: v.reminded === true,
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      // First time: bring in what earlier summaries found, without reminding about the past.
      const seeded: AgendaItem[] = [];
      for (const s of [...getSummaries()].reverse()) {
        for (const item of fromSummary(s)) {
          if (!seeded.some((x) => sameItem(x, item))) seeded.push(create(item));
        }
      }
      persist(
        seeded.map((x) => ({ ...x, reminded: (remindAt(x) ?? Infinity) <= Date.now() })),
        false,
      );
      return;
    }
    const list: unknown = JSON.parse(raw);
    items = Array.isArray(list) ? list.map(sanitize).filter((x): x is AgendaItem => x !== null) : [];
  } catch {
    items = [];
  }
}

function persist(next: AgendaItem[], notify = true) {
  items = next.slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // storage full: keep in memory
  }
  if (notify) listeners.forEach((l) => l());
}

function create(item: NewAgendaItem): AgendaItem {
  return { ...item, id: newId(), createdAt: Date.now(), done: false, reminded: false };
}

function sameItem(a: Pick<AgendaItem, "title" | "start">, b: Pick<AgendaItem, "title" | "start">): boolean {
  return a.start === b.start && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
}

export function getAgenda(): AgendaItem[] {
  load();
  return items;
}

export function subscribeAgenda(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgenda(): AgendaItem[] {
  return useSyncExternalStore(subscribeAgenda, getAgenda, () => EMPTY);
}

const NOW_TICK_MS = 30_000;
let nowValue = 0;
let nowTimer: ReturnType<typeof setInterval> | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  nowTimer ??= setInterval(() => {
    nowValue = Date.now();
    nowListeners.forEach((l) => l());
  }, NOW_TICK_MS);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

function getNow(): number {
  if (!nowValue || Date.now() - nowValue > NOW_TICK_MS) nowValue = Date.now();
  return nowValue;
}

/** The current time, updated every half minute, for grouping into today, tomorrow and so on. */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, () => 0);
}

/** Adds entries that are not already there; returns how many were added. */
export function addAgendaItems(list: NewAgendaItem[]): number {
  load();
  const next = [...items];
  let added = 0;
  for (const item of list) {
    if (!item.title.trim() || next.some((x) => sameItem(x, item))) continue;
    next.unshift(create(item));
    added++;
  }
  if (added) persist(next);
  return added;
}

export function updateAgendaItem(id: string, patch: Partial<NewAgendaItem>) {
  load();
  persist(items.map((x) => (x.id === id ? { ...x, ...patch, reminded: false } : x)));
}

export function setAgendaDone(id: string, done: boolean) {
  load();
  persist(items.map((x) => (x.id === id ? { ...x, done } : x)));
}

export function deleteAgendaItem(id: string) {
  load();
  persist(items.filter((x) => x.id !== id));
}

function markReminded(ids: string[]) {
  persist(items.map((x) => (ids.includes(x.id) ? { ...x, reminded: true } : x)));
}

// ---- times -----------------------------------------------------------------------------------

/** Local wall-clock "YYYY-MM-DD[THH:mm]" as epoch milliseconds. */
export function localMs(local: string): number {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number);
  const hh = local.length > 10 ? Number(local.slice(11, 13)) : 0;
  const mm = local.length > 10 ? Number(local.slice(14, 16)) : 0;
  return new Date(y, m - 1, d, hh, mm).getTime();
}

export function toLocal(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date}T${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

/** The end of an entry that only has a start: an hour later, or the next day. */
export function defaultEnd(start: string, minutes = 60): string {
  if (!start) return "";
  if (start.length <= 10) return toLocal(localMs(start) + 36 * 60 * 60_000, false);
  return toLocal(localMs(start) + minutes * 60_000, true);
}

export function remindAt(item: Pick<AgendaItem, "start" | "allDay" | "remindMinutes">): number | null {
  if (!item.start || item.remindMinutes === null) return null;
  const base = item.allDay ? localMs(item.start) + ALL_DAY_REMIND_HOUR * 60 * 60_000 : localMs(item.start);
  // A whole-day entry reminds in the morning, or the morning before for "1 dag innan".
  const before = item.allDay ? (item.remindMinutes >= 1440 ? 1440 : 0) : item.remindMinutes;
  return base - before * 60_000;
}

/** When the entry is over: the end of the day for whole days and tasks. */
export function endsAt(item: AgendaItem): number {
  if (!item.start) return Infinity;
  if (item.allDay) return localMs(item.start) + 24 * 60 * 60_000;
  if (item.type === "task") return localMs(item.start);
  return item.end && item.end.length > 10 ? localMs(item.end) : localMs(item.start) + 60 * 60_000;
}

/** Reminders that are due now; they are marked so they are only given once. */
export function takeDueReminders(now = Date.now()): AgendaItem[] {
  load();
  const due: AgendaItem[] = [];
  const stale: string[] = [];
  for (const item of items) {
    if (item.done || item.reminded) continue;
    const at = remindAt(item);
    if (at === null || at > now) continue;
    if (now - at > STALE_REMINDER_MS) stale.push(item.id);
    else due.push(item);
  }
  if (due.length || stale.length) markReminded([...due.map((x) => x.id), ...stale]);
  return due;
}

// ---- from summaries and Aivia --------------------------------------------------------------

const ME = /^(jag|mig|me|i|mig selv|du|you)$/i;

/** Calendar entries and the user's own to-dos from a summary or a request to Aivia. */
export function fromSummary(s: SummaryResult | SavedSummary): NewAgendaItem[] {
  const source = "createdAt" in s && !s.instruction ? s.title : "";
  const out: NewAgendaItem[] = s.events.map((e) => ({
    type: "event",
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    remindMinutes: e.remindMinutes,
    location: e.location,
    notes: e.notes,
    who: "",
    source,
  }));
  for (const t of s.tasks) {
    const mine = !t.who || ME.test(t.who.trim());
    if (!mine && !t.due) continue;
    if (t.due && s.events.some((e) => e.start === t.due)) continue;
    out.push({
      type: "task",
      title: t.text,
      start: t.due,
      end: t.due ? defaultEnd(t.due, 15) : "",
      allDay: t.due.length === 10,
      remindMinutes: t.due ? 0 : null,
      location: "",
      notes: "",
      who: mine ? "" : t.who,
      source,
    });
  }
  return out;
}

/** The entry for the phone's calendar app, or null without a date. */
export function toCalendarEvent(item: NewAgendaItem, responsible: (who: string) => string): SummaryEvent | null {
  if (!item.start) return null;
  const notes = [item.notes, item.who && responsible(item.who)].filter(Boolean).join(" ").slice(0, 300);
  return {
    title: item.title,
    start: item.start,
    end: item.end && item.end > item.start ? item.end : defaultEnd(item.start, item.type === "task" ? 15 : 60),
    allDay: item.allDay,
    location: item.location,
    notes,
    remindMinutes: item.remindMinutes ?? -1,
  };
}
