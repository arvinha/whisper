export type SttProvider = "openai" | "groq" | "mock";
export type LlmProvider = "openai" | "anthropic" | "groq" | "deepseek" | "mock";
export type TtsProvider = "azure" | "openai";

/** deep: a stronger model reads all of the prepared material and continues after the short answer. */
export type AnswerMode = "short" | "detail" | "deep";

/** All of the prepared material for a deep answer: about 80K tokens, read from the prompt cache after the first call. */
export const MAX_DEEP_CHARS = 320_000;
/**
 * In the head of every code project the server reads. Projects saved without it were read before
 * documents, references and readme-named code were included, so the phone reads them again.
 */
export const DIGEST_VERSION = "Läsversion: 2";
export type AnswerKind = "question" | "topic" | "none";
export type AnswerStyle = "smart" | "expert" | "witty";
export type LanguagePref = "auto" | "sv" | "da" | "en";

export const LANGUAGE_CODES = ["sv", "da", "en"] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export interface PublicConfig {
  stt: {
    provider: SttProvider;
    model: string;
    maxRequestsPerMinute: number;
    paceRequestsPerMinute: number;
    minSegmentMs: number;
  } | null;
  llm: {
    provider: LlmProvider;
    model: string;
    minPrefetchIntervalMs: number;
    maxContextChars: number;
    /** How much of the user's prepared material (CV, job ad, slides…) goes with each answer. */
    maxPrepChars: number;
    /** Tight token limits: prepare answers only for clear questions, details only on request. */
    frugal: boolean;
  } | null;
  cloudTts: { provider: TtsProvider; model: string; voice: string } | null;
  passwordRequired: boolean;
  /** Whether the password sent with this request (if any) was accepted. */
  authorized: boolean;
  /** Whose personal code it was (APP_USERS); "" for the main password. */
  user: string;
  mock: boolean;
  /** The phone sends diagnostic events to the server console (PHONE_LOG=1). */
  phoneLog: boolean;
  problems: string[];
  /**
   * Sign-up is possible; billing means paid plans can be bought; mail means e-mail codes work;
   * providers are the "Continue with …" buttons that are set up.
   */
  accounts: { enabled: boolean; billing: boolean; mail: boolean; sms: boolean; providers: AuthProvider[]; supportEmail: string };
  /** The signed-in account, when the request carried an account session. */
  account: AccountInfo | null;
  /** iCloud link to the "Whisper påminnelse" shortcut that adds to Apple's Reminders app, or "". */
  remindersShortcutUrl: string;
}

export type AuthProvider = "google" | "apple" | "microsoft" | "facebook";
/** "trial": free minutes left; "prepaid": paying from a bought balance. */
export type Plan = "trial" | "prepaid";
/** "empty": the bought balance is used up. "setup": a phone number, the terms or a password are missing. */
export type AccountReason = "" | "trial_over" | "empty" | "setup";
/** Top-ups of the balance, see TOPUPS in shared/pricing.ts. */
export type CheckoutKind = "kr50" | "kr100" | "kr250";

export interface AccountInfo {
  email: string;
  name: string;
  plan: Plan;
  active: boolean;
  /** Why the account cannot listen right now. */
  reason: AccountReason;
  /** Free listening left, in seconds of speech. */
  trialSecondsLeft: number;
  /** Bought balance in Swedish öre. */
  balanceOre: number;
  /** The currency of the first top-up, or null before one. */
  currency: "sek" | "dkk" | null;
  /** No trial: the e-mail address, phone or network already had one. */
  trialDenied: boolean;
  /** Has a Stripe customer, so receipts can be shown. */
  hasBilling: boolean;
  /** The checked mobile number, or "" before one is added. */
  phone: string;
  /** No password and no Google/Apple/Microsoft, so finishing the account must set one. */
  needsPassword: boolean;
}

export interface AuthResult {
  token: string;
}

export interface TranscriptLine {
  secondsAgo: number;
  text: string;
}

export interface AnsweredItem {
  secondsAgo: number;
  question: string;
  answer: string;
}

export interface AnswerRequest {
  mode: AnswerMode;
  transcript: TranscriptLine[];
  profile: string;
  style: AnswerStyle;
  language: LanguagePref;
  /** Short mode: answers the user has already heard, so the model does not give them again. */
  answered?: AnsweredItem[];
  /** Only used in detail and deep mode. */
  question?: string;
  /** Only used in detail and deep mode. */
  shortAnswer?: string;
  /** The user's prepared material for this situation, as plain text. Deep mode: all of it. */
  context?: string;
  /** The parts of the user's material (documents and code) that match what is being talked about. */
  snippets?: string;
  /** Deep mode: full texts of the documents shown only in part in `context`, searched by the answer. */
  library?: Array<{ name: string; text: string }>;
  /** Detail and deep mode: GitHub repos ("owner/name") in the material, whose newest changes are fetched. */
  repos?: string[];
  /** Deep mode: the answer needs fresh facts from the internet, so the model may search the web. */
  live?: boolean;
}

export interface AnswerResult {
  kind: AnswerKind;
  question: string;
  answer: string;
  /**
   * Short mode: the question is about the user's own material (projects, code, CV, the job), so the
   * answer is only an opener and a deep answer should follow right after it.
   */
  deep?: boolean;
  /** Short mode: the answer needs something looked up on the internet; the deep answer does that. */
  live?: boolean;
  lang: string;
  model: string;
  ms: number;
}

export type SummaryKind = "auto" | "meeting" | "lecture" | "conversation" | "debate" | "presentation";

export interface SummaryLine {
  /** Epoch milliseconds when it was said. */
  at: number;
  text: string;
  /** Said by the user (usually an answer from Aivia said out loud). */
  me: boolean;
}

/**
 * summary: notes of a recording. assist: the user talks to Aivia directly, with excerpts from the
 * memory as lines. digest: a short diary note of one stretch of the day, plus what not to forget.
 */
export type SummaryPurpose = "summary" | "assist" | "digest";

export interface SummaryRequest {
  purpose?: SummaryPurpose;
  kind: SummaryKind;
  lines: SummaryLine[];
  language: LanguagePref;
  profile: string;
  /** Optional request to the assistant, e.g. "skriv ett mejl till Erik om det vi bestämde". */
  instruction?: string;
  /** The phone's local time, "YYYY-MM-DDTHH:mm", for resolving "på fredag kl 14". */
  now: string;
  timeZone: string;
  utcOffsetMinutes: number;
  /** The user's prepared material, for getting names and terms right. */
  context?: string;
}

export interface SummaryTask {
  text: string;
  who: string;
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" local time, or "". */
  due: string;
}

export interface SummaryEvent {
  title: string;
  /** Local time "YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" when allDay. */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
  /** Minutes before start to remind; 0 = at start, -1 = no reminder. */
  remindMinutes: number;
}

export interface SummaryResult {
  title: string;
  kind: Exclude<SummaryKind, "auto">;
  summary: string;
  points: string[];
  decisions: string[];
  tasks: SummaryTask[];
  events: SummaryEvent[];
  openQuestions: string[];
  /** Debates: who argued what. */
  positions: Array<{ who: string; view: string }>;
  /** Answer to the instruction, if one was given. */
  reply: string;
  lang: string;
  model: string;
  ms: number;
  /** How many minutes of conversation the summary covers. */
  minutes: number;
}

export type PrepKind = "interview" | "meeting" | "presentation" | "exam" | "sales" | "other";

export interface ExtractResult {
  name: string;
  text: string;
  /** How the text was read: straight from the file, or by the AI model (scans, photos). */
  method: "text" | "ai";
  pages?: number;
  /** The text was longer than the limit and was cut. */
  truncated: boolean;
  /** "code": a project or source file; "web": a page read from a link. */
  kind?: PrepDocKind;
  /** Where it came from, for links. */
  url?: string;
}

export type PrepDocKind = "doc" | "code" | "web";

export interface GithubRepo {
  name: string;
  description: string;
  language: string;
  stars: number;
  pushedAt: string;
  url: string;
}

/** What a link turned into: a read page or project, or the repos of a GitHub user to pick from. */
export type LinkResult =
  | { type: "doc"; doc: ExtractResult }
  | { type: "repos"; user: string; repos: GithubRepo[] };

export interface PrepareRequest {
  kind: PrepKind;
  title: string;
  /** What the user wants to achieve or highlight. */
  notes: string;
  docs: Array<{ name: string; text: string }>;
  language: LanguagePref;
  profile: string;
}

export interface PrepBrief {
  title: string;
  /** How the user should present themselves in this situation. */
  pitch: string;
  /** Concrete facts worth having at hand: numbers, names, projects, requirements. */
  facts: string[];
  /** Likely questions with answers in the user's own voice. */
  questions: Array<{ q: string; a: string }>;
  /** Good questions for the user to ask. */
  askThem: string[];
  /** Weak spots or tricky points, and how to handle them. */
  watchOut: string[];
  lang: string;
  model: string;
  ms: number;
}

export interface TranscribeResult {
  text: string;
  ms: number;
}

export type ErrorCode =
  | "unauthorized"
  | "not_configured"
  | "bad_request"
  | "rate_limited"
  | "provider_auth"
  | "provider_error"
  | "timeout"
  | "network"
  | "internal"
  | "plan_required"
  | "trial_busy";

export interface ApiErrorBody {
  error: string;
  code: ErrorCode;
  retryAfterSeconds?: number;
}

export interface SelfTestItem {
  ok: boolean;
  ms: number;
  detail: string;
}

export interface SelfTestResult {
  stt: SelfTestItem;
  llm: SelfTestItem;
  tts: SelfTestItem | null;
}
