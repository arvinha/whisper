import { useSyncExternalStore } from "react";
import { addAgendaItems, getAgenda, localMs, type NewAgendaItem } from "./agenda";
import { onOwnerChange, ownedKey } from "./owner";

/** Appointments and to-dos Aivia heard by itself, waiting for the user to add or ignore them. */
export interface Suggestion {
  id: string;
  item: NewAgendaItem;
  /** When it was said. */
  heardAt: number;
  createdAt: number;
}

const STORAGE_KEY = "psst.inbox.v1";
const DISMISSED_KEY = "psst.inbox.dismissed.v1";
const MAX_ITEMS = 40;
const MAX_DISMISSED = 300;
const DISMISSED_KEEP_MS = 60 * 24 * 60 * 60_000;
const EMPTY: Suggestion[] = [];

let items: Suggestion[] = EMPTY;
let dismissed: Array<{ key: string; at: number }> = [];
let loaded = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  onOwnerChange(() => {
    loaded = false;
    items = EMPTY;
    dismissed = [];
    listeners.forEach((l) => l());
  });
}

function readJson(base: string): unknown {
  const key = ownedKey(base);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const list = readJson(STORAGE_KEY);
  items = Array.isArray(list) ? (list as Suggestion[]).filter((s) => s && typeof s.id === "string" && s.item?.title) : [];
  const gone = readJson(DISMISSED_KEY);
  const cutoff = Date.now() - DISMISSED_KEEP_MS;
  dismissed = Array.isArray(gone) ? (gone as typeof dismissed).filter((d) => d && d.at > cutoff) : [];
}

function persist() {
  try {
    const itemsKey = ownedKey(STORAGE_KEY);
    const dismissedKey = ownedKey(DISMISSED_KEY);
    if (itemsKey) window.localStorage.setItem(itemsKey, JSON.stringify(items));
    if (dismissedKey) window.localStorage.setItem(dismissedKey, JSON.stringify(dismissed));
  } catch {
    // storage full: keep in memory
  }
  listeners.forEach((l) => l());
}

function keyOf(item: Pick<NewAgendaItem, "title" | "start">): string {
  return `${item.start}|${item.title.trim().toLowerCase()}`;
}

function titleWords(title: string): string[] {
  return (title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4);
}

/**
 * The same thing heard twice is often worded differently ("Läkartid", "Tid hos läkaren"): the same
 * time of day is enough, the same date needs a shared word.
 */
function same(a: Pick<NewAgendaItem, "title" | "start">, b: Pick<NewAgendaItem, "title" | "start">): boolean {
  if (keyOf(a) === keyOf(b)) return true;
  if (!a.start || a.start !== b.start) return false;
  if (a.start.length > 10) return true;
  const other = titleWords(b.title);
  return titleWords(a.title).some((w) => other.some((o) => o.startsWith(w.slice(0, 5)) || w.startsWith(o.slice(0, 5))));
}

/** Over already: nothing to add to a calendar. */
function past(item: NewAgendaItem, now: number): boolean {
  if (!item.start) return false;
  const end = item.start.length > 10 ? localMs(item.start) + 60 * 60_000 : localMs(item.start) + 24 * 60 * 60_000;
  return end < now;
}

export function getInbox(): Suggestion[] {
  load();
  return items;
}

/** Adds what is new; returns how many were added. */
export function addSuggestions(list: NewAgendaItem[], heardAt: number, source: string): number {
  load();
  const now = Date.now();
  const agenda = getAgenda();
  const next = [...items];
  let added = 0;
  for (const item of list) {
    if (!item.title.trim() || past(item, now)) continue;
    if (agenda.some((x) => same(x, item)) || next.some((x) => same(x.item, item))) continue;
    if (dismissed.some((d) => d.key === keyOf(item))) continue;
    next.unshift({
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      item: { ...item, source: item.source || source },
      heardAt,
      createdAt: now,
    });
    added++;
  }
  if (added) {
    items = next.slice(0, MAX_ITEMS);
    persist();
  }
  return added;
}

export function acceptSuggestion(id: string): NewAgendaItem | null {
  load();
  const found = items.find((s) => s.id === id);
  if (!found) return null;
  addAgendaItems([found.item]);
  items = items.filter((s) => s.id !== id);
  persist();
  return found.item;
}

export function dismissSuggestion(id: string) {
  load();
  const found = items.find((s) => s.id === id);
  if (!found) return;
  items = items.filter((s) => s.id !== id);
  dismissed = [{ key: keyOf(found.item), at: Date.now() }, ...dismissed].slice(0, MAX_DISMISSED);
  persist();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInbox(): Suggestion[] {
  return useSyncExternalStore(subscribe, getInbox, () => EMPTY);
}
