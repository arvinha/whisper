import { useSyncExternalStore } from "react";
import type { Dict } from "@/lib/i18n";
import type { SummaryEvent, SummaryResult } from "@/lib/shared/types";

export interface SavedSummary extends SummaryResult {
  id: string;
  createdAt: number;
  instruction: string;
}

const STORAGE_KEY = "psst.summaries.v1";
const MAX_SAVED = 30;
const EMPTY: SavedSummary[] = [];

let current: SavedSummary[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    current = Array.isArray(list) ? (list as SavedSummary[]).filter((s) => s && typeof s.id === "string") : [];
  } catch {
    current = [];
  }
}

function persist(next: SavedSummary[]) {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full: keep in memory
  }
  listeners.forEach((l) => l());
}

export function getSummaries(): SavedSummary[] {
  load();
  return current;
}

export function saveSummary(result: SummaryResult, instruction: string): SavedSummary {
  load();
  const saved: SavedSummary = {
    ...result,
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    instruction,
  };
  persist([saved, ...current].slice(0, MAX_SAVED));
  return saved;
}

export function deleteSummary(id: string) {
  load();
  persist(current.filter((s) => s.id !== id));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSummaries(): SavedSummary[] {
  return useSyncExternalStore(subscribe, getSummaries, () => EMPTY);
}

/** True when the app runs from the iPhone/iPad home screen rather than in Safari. */
function iosHomeScreenApp(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && standalone;
}

/**
 * A link that opens the entries in the phone's calendar app. Home-screen apps on iOS cannot open
 * .ics files, so there the link hands the file to Safari, which shows "Add to Calendar".
 */
export function icsUrl(events: SummaryEvent[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(events));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const path = `/api/ics?e=${b64}`;
  return iosHomeScreenApp() ? `x-safari-${window.location.origin}${path}` : path;
}

/** The whole summary as plain text, for copying or sharing. */
export function summaryText(s: SummaryResult, t: Dict): string {
  const out: string[] = [s.title, ""];
  if (s.summary) out.push(s.summary, "");
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    out.push(`${title}:`, ...items.map((i) => `• ${i}`), "");
  };
  if (s.reply) out.push(s.reply, "");
  section(t.notes.points, s.points);
  section(t.notes.decisions, s.decisions);
  section(
    t.notes.tasks,
    s.tasks.map((x) =>
      [x.text, x.who && `(${x.who})`, x.due && `– ${formatLocal(x.due, t.locale)}`].filter(Boolean).join(" "),
    ),
  );
  section(
    t.notes.events,
    s.events.map((e) => `${e.title} – ${formatLocal(e.start, t.locale)}${e.location ? `, ${e.location}` : ""}`),
  );
  section(t.notes.positions, s.positions.map((p) => (p.who ? `${p.who}: ${p.view}` : p.view)));
  section(t.notes.openQuestions, s.openQuestions);
  return out.join("\n").trim();
}

/** "2026-10-20T14:00" → "tis 20 okt 14:00". */
export function formatLocal(local: string, locale: string): string {
  const [y, m, d] = local.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return local.length > 10 ? `${day} ${local.slice(11, 16)}` : day;
}
