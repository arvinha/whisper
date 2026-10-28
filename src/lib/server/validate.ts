import type {
  AnsweredItem,
  AnswerRequest,
  AnswerStyle,
  LanguageCode,
  LanguagePref,
  PrepareRequest,
  PrepKind,
  SummaryKind,
  SummaryLine,
  SummaryPurpose,
  SummaryRequest,
  TranscriptLine,
} from "@/lib/shared/types";
import { LANGUAGE_CODES } from "@/lib/shared/types";
import { MAX_DEEP_CHARS, MAX_PREP_CHARS } from "./config";
import { AppError } from "./errors";

const STYLES: readonly AnswerStyle[] = ["smart", "expert", "witty"];
const LANGUAGE_PREFS: readonly LanguagePref[] = ["auto", "sv", "da", "en"];

const MAX_LINES = 80;
const MAX_LINE_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_ANSWERED = 5;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function seconds(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(86400, Math.round(n))) : 0;
}

function parseAnswered(value: unknown): AnsweredItem[] {
  const items = Array.isArray(value) ? value.slice(-MAX_ANSWERED) : [];
  const out: AnsweredItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const question = str(entry.question, 200);
    const answer = str(entry.answer, 400);
    if (question || answer) out.push({ secondsAgo: seconds(entry.secondsAgo), question, answer });
  }
  return out;
}

const SUMMARY_KINDS: readonly SummaryKind[] = ["auto", "meeting", "lecture", "conversation", "debate", "presentation"];
const SUMMARY_PURPOSES: readonly SummaryPurpose[] = ["summary", "assist", "digest"];
const MAX_SUMMARY_LINES = 6000;
const MAX_SUMMARY_LINE_CHARS = 1500;
/** About four hours of talk. */
const MAX_SUMMARY_CHARS = 400_000;

export function parseSummaryRequest(input: unknown): SummaryRequest {
  if (!input || typeof input !== "object") {
    throw new AppError(400, "bad_request", "Ogiltig förfrågan.");
  }
  const body = input as Record<string, unknown>;
  const rawLines = Array.isArray(body.lines) ? body.lines.slice(-MAX_SUMMARY_LINES) : [];
  const lines: SummaryLine[] = [];
  for (const item of rawLines) {
    if (!item || typeof item !== "object") continue;
    const line = item as Record<string, unknown>;
    const text = str(line.text, MAX_SUMMARY_LINE_CHARS);
    const at = Number(line.at);
    if (!text || !Number.isFinite(at)) continue;
    lines.push({ text, at, me: line.me === true });
  }
  lines.sort((a, b) => a.at - b.at);
  let chars = 0;
  let firstKept = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    chars += lines[i].text.length;
    if (chars > MAX_SUMMARY_CHARS && firstKept < lines.length) break;
    firstKept = i;
  }

  const instruction = str(body.instruction, 1000) || undefined;
  if (firstKept >= lines.length && !instruction) {
    throw new AppError(400, "bad_request", "Det finns inget samtal att sammanfatta än.");
  }
  const now = str(body.now, 16);
  const offset = Number(body.utcOffsetMinutes);
  return {
    purpose: SUMMARY_PURPOSES.find((p) => p === body.purpose) ?? "summary",
    kind: SUMMARY_KINDS.find((k) => k === body.kind) ?? "auto",
    lines: lines.slice(firstKept),
    language: LANGUAGE_PREFS.find((l) => l === body.language) ?? "auto",
    profile: str(body.profile, 800),
    instruction,
    now: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(now) ? now : new Date().toISOString().slice(0, 16),
    timeZone: str(body.timeZone, 64),
    utcOffsetMinutes: Number.isFinite(offset) ? Math.max(-840, Math.min(840, Math.round(offset))) : 0,
    context: str(body.context, MAX_SUMMARY_CONTEXT_CHARS) || undefined,
  };
}

const MAX_SUMMARY_CONTEXT_CHARS = 20_000;
const PREP_KINDS: readonly PrepKind[] = ["interview", "meeting", "presentation", "exam", "sales", "other"];
const MAX_PREP_DOCS = 20;
/** A few CVs, a job ad and a long slide deck. */
const MAX_PREP_TOTAL_CHARS = 200_000;

export function parsePrepareRequest(input: unknown): PrepareRequest {
  if (!input || typeof input !== "object") {
    throw new AppError(400, "bad_request", "Ogiltig förfrågan.");
  }
  const body = input as Record<string, unknown>;
  const rawDocs = Array.isArray(body.docs) ? body.docs.slice(0, MAX_PREP_DOCS) : [];
  const docs: PrepareRequest["docs"] = [];
  let total = 0;
  for (const item of rawDocs) {
    if (!item || typeof item !== "object") continue;
    const doc = item as Record<string, unknown>;
    const text = str(doc.text, Math.max(0, MAX_PREP_TOTAL_CHARS - total));
    if (!text) continue;
    total += text.length;
    docs.push({ name: str(doc.name, 120) || "Dokument", text });
  }
  const notes = str(body.notes, 2000);
  const title = str(body.title, 120);
  if (docs.length === 0 && !notes) {
    throw new AppError(400, "bad_request", "Lägg till minst en fil, en text eller vad du vill uppnå.");
  }
  return {
    kind: PREP_KINDS.find((k) => k === body.kind) ?? "other",
    title,
    notes,
    docs,
    language: LANGUAGE_PREFS.find((l) => l === body.language) ?? "auto",
    profile: str(body.profile, 800),
  };
}

export function parseLanguageCode(value: unknown): LanguageCode | undefined {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value)
    ? (value as LanguageCode)
    : undefined;
}

export function parseAnswerRequest(input: unknown): AnswerRequest {
  if (!input || typeof input !== "object") {
    throw new AppError(400, "bad_request", "Ogiltig förfrågan.");
  }
  const body = input as Record<string, unknown>;
  const mode = body.mode === "detail" || body.mode === "short" || body.mode === "deep" ? body.mode : null;
  if (!mode) throw new AppError(400, "bad_request", 'mode måste vara "short", "detail" eller "deep".');

  const rawLines = Array.isArray(body.transcript) ? body.transcript.slice(-MAX_LINES) : [];
  const lines: TranscriptLine[] = [];
  for (const item of rawLines) {
    if (!item || typeof item !== "object") continue;
    const line = item as Record<string, unknown>;
    const text = str(line.text, MAX_LINE_CHARS);
    if (!text) continue;
    lines.push({ text, secondsAgo: seconds(line.secondsAgo) });
  }

  // Keep the newest lines within the character budget.
  let chars = 0;
  let firstKept = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    chars += lines[i].text.length;
    if (chars > MAX_TRANSCRIPT_CHARS && firstKept < lines.length) break;
    firstKept = i;
  }

  const style = STYLES.find((s) => s === body.style) ?? "smart";
  const language = LANGUAGE_PREFS.find((l) => l === body.language) ?? "auto";

  return {
    mode,
    transcript: lines.slice(firstKept),
    profile: str(body.profile, 800),
    style,
    language,
    answered: parseAnswered(body.answered),
    question: str(body.question, 400) || undefined,
    shortAnswer: str(body.shortAnswer, 600) || undefined,
    context: str(body.context, mode === "deep" ? MAX_DEEP_CHARS : MAX_PREP_CHARS) || undefined,
    snippets: str(body.snippets, mode === "deep" ? MAX_DEEP_SNIPPET_CHARS : MAX_SNIPPET_CHARS) || undefined,
    repos: parseRepos(body.repos),
    live: mode === "deep" && body.live === true ? true : undefined,
    library: mode === "deep" ? parseLibrary(body.library) : undefined,
  };
}

const MAX_LIBRARY_DOCS = 20;
const MAX_LIBRARY_CHARS = 600_000;

function parseLibrary(value: unknown): Array<{ name: string; text: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<{ name: string; text: string }> = [];
  let room = MAX_LIBRARY_CHARS;
  for (const item of value.slice(0, MAX_LIBRARY_DOCS)) {
    if (!item || typeof item !== "object") continue;
    const doc = item as Record<string, unknown>;
    const text = str(doc.text, room);
    if (!text) continue;
    out.push({ name: str(doc.name, 200) || "Dokument", text });
    room -= text.length;
    if (room <= 0) break;
  }
  return out.length ? out : undefined;
}

const MAX_REPOS = 3;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

function parseRepos(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const repos = [...new Set(value.filter((r): r is string => typeof r === "string" && REPO.test(r)))];
  return repos.length > 0 ? repos.slice(0, MAX_REPOS) : undefined;
}

const MAX_SNIPPET_CHARS = 10_000;
const MAX_DEEP_SNIPPET_CHARS = 24_000;
