import { useSyncExternalStore } from "react";
import type { SummaryLine } from "@/lib/shared/types";
import { onOwnerChange, ownedKey } from "./owner";
import { wordCount } from "./transcriptFilter";

/**
 * Everything Aivia hears, kept for days on the phone (IndexedDB), so the user can ask about it
 * afterwards. The day is split into stretches ("moments") at pauses; each gets a short diary note.
 */

export interface MemoryLine {
  at: number;
  end: number;
  text: string;
  /** Said by the user: an answer said out loud, or a request to Aivia. */
  me: boolean;
}

export interface Digest {
  /** Start of the stretch, epoch ms; the key. */
  from: number;
  to: number;
  /** How many words the note covers, so a stretch that grew gets a new one. */
  words: number;
  title: string;
  summary: string;
  lang: string;
  madeAt: number;
}

export interface Moment {
  from: number;
  to: number;
  lines: MemoryLine[];
  words: number;
  digest: Digest | null;
}

export interface MemoryHit {
  line: MemoryLine;
  title: string;
}

const DB_NAME = "psst-memory";
const DB_VERSION = 1;
const DAY_MS = 24 * 60 * 60_000;
/** A pause this long starts a new stretch. */
export const MOMENT_GAP_MS = 10 * 60_000;
/** Long meetings are split, so each note covers at most this much. */
const MAX_MOMENT_MS = 60 * 60_000;
const FLUSH_MS = 3_000;
/** Lines around a search hit that go along, for context. */
const HIT_BEFORE = 4;
const HIT_AFTER = 6;
const RECENT_MS = 20 * 60_000;
const NOTES_MAX_CHARS = 4_000;

const STOPWORDS = new Set(
  (
    "och att det som en ett är på för med jag du vi de han hon den har hade var vad när hur kan ska skulle mig min mitt mina " +
    "om till från av inte så där här men eller nu då sen bara också lite mycket alla allt något någon kommer kom blir " +
    "sa sade säga sagt säger hörde höra idag igår imorgon morse kväll påminn påminnelse lägg lägga in kalender kalendern " +
    "og jeg der hvad hvornår hvordan ikke til fra også meget noget nogen sagde sige husk mig dig " +
    "the and you what when how did does that this with for about was were is are have has had will would can could " +
    "said say tell told remind reminder add calendar today yesterday tomorrow morning " +
    "whisper aivia hej hey okej okay"
  ).split(" "),
);

// ---- change notifications -----------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever the memory changes, for re-reading it in the UI. */
export function useMemoryVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

// ---- IndexedDB ------------------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openNamed(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      const lines = db.createObjectStore("lines", { keyPath: "id", autoIncrement: true });
      lines.createIndex("at", "at");
      db.createObjectStore("digests", { keyPath: "from" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/** The signed-in person's own memory; nothing is kept while nobody is signed in. */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  const name = ownedKey(DB_NAME);
  if (!name) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = openNamed(name);
    dbName = name;
  }
  return dbPromise;
}

let dbName: string | null = null;

if (typeof window !== "undefined") {
  onOwnerChange(() => {
    if (ownedKey(DB_NAME) === dbName) {
      bump();
      return;
    }
    // What was heard so far belongs to the one who was signed in.
    const batch = pending;
    const old = dbPromise;
    pending = [];
    dbPromise = null;
    dbName = null;
    flushing = flushing.then(async () => {
      const db = await old;
      if (db && batch.length > 0) await writeLines(db, batch).catch(() => {});
      db?.close();
    });
    bump();
  });
}

async function writeLines(db: IDBDatabase, batch: MemoryLine[]): Promise<void> {
  const tx = db.transaction("lines", "readwrite");
  const store = tx.objectStore("lines");
  for (const line of batch) store.add(plain(line));
  await finished(tx);
}

/** Moves what was heard before it belonged to anyone into the signed-in person's memory. */
export async function adoptLegacyMemory(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  if (!db) return;
  const legacy = await openNamed(DB_NAME);
  if (!legacy) return;
  try {
    const read = legacy.transaction(["lines", "digests"], "readonly");
    const [lines, digests] = await Promise.all([
      result(read.objectStore("lines").getAll()) as Promise<MemoryLine[]>,
      result(read.objectStore("digests").getAll()) as Promise<Digest[]>,
    ]);
    if (lines.length > 0 || digests.length > 0) {
      const tx = db.transaction(["lines", "digests"], "readwrite");
      for (const line of lines) tx.objectStore("lines").add(plain(line));
      for (const digest of digests) tx.objectStore("digests").put(digest);
      await finished(tx);
    }
  } finally {
    legacy.close();
  }
  indexedDB.deleteDatabase(DB_NAME);
  bump();
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function plain(raw: MemoryLine): MemoryLine {
  return { at: raw.at, end: raw.end, text: raw.text, me: raw.me };
}

// ---- writing --------------------------------------------------------------------------------------

let pending: MemoryLine[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();
let pageHideHooked = false;

export function archiveLine(line: MemoryLine) {
  pending.push(line);
  if (!pageHideHooked && typeof window !== "undefined") {
    pageHideHooked = true;
    window.addEventListener("pagehide", () => void flushMemory());
  }
  flushTimer ??= setTimeout(() => void flushMemory(), FLUSH_MS);
}

/** Writes what is waiting; resolves when everything heard so far is stored. */
export function flushMemory(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const batch = pending;
  pending = [];
  flushing = flushing.then(async () => {
    if (batch.length === 0) return;
    const db = await openDb();
    if (!db) return;
    try {
      await writeLines(db, batch);
      bump();
    } catch {
      // storage full or blocked: the lines are only in the live transcript
    }
  });
  return flushing;
}

export async function saveDigest(digest: Digest): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction("digests", "readwrite");
  const store = tx.objectStore("digests");
  // A stretch that grew keeps one note: drop older notes that started inside it.
  const old = await result(store.getAllKeys(IDBKeyRange.bound(digest.from, digest.to)));
  for (const key of old) store.delete(key);
  store.put(digest);
  await finished(tx);
  bump();
}

/** Removes everything older than `days`. */
export async function pruneMemory(days: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const cutoff = Date.now() - days * DAY_MS;
  const tx = db.transaction(["lines", "digests"], "readwrite");
  const lines = tx.objectStore("lines").index("at");
  const keys = await result(lines.getAllKeys(IDBKeyRange.upperBound(cutoff, true)));
  for (const key of keys) tx.objectStore("lines").delete(key);
  tx.objectStore("digests").delete(IDBKeyRange.upperBound(cutoff, true));
  await finished(tx);
  if (keys.length) bump();
}

export async function forgetRange(from: number, to: number): Promise<void> {
  await flushMemory();
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(["lines", "digests"], "readwrite");
  const keys = await result(tx.objectStore("lines").index("at").getAllKeys(IDBKeyRange.bound(from, to)));
  for (const key of keys) tx.objectStore("lines").delete(key);
  tx.objectStore("digests").delete(IDBKeyRange.bound(from, to));
  await finished(tx);
  bump();
}

export async function clearMemory(): Promise<void> {
  pending = [];
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(["lines", "digests"], "readwrite");
  tx.objectStore("lines").clear();
  tx.objectStore("digests").clear();
  await finished(tx);
  bump();
}

// ---- reading --------------------------------------------------------------------------------------

async function linesBetween(from: number, to: number): Promise<MemoryLine[]> {
  await flushMemory();
  const db = await openDb();
  if (!db) return [];
  const tx = db.transaction("lines", "readonly");
  const rows = await result(tx.objectStore("lines").index("at").getAll(IDBKeyRange.bound(from, to)));
  return (rows as MemoryLine[]).map(plain);
}

async function digestsBetween(from: number, to: number): Promise<Digest[]> {
  const db = await openDb();
  if (!db) return [];
  const tx = db.transaction("digests", "readonly");
  return (await result(tx.objectStore("digests").getAll(IDBKeyRange.bound(from, to)))) as Digest[];
}

/** Splits lines (oldest first) into stretches at pauses, and attaches their notes. */
export function toMoments(lines: MemoryLine[], digests: Digest[]): Moment[] {
  const out: Moment[] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last && line.at - last.to <= MOMENT_GAP_MS && line.at - last.from <= MAX_MOMENT_MS) {
      last.lines.push(line);
      last.to = Math.max(last.to, line.end);
      last.words += wordCount(line.text);
    } else {
      out.push({ from: line.at, to: line.end, lines: [line], words: wordCount(line.text), digest: null });
    }
  }
  for (const m of out) {
    m.digest = digests.filter((d) => d.from >= m.from && d.from <= m.to).sort((a, b) => b.words - a.words)[0] ?? null;
  }
  return out;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function nextDay(dayStart: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** The days that have something in the memory, newest first. */
export async function memoryDays(): Promise<number[]> {
  await flushMemory();
  const db = await openDb();
  if (!db) return [];
  const tx = db.transaction("lines", "readonly");
  const index = tx.objectStore("lines").index("at");
  const days: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = index.openKeyCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const day = startOfDay(Number(cursor.key));
      days.push(day);
      cursor.continue(nextDay(day));
    };
  });
  return days.reverse();
}

export async function dayMoments(dayStart: number): Promise<Moment[]> {
  const end = nextDay(dayStart) - 1;
  const [lines, digests] = await Promise.all([linesBetween(dayStart, end), digestsBetween(dayStart, end)]);
  return toMoments(lines, digests).reverse();
}

/** Stretches since `since`, oldest first, for making notes. */
export async function momentsSince(since: number): Promise<Moment[]> {
  const now = Date.now();
  const [lines, digests] = await Promise.all([linesBetween(since, now), digestsBetween(since - MAX_MOMENT_MS, now)]);
  return toMoments(lines, digests);
}

// ---- search ---------------------------------------------------------------------------------------

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The words of a question worth searching for, shortened so "tandläkaren" finds "tandläkare". */
function searchStems(query: string): string[] {
  const stems = new Set<string>();
  for (const w of words(query)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    stems.add(w.length > 5 ? w.slice(0, w.length - 2) : w);
  }
  return [...stems];
}

function matches(text: string, stems: string[]): number {
  if (stems.length === 0) return 0;
  const lineWords = words(text);
  let score = 0;
  for (const stem of stems) {
    const hit = lineWords.some((w) => (stem.length >= 5 ? w.includes(stem) : w.startsWith(stem)));
    if (hit) score += stem.length >= 5 ? 2 : 1;
  }
  return score;
}

/** Lines matching the search, newest first. */
export async function searchMemory(query: string, max = 60): Promise<MemoryHit[]> {
  const stems = searchStems(query);
  if (stems.length === 0) return [];
  const all = await linesBetween(0, Date.now());
  const digests = await digestsBetween(0, Date.now());
  const moments = toMoments(all, digests);
  const hits: Array<MemoryHit & { score: number }> = [];
  for (const m of moments) {
    for (const line of m.lines) {
      const score = matches(line.text, stems);
      if (score > 0) hits.push({ line, title: m.digest?.title ?? "", score });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score || b.line.at - a.line.at)
    .slice(0, max)
    .sort((a, b) => b.line.at - a.line.at);
}

function noteLine(d: Digest, locale: string): string {
  const day = new Date(d.from).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const time = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time(d.from)}–${time(d.to)}: ${d.title}. ${d.summary}`.trim();
}

/**
 * What Aivia gets along with a request: the latest minutes, plus the stretches that match words in
 * the request, within `maxChars`; and the diary notes of the days, newest first.
 */
export async function recall(query: string, maxChars: number, locale: string): Promise<{ lines: SummaryLine[]; notes: string }> {
  const now = Date.now();
  const all = await linesBetween(0, now);
  const digests = await digestsBetween(0, now);
  const stems = searchStems(query);

  const keep = new Set<number>();
  let chars = 0;
  const take = (i: number) => {
    if (keep.has(i) || i < 0 || i >= all.length) return true;
    const size = all[i].text.length + 20;
    if (chars + size > maxChars) return false;
    keep.add(i);
    chars += size;
    return true;
  };

  // Newest first: what was just said is often what the request is about.
  for (let i = all.length - 1; i >= 0 && now - all[i].end <= RECENT_MS; i--) {
    if (!take(i)) break;
  }

  if (stems.length > 0) {
    const scored = all
      .map((line, i) => ({ i, score: matches(line.text, stems) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.i - a.i);
    outer: for (const { i } of scored) {
      for (let j = i - HIT_BEFORE; j <= i + HIT_AFTER; j++) {
        if (j < 0 || j >= all.length) continue;
        if (Math.abs(all[j].at - all[i].at) > MOMENT_GAP_MS) continue;
        if (!take(j)) break outer;
      }
    }
  }

  const lines = [...keep]
    .sort((a, b) => a - b)
    .map((i) => ({ at: all[i].at, text: all[i].text, me: all[i].me }));

  const notes: string[] = [];
  let noteChars = 0;
  const ranked = digests
    .filter((d) => d.summary || d.title)
    .sort((a, b) => matches(`${b.title} ${b.summary}`, stems) - matches(`${a.title} ${a.summary}`, stems) || b.from - a.from);
  for (const d of ranked) {
    const line = noteLine(d, locale);
    if (noteChars + line.length > NOTES_MAX_CHARS) break;
    notes.push(line);
    noteChars += line.length;
  }
  return { lines, notes: notes.join("\n") };
}
