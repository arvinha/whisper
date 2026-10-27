import { fromSummary } from "./agenda";
import { ApiError } from "./api";
import { getEngine } from "./engine";
import { addSuggestions } from "./inbox";
import { momentsSince, MOMENT_GAP_MS, pruneMemory, saveDigest, type Moment } from "./memory";
import { getSettings } from "./settings";

/**
 * While the app is open, each stretch of the day gets a short diary note once it is over (or once
 * a long one has grown enough), and the appointments and to-dos in it become suggestions.
 */

const TICK_MS = 60_000;
const FIRST_TICK_MS = 8_000;
const LOOKBACK_MS = 36 * 60 * 60_000;
/** Shorter stretches are usually noise or a few words in passing. */
const MIN_WORDS = 25;
/** A stretch still going on gets a note after this many new words. */
const RUNNING_WORDS = 300;
/** A stretch that grew after its note gets a new one with at least this many new words. */
const GROWN_WORDS = 40;
const BACKOFF_MS = 5 * 60_000;
const PLAN_BACKOFF_MS = 60 * 60_000;

let started = false;
let busy = false;
let backoffUntil = 0;

function due(m: Moment, now: number): boolean {
  if (m.words < MIN_WORDS) return false;
  const over = now - m.to > MOMENT_GAP_MS;
  const covered = m.digest?.words ?? 0;
  const grown = m.words - covered;
  if (!m.digest) return over || m.words >= RUNNING_WORDS;
  return over ? grown >= GROWN_WORDS : grown >= RUNNING_WORDS;
}

async function tick() {
  const settings = getSettings();
  if (busy || !settings.memory || Date.now() < backoffUntil) return;
  const engine = getEngine();
  const config = engine.getState().config;
  if (!config?.llm || (config.passwordRequired && !config.authorized) || (config.account && !config.account.active)) return;

  busy = true;
  try {
    const now = Date.now();
    const moment = (await momentsSince(now - LOOKBACK_MS)).find((m) => due(m, now));
    if (!moment) return;
    const result = await engine.digest(moment.lines);
    await saveDigest({
      from: moment.from,
      to: moment.to,
      words: moment.words,
      title: result.title,
      summary: result.summary,
      lang: result.lang,
      madeAt: now,
    });
    if (getSettings().suggest) {
      const added = addSuggestions(fromSummary(result), moment.from, result.title);
      if (added > 0) engine.notifySuggestions(added);
    }
    // More may be waiting: take the next one soon, one at a time.
    setTimeout(() => void tick(), 2_000);
  } catch (err) {
    backoffUntil = Date.now() + (err instanceof ApiError && err.isPlanError ? PLAN_BACKOFF_MS : BACKOFF_MS);
  } finally {
    busy = false;
  }
}

export function startDigester() {
  if (started || typeof window === "undefined") return;
  started = true;
  void pruneMemory(getSettings().memoryDays).catch(() => {});
  setTimeout(() => void tick(), FIRST_TICK_MS);
  setInterval(() => void tick(), TICK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void tick();
  });
}
