import type {
  AnswerKind,
  AnswerRequest,
  AnswerResult,
  AuthProvider,
  CheckoutKind,
  ExtractResult,
  LanguageCode,
  LinkResult,
  PrepBrief,
  PublicConfig,
  SummaryKind,
  SummaryLine,
  SummaryPurpose,
  SummaryResult,
  TranscriptLine,
} from "@/lib/shared/types";
import { MAX_DEEP_CHARS } from "@/lib/shared/types";
import { addAgendaItems, fromSummary } from "./agenda";
import { Api, ApiError, isAbort } from "./api";
import { AudioCapture, micErrorMessage, type CaptureState } from "./audio/capture";
import { archiveLine, recall, type MemoryLine } from "./memory";
import { saveSummary, type SavedSummary } from "./summaries";
import { deviceId } from "./device";
import { Segmenter } from "./audio/segmenter";
import { MediaButtons } from "./mediaButtons";
import { DICTS, type UiLang } from "@/lib/i18n";
import { FEATURES } from "@/lib/shared/features";
import { getT, uiLang } from "./i18n";
import { codeSnippets } from "./codeSearch";
import { briefDocs, deepMaterial, getActivePrep, prepContext, type Prep } from "./preps";
import { claimLegacy } from "./legacy";
import { legacyWaiting, onOwnerChange, ownedKey, ownerOf, setOwner } from "./owner";
import { getSettings, subscribeSettings, updateSettings } from "./settings";
import { Speaker, type BeepKind, type VoiceBackend } from "./speaker";
import { Transcriber, type TranscribedSegment } from "./transcriber";
import { cleanTranscript, looksLikeQuestion, similarity, wordCount } from "./transcriptFilter";
import { ScreenWakeLock, type WakeLockStatus } from "./wakeLock";

export type Phase =
  | "idle"
  | "starting"
  | "listening"
  | "thinking"
  | "speaking-short"
  | "short-done"
  | "fetching-detail"
  | "speaking-detail"
  | "detail-done";

export type InputMode = "mic" | "text";

export interface LineView {
  id: number;
  text: string;
  at: number;
  question: boolean;
  /** The user saying the answer out loud (or the answer heard back through the speaker). */
  own: boolean;
}

export interface AnswerView {
  id: number;
  at: number;
  kind: Exclude<AnswerKind, "none">;
  question: string;
  short: string;
  detail: string | null;
  lang: string;
  ms: number;
  prefetched: boolean;
  /** `short` is only an opener; the concrete answer from all of the material follows right after it. */
  deep?: boolean;
  /** The answer after the opener needs the internet (news, prices, a website), so it may search the web. */
  live?: boolean;
}

export interface Notice {
  id: number;
  text: string;
  tone: "info" | "warn" | "error";
}

/** A request to Aivia, typed or said ("Whisper, …"), and how it went. */
export interface AssistView {
  id: number;
  request: string;
  spoken: boolean;
  status: "working" | "done" | "failed";
  summaryId: string | null;
  /** Entries put in Whisper's calendar. */
  added: number;
  error: string;
}

export interface EngineState {
  phase: Phase;
  mode: InputMode | null;
  config: PublicConfig | null;
  configLoading: boolean;
  configError: string | null;
  needsPassword: boolean;
  interrupted: boolean;
  notice: Notice | null;
  lines: LineView[];
  current: AnswerView | null;
  history: AnswerView[];
  pendingTranscriptions: number;
  wakeLock: WakeLockStatus;
  micLabel: string;
  deviceVoiceProblem: boolean;
  assist: AssistView | null;
  /** What the current or last conversation used, for the balance bar. Null before the first one. */
  usage: SessionUsage | null;
}

export interface SessionUsage {
  startedAt: number;
  endedAt: number | null;
  /** Answers the user asked for. */
  answers: number;
  /** Taken from the bought balance, in öre. */
  spentOre: number;
  /** Free trial seconds used. */
  freeSeconds: number;
}

interface Line {
  id: number;
  text: string;
  startedAt: number;
  endedAt: number;
  question: boolean;
  own: boolean;
}

interface SpokenEntry {
  text: string;
  from: number;
  to: number;
  /** Answers only: speech until this time that resembles the answer is the user repeating it. */
  repeatUntil: number;
}

interface PrefetchEntry {
  basisId: number;
  createdAt: number;
  key: string;
  promise: Promise<AnswerResult>;
  result: AnswerResult | null;
  failed: boolean;
  /** Started as soon as the prefetched answer turned out to be an opener. */
  deep: Promise<AnswerResult> | null;
}

interface DetailEntry {
  answerId: number;
  promise: Promise<string>;
}

type CueName =
  | "nothingFound"
  | "nothingHeard"
  | "error"
  | "rateLimited"
  | "wait"
  | "nothingToRepeat";

const CUE_BEEPS: Record<CueName, BeepKind> = {
  nothingFound: "error",
  nothingHeard: "error",
  error: "error",
  rateLimited: "error",
  wait: "tick",
  nothingToRepeat: "error",
};

/** Spoken messages follow the conversation language, or the app's language when that is automatic. */
function spokenLang(): UiLang {
  const language = getSettings().language;
  return language === "auto" ? uiLang() : language;
}

function cueText(name: CueName): { text: string; lang: UiLang } {
  const lang = spokenLang();
  const cue = DICTS[lang].cues[name];
  return { text: getSettings().cue === "short" ? cue.short : cue.voice, lang };
}

const DETAIL_WINDOW_MS = 45_000;
const DETAIL_DONE_MS = 4_000;
const TRANSCRIBE_WAIT_MS = 9_000;
const DETAIL_WAIT_CUE_MS = 1_500;
/** If the opener is not ready this soon after a tap, a short filler plays so the user is never left in silence. */
const FILLER_DELAY_MS = 450;
/** The cloud voice sometimes stalls for many seconds; the first answer must not wait that long. */
const OPENER_VOICE_WAIT_MS = 3_000;
const PREFETCH_MAX_AGE_MS = 90_000;
const PREFETCH_MAX_NEW_WORDS = 8;
/** Shorter remarks ("ja", "okej då") after an answer do not count as the conversation moving on. */
const NEW_TALK_MIN_WORDS = 4;
const MAX_ANSWERED = 5;
/** Long enough for a whole meeting or lecture, so it can be summarized afterwards. */
const LINE_RETENTION_MS = 4 * 60 * 60_000;
const MAX_LINES = 4000;
const VISIBLE_LINES = 40;
/** The user often listens first and then says the answer, which takes about as long again. */
const REPEAT_TAIL_MIN_MS = 6_000;
const REPEAT_TAIL_EXTRA_MS = 3_000;
const OWN_SIMILARITY = 0.4;
const ECHO_SIMILARITY = 0.6;
/**
 * iOS mutes the microphone track for a moment when it reconfigures audio around playback. Such a
 * mute must not count as an AirPods press, or it cuts off the answer the user is saying along to.
 */
const SPEECH_MUTE_GUARD_MS = 1_200;
const TRANSCRIPT_KEY = "psst.transcript.v1";
const TRANSCRIPT_MAX_AGE_MS = 12 * 60 * 60_000;
const TRANSCRIPT_SAVE_MS = 2_000;
/** Summaries only need the prepared material for names and terms. */
const SUMMARY_PREP_CHARS = 15_000;
const HISTORY_SIZE = 50;
const NOTICE_MS = 7_000;
const MIC_CHECK_MS = 2_500;
/** The capture sends samples continuously, even in silence; a gap means the system stopped it. */
const MIC_STALL_MS = 3_000;
const MAX_MIC_RESTARTS = 2;
/** An unmute this soon after we asked for one is ours, not another press on the AirPods. */
const OWN_UNMUTE_MS = 1_500;
const DIAG_FLUSH_MS = 2_000;
const DIAG_BATCH = 60;
/**
 * "Whisper, påminn mig …" or "Hej Aivia, vad sa …": a request to the assistant rather than talk.
 * Speech recognition often writes the name a little differently.
 */
const WAKE = /^\s*(?:(?:hej|hey|hi|hallå|hallo|okej|okay|ok)[\s,]+)?(?:whisper|wisper|aivia|ivia|avia)\b[\s,.:;!?-]*(.*)$/i;
/** After the name alone, the next line within this time is the request. */
const WAKE_FOLLOW_MS = 10_000;
/** How much of the memory goes with a request. */
const ASSIST_MEMORY_CHARS = 40_000;
const ASSIST_MEMORY_CHARS_FRUGAL = 7_000;
const ASSIST_SPEAK_WAIT_MS = 20_000;

const INITIAL_STATE: EngineState = {
  phase: "idle",
  mode: null,
  config: null,
  configLoading: true,
  configError: null,
  needsPassword: false,
  interrupted: false,
  notice: null,
  lines: [],
  current: null,
  history: [],
  pendingTranscriptions: 0,
  wakeLock: "off",
  micLabel: "",
  deviceVoiceProblem: false,
  assist: null,
  usage: null,
};

/** Listening is charged on the server, so the balance is fetched this often during a conversation. */
const USAGE_REFRESH_MS = 45_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Local wall-clock time without a zone, e.g. "2026-10-19T23:35". */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class Engine {
  private state: EngineState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly api = new Api(() => getSettings().password);
  private readonly speaker = new Speaker(this.api);
  private readonly media = new MediaButtons();
  private readonly wake = new ScreenWakeLock((wakeLock) => this.set({ wakeLock }));

  private ctx: AudioContext | null = null;
  private capture: AudioCapture | null = null;
  private segmenter: Segmenter | null = null;
  private transcriber: Transcriber | null = null;

  private session = 0;
  /** Bumped whenever the current answer flow is abandoned, so stale async work is ignored. */
  private gen = 0;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeId = 0;

  private lines: Line[] = [];
  private nextLineId = 1;
  private nextAnswerId = 1;
  private prefetch: PrefetchEntry | null = null;
  private lastPrefetchAt = 0;
  private prefetchPausedUntil = 0;
  private detail: DetailEntry | null = null;
  private fillerTimer: ReturnType<typeof setTimeout> | null = null;
  /** The filler being played; the opener waits for it so it is not cut off. */
  private filler: Promise<boolean> | null = null;
  private fillerCount = 0;
  /** Newest transcript line the current answer was based on. */
  private answerBasisId = 0;
  /** Answers the user has heard, sent along so the model moves on to new questions. */
  private answered: Array<{ id: number; at: number; question: string; answer: string }> = [];
  private lastSpoken: { text: string; lang: string; detail: boolean } | null = null;
  private spokenLog: SpokenEntry[] = [];
  private speechEndedAt = 0;
  private transcriptRestored = false;
  /** Where the transcript is saved: the signed-in person's own key. */
  private transcriptKey: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private level = { rms: 0, speech: false };
  private micId = "";
  private sensitivity = 0;
  private samplesAt = 0;
  private samplesCount = 0;
  private samplesPeak = 0;
  private micTimer: ReturnType<typeof setInterval> | null = null;
  private micTicks = 0;
  private micTroubleSince = 0;
  private micRestarts = 0;
  private micMuted = false;
  private ownUnmuteUntil = 0;
  private diagQueue: string[] = [];
  private diagTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeUntil = 0;
  private nextAssistId = 1;
  private usageTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.speaker.onDeviceVoiceProblem = () => {
      if (!this.state.deviceVoiceProblem) this.set({ deviceVoiceProblem: true });
      this.speaker.beep("ready");
    };
    subscribeSettings(() => this.onSettingsChanged());
    onOwnerChange(() => this.onOwnerChanged());
  }

  /** Someone else signed in (or out): the transcript on screen was the previous person's. */
  private onOwnerChanged() {
    if (!this.transcriptRestored) return;
    if (ownedKey(TRANSCRIPT_KEY) === this.transcriptKey) {
      // Same person; things from before may just have become theirs.
      if (this.lines.length === 0) {
        this.transcriptRestored = false;
        this.restoreTranscript();
      }
      return;
    }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveTranscript();
    if (this.state.phase !== "idle") this.stop();
    this.lines = [];
    this.answered = [];
    this.spokenLog = [];
    this.lastSpoken = null;
    this.prefetch = null;
    this.set({ history: [], current: null });
    this.publishLines();
    this.transcriptRestored = false;
    this.restoreTranscript();
  }

  // ---- store -------------------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;
  getServerState = () => INITIAL_STATE;
  getLevel = () => this.level;

  private set(patch: Partial<EngineState>) {
    const usage = this.state.usage;
    const before = this.state.config?.account;
    const after = patch.config?.account;
    if (usage && before && after) {
      const spent = Math.max(0, before.balanceOre - after.balanceOre);
      const free = Math.max(0, before.trialSecondsLeft - after.trialSecondsLeft);
      if (spent > 0 || free > 0) {
        patch = { ...patch, usage: { ...usage, spentOre: usage.spentOre + spent, freeSeconds: usage.freeSeconds + free } };
      }
    }
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private setPhase(phase: Phase) {
    if (this.state.phase === phase) return;
    this.diag(`läge: ${phase}`);
    this.set({ phase });
  }

  private get running(): boolean {
    return this.state.mode !== null && this.state.phase !== "idle" && this.state.phase !== "starting";
  }

  // ---- config ------------------------------------------------------------------------------

  async loadConfig(): Promise<PublicConfig | null> {
    this.restoreTranscript();
    this.set({ configLoading: true, configError: null });
    try {
      const config = await this.api.config();
      this.adoptOwner(config);
      this.set({
        config,
        configLoading: false,
        needsPassword: config.passwordRequired && !config.authorized,
      });
      return config;
    } catch (err) {
      this.set({
        configLoading: false,
        configError: err instanceof Error ? err.message : getT().errors.serverUnreachable,
      });
      return null;
    }
  }

  /**
   * The phone shows the signed-in person's own things. A personal code is one person's phone, so
   * what was saved before becomes theirs; with an account the person is asked first.
   */
  private adoptOwner(config: PublicConfig) {
    setOwner(ownerOf(config));
    if (config.authorized && !config.account && legacyWaiting()) void claimLegacy();
  }

  /** Charges an answer the user asked for, in the background so the answer is never held up. */
  private chargeAnswer() {
    const config = this.state.config;
    if (!config?.account) return;
    const usage = this.state.usage;
    if (usage) this.set({ usage: { ...usage, answers: usage.answers + 1 } });
    this.api.answered().then(
      ({ account }) => {
        const current = this.state.config;
        if (account && current) this.set({ config: { ...current, account } });
      },
      () => {},
    );
  }

  /** Fetches the config again without showing a loading state, e.g. to update the balance. */
  async refreshConfig(): Promise<PublicConfig | null> {
    try {
      const config = await this.api.config();
      this.adoptOwner(config);
      this.set({ config, configError: null, needsPassword: config.passwordRequired && !config.authorized });
      return config;
    } catch {
      return null;
    }
  }

  async submitPassword(password: string): Promise<boolean> {
    updateSettings({ password });
    const config = await this.loadConfig();
    return !!config && config.authorized;
  }

  /** Logs in with e-mail and password; the session token is kept like a code. */
  async signIn(email: string, password: string): Promise<boolean> {
    const { token } = await this.api.login(email, password);
    return this.submitPassword(token);
  }

  async requestResetCode(email: string): Promise<void> {
    await this.api.requestResetCode(email, uiLang());
  }

  /** Sets a new password with the e-mailed code, and signs in. */
  async resetPassword(email: string, code: string, password: string): Promise<boolean> {
    const { token } = await this.api.resetPassword({ email, code, password });
    return this.submitPassword(token);
  }

  /** Sign-up, first step: a code goes to the e-mail and one to the phone. Returns the number as saved. */
  async signUp(form: { name: string; email: string; phone: string; password: string; terms: boolean }): Promise<string> {
    const { phone } = await this.api.signup({ ...form, lang: uiLang() });
    return phone;
  }

  async finishSignUp(email: string, emailCode: string, smsCode: string): Promise<boolean> {
    const { token } = await this.api.finishSignup({ email, emailCode, smsCode, device: deviceId() });
    return this.submitPassword(token);
  }

  async sendPhoneCode(phone: string): Promise<string> {
    return (await this.api.phoneCode(phone, uiLang())).phone;
  }

  /** Adds the phone number, the terms and, if needed, a password to the signed-in account. */
  async completeAccount(form: { phone: string; smsCode: string; terms: boolean; password?: string }): Promise<void> {
    const { account } = await this.api.completeAccount({ ...form, lang: uiLang(), device: deviceId() });
    const config = this.state.config;
    if (config) this.set({ config: { ...config, account } });
  }

  /** Google/Apple/Microsoft: leaves the app and comes back with `#login=` in the address. */
  signInWith(provider: AuthProvider) {
    window.location.assign(`${window.location.origin}/api/auth/${provider}/start?device=${encodeURIComponent(deviceId())}`);
  }

  async openCheckout(kind: CheckoutKind): Promise<void> {
    const { url } = await this.api.checkout(kind);
    window.location.href = url;
  }

  /** Back from Stripe: the webhook may land a moment later, so check a few times. */
  async afterPayment(status: string): Promise<void> {
    const t = getT();
    if (status !== "klar") {
      this.showNotice(t.account.paidCancelled, "warn");
      return;
    }
    const before = JSON.stringify(this.state.config?.account ?? null);
    this.showNotice(t.account.paidPending, "info");
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const config = await this.refreshConfig();
      if (config?.account && JSON.stringify(config.account) !== before && config.account.active) break;
    }
    this.showNotice(t.account.paidThanks, "info");
  }

  async openBillingPortal(): Promise<void> {
    const { url } = await this.api.portal();
    window.location.href = url;
  }

  logout() {
    if (this.state.phase !== "idle") this.stop();
    updateSettings({ password: "" });
    setOwner(null);
    void this.loadConfig();
  }

  startProblem(mode: InputMode): string | null {
    const { config, configError } = this.state;
    const t = getT();
    if (!config) return configError ?? t.errors.loadingConfig;
    if (config.passwordRequired && !config.authorized) return t.errors.enterCode;
    if (config.account && !config.account.active) return t.errors.planRequired;
    if (!config.llm) return config.problems.join(" ") || t.errors.noLlm;
    if (mode === "mic" && !config.stt) {
      return config.problems.join(" ") || t.errors.noStt;
    }
    return null;
  }

  // ---- start / stop ------------------------------------------------------------------------

  /** Must be called directly from a click/tap handler: iOS only unlocks audio inside a gesture. */
  start(mode: InputMode) {
    if (this.state.phase !== "idle") return;
    const problem = this.startProblem(mode);
    if (problem) {
      this.showNotice(problem, "error");
      return;
    }
    const session = ++this.session;

    // Synchronous part, inside the user gesture.
    this.ensureAudioContext();
    this.speaker.unlock();
    this.media.start({
      press: (source) => this.press(`hörlurar (${source})`),
      next: (source) => {
        this.diag(`upprepa via hörlurar (${source})`);
        this.repeat();
      },
      previous: (source) => {
        this.diag(`avbryt via hörlurar (${source})`);
        this.reset();
      },
    });
    void this.wake.enable();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    const usage = this.state.config?.account ? { startedAt: Date.now(), endedAt: null, answers: 0, spentOre: 0, freeSeconds: 0 } : null;
    this.set({ phase: "starting", mode, interrupted: false, notice: null, deviceVoiceProblem: false, usage });
    if (usage) this.usageTimer = setInterval(() => void this.refreshConfig(), USAGE_REFRESH_MS);
    this.diag(`start (${mode}), ${navigator.userAgent.slice(0, 120)}`);

    void this.startAsync(mode, session);
  }

  private async startAsync(mode: InputMode, session: number) {
    const config = this.state.config!;
    const settings = getSettings();
    this.micId = settings.micId;
    this.sensitivity = settings.sensitivity;

    if (mode === "mic" && !this.ctx) {
      this.stop();
      this.showNotice(getT().errors.noWebAudio, "error");
      return;
    }
    if (mode === "mic" && config.stt && this.ctx) {
      const stt = config.stt;
      const capture = this.createCapture();
      this.segmenter = new Segmenter({
        sampleRate: capture.sampleRate,
        sensitivity: settings.sensitivity,
        minSegmentMs: stt.minSegmentMs,
        onSegment: (segment) => {
          const seconds = ((segment.endedAt - segment.startedAt) / 1000).toFixed(1);
          this.diag(`ljudklipp ${seconds} s, tal ${segment.speechMs} ms (${segment.reason})`);
          this.transcriber?.enqueue(segment);
        },
        onLevel: (rms, speech) => {
          this.level = { rms, speech };
        },
      });
      this.transcriber = new Transcriber({
        api: this.api,
        sampleRate: capture.sampleRate,
        maxRequestsPerMinute: stt.maxRequestsPerMinute,
        paceRequestsPerMinute: stt.paceRequestsPerMinute,
        getLanguage: () => this.fixedLanguage(),
        getPrompt: () => this.transcriptTail(),
        onResult: (segment) => this.onTranscribed(segment),
        onError: (err, willRetry) => this.onTranscribeError(err, willRetry),
        onPendingChange: (pendingTranscriptions) => this.set({ pendingTranscriptions }),
      });
      this.capture = capture;
      try {
        const info = await capture.start();
        if (session !== this.session) return;
        this.set({ micLabel: info.label });
        this.diag(`mikrofon: ${info.label || "okänd"}, ${this.ctx.sampleRate} Hz, ljud ${this.ctx.state}`);
        this.samplesAt = Date.now();
        this.startMicWatch();
      } catch (err) {
        if (session !== this.session || isAbort(err)) return;
        this.stop();
        this.showNotice(micErrorMessage(err), "error");
        return;
      }
      // Starting the microphone can pause other audio on iOS.
      this.media.keepPlaying();
    }

    if (session !== this.session) return;
    if (settings.voice === "cloud" && config.cloudTts) {
      const cueNames: CueName[] = ["wait", "nothingFound", "error"];
      for (const name of cueNames) {
        const cue = cueText(name);
        this.speaker.prefetch(cue.text, cue.lang);
      }
      const fillerLangs: UiLang[] = settings.language === "auto" ? ["sv", "da", "en"] : [spokenLang()];
      for (const lang of fillerLangs) this.speaker.prefetch(this.nextFiller(lang), lang);
    }
    this.setPhase("listening");
  }

  stop() {
    this.diag("stopp");
    this.flushDiag();
    this.session++;
    this.gen++;
    this.clearPhaseTimer();
    if (this.micTimer) clearInterval(this.micTimer);
    this.micTimer = null;
    this.speaker.cancel();
    this.capture?.stop();
    this.capture = null;
    this.transcriber?.stop();
    this.transcriber = null;
    this.segmenter = null;
    this.media.stop();
    this.wake.disable();
    this.speaker.detach();
    if (this.ctx) {
      this.ctx.onstatechange = null;
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.prefetch = null;
    this.detail = null;
    this.level = { rms: 0, speech: false };
    if (this.usageTimer) clearInterval(this.usageTimer);
    this.usageTimer = null;
    const usage = this.state.usage && !this.state.usage.endedAt ? { ...this.state.usage, endedAt: Date.now() } : this.state.usage;
    this.set({ phase: "idle", mode: null, interrupted: false, pendingTranscriptions: 0, micLabel: "", usage });
    if (this.state.config?.account) void this.refreshConfig();
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.ctx && this.ctx.state !== "closed") {
      if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const ctx = new Ctor({ latencyHint: "interactive" });
      void ctx.resume().catch(() => {});
      ctx.onstatechange = () => this.onAudioContextState();
      this.ctx = ctx;
      this.speaker.attach(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private createCapture(): AudioCapture {
    return new AudioCapture(this.ctx!, {
      deviceId: getSettings().micId || undefined,
      onSamples: (samples) => {
        this.samplesAt = Date.now();
        this.samplesCount += samples.length;
        for (let i = 0; i < samples.length; i++) {
          const v = Math.abs(samples[i]);
          if (v > this.samplesPeak) this.samplesPeak = v;
        }
        this.segmenter?.push(samples);
      },
      onStateChange: (state) => this.onCaptureState(state),
    });
  }

  private async restartCapture() {
    if (this.state.mode !== "mic" || !this.ctx) return;
    this.capture?.stop();
    const capture = this.createCapture();
    this.capture = capture;
    try {
      const info = await capture.start();
      if (this.capture !== capture) return;
      this.samplesAt = Date.now();
      this.set({ micLabel: info.label });
      this.diag(`mikrofonen omstartad: ${info.label || "okänd"}`);
    } catch (err) {
      this.diag(`omstart misslyckades: ${err instanceof Error ? err.name : "okänt fel"}`);
      if (this.capture === capture && !isAbort(err)) {
        this.showNotice(micErrorMessage(err), "error");
        this.set({ interrupted: true });
      }
    }
  }

  // ---- interruptions -----------------------------------------------------------------------

  private onCaptureState(state: CaptureState) {
    if (!this.running) return;
    this.diag(`mikrofonspår: ${state}`);
    if (state === "muted") {
      // While the microphone records, iOS handles an AirPods stem press like the mute button in
      // a call: it mutes the microphone and tells the page nothing else. So the mute is the
      // press, and the microphone goes straight back on.
      this.micMuted = true;
      this.ownUnmuteUntil = Date.now() + OWN_UNMUTE_MS;
      void this.media.activateMicrophone().then((result) => this.diag(`slå på mikrofonen: ${result}`));
      if (this.duringSpeech()) this.diag("mikrofonen stängdes av under tal, räknas inte som tryck");
      else this.media.press("mikrofonen stängdes av");
      return;
    }
    if (state === "running") {
      // If iOS refused to unmute, the next stem press is what turns the microphone back on.
      const pressedAgain = this.micMuted && Date.now() > this.ownUnmuteUntil;
      this.micMuted = false;
      if (this.ctx?.state === "running") this.set({ interrupted: false });
      if (pressedAgain && !this.duringSpeech()) this.media.press("mikrofonen slogs på");
      return;
    }
    // Ended: checkMic restarts the capture.
    void this.media.activateMicrophone();
  }

  private duringSpeech(): boolean {
    return this.speaker.speaking || Date.now() - this.speechEndedAt < SPEECH_MUTE_GUARD_MS;
  }

  /**
   * iOS can silence the microphone without stopping the app (AirPods stem press, audio route
   * changes). Ask for it back, then restart the capture, and only bother the user if that fails.
   */
  private checkMic() {
    const capture = this.capture;
    if (this.state.mode !== "mic" || !this.running || !capture) return;
    const now = Date.now();
    if (++this.micTicks % 2 === 0) {
      this.diag(
        `puls: ${this.samplesCount} prov, topp ${this.samplesPeak.toFixed(3)}, ljud ${this.ctx?.state}, ` +
          `mikrofon ${capture.healthy ? "på" : "av"}, väntar på text ${this.transcriber?.pending ?? 0}`,
      );
      this.samplesCount = 0;
      this.samplesPeak = 0;
    }
    const stalled = now - this.samplesAt > MIC_STALL_MS;
    if (!stalled && capture.healthy) {
      this.micTroubleSince = 0;
      this.micRestarts = 0;
      return;
    }
    if (!this.micTroubleSince) {
      this.micTroubleSince = now;
      this.diag(stalled ? "mikrofonen skickar inget ljud" : "mikrofonen är avstängd");
      void this.media.activateMicrophone();
      if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
      return;
    }
    if (this.speaker.speaking || now - this.micTroubleSince < MIC_CHECK_MS) return;
    if (this.micRestarts >= MAX_MIC_RESTARTS) {
      if (!this.state.interrupted) this.set({ interrupted: true });
      return;
    }
    this.micRestarts++;
    this.micTroubleSince = now;
    this.diag(`startar om mikrofonen (försök ${this.micRestarts})`);
    void this.restartCapture();
  }

  private startMicWatch() {
    if (this.micTimer) clearInterval(this.micTimer);
    this.micTicks = 0;
    this.micTroubleSince = 0;
    this.micRestarts = 0;
    this.micTimer = setInterval(() => this.checkMic(), MIC_CHECK_MS);
  }

  private onAudioContextState() {
    if (!this.running || !this.ctx) return;
    const state = this.ctx.state as string;
    this.diag(`ljudmotor: ${state}`);
    if (state === "running") {
      if (!this.capture || this.capture.healthy) this.set({ interrupted: false });
    } else if (state === "suspended" || state === "interrupted") {
      this.set({ interrupted: true });
      // Short system interruptions often end by themselves; resuming lets an answer play on.
      const ctx = this.ctx;
      setTimeout(() => {
        if (this.ctx === ctx && this.running && ctx.state !== "running") void ctx.resume().catch(() => {});
      }, 400);
    }
  }

  private onVisibilityChange = () => {
    if (document.visibilityState !== "visible" || !this.running) return;
    this.wake.handleVisible();
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    setTimeout(() => {
      if (!this.running) return;
      const audioOk = !this.ctx || this.ctx.state === "running";
      const micOk = this.state.mode !== "mic" || (this.capture?.healthy ?? false);
      if (!audioOk || !micOk) this.set({ interrupted: true });
    }, 600);
  };

  /** Call from a tap after iOS paused audio (lock screen, phone call, Siri). */
  resume() {
    if (!this.running) return;
    this.diag("återuppta (tryck)");
    this.micRestarts = 0;
    this.micTroubleSince = 0;
    this.ensureAudioContext();
    this.media.keepPlaying();
    this.speaker.unlock();
    void (async () => {
      if (this.state.mode === "mic" && !(this.capture?.healthy ?? false)) await this.restartCapture();
      await sleep(300);
      const audioOk = !this.ctx || this.ctx.state === "running";
      const micOk = this.state.mode !== "mic" || (this.capture?.healthy ?? false);
      this.set({ interrupted: !(audioOk && micOk) });
      if (!audioOk || !micOk) {
        this.showNotice(getT().errors.audioResume, "error");
      }
    })();
  }

  // ---- settings ----------------------------------------------------------------------------

  private onSettingsChanged() {
    const s = getSettings();
    if (s.sensitivity !== this.sensitivity) {
      this.sensitivity = s.sensitivity;
      this.segmenter?.setSensitivity(s.sensitivity);
    }
    if (s.micId !== this.micId) {
      this.micId = s.micId;
      if (this.running && this.state.mode === "mic") void this.restartCapture();
    }
  }

  private fixedLanguage(): LanguageCode | undefined {
    const lang = getSettings().language;
    return lang === "auto" ? undefined : lang;
  }

  private settingsKey(): string {
    const s = getSettings();
    const prep = getActivePrep();
    return `${s.style}|${s.language}|${s.profile}|${prep ? `${prep.id}:${prep.updatedAt}` : ""}`;
  }

  /** The active preparation (CV, job ad, slides…) as text for the answer model. */
  private prepText(maxChars = this.state.config?.llm?.maxPrepChars ?? 0): string | undefined {
    return prepContext(getActivePrep(), maxChars) || undefined;
  }

  /** The parts of the user's code projects that match what is being talked about. */
  private snippetsFor(query: string): string | undefined {
    const max = this.state.config?.llm?.frugal ? 2500 : 7000;
    return codeSnippets(getActivePrep(), query, max) || undefined;
  }

  // ---- transcript --------------------------------------------------------------------------

  private onTranscribed(segment: TranscribedSegment) {
    const text = cleanTranscript(segment.text, segment.speechMs);
    if (!text) {
      this.diag(`text bortfiltrerad: "${segment.text.slice(0, 60)}"`);
      return;
    }
    const overlaps = (s: SpokenEntry, until: number) => segment.startedAt < until && segment.endedAt > s.from;
    // A cue ("Ett ögonblick") coming back through the phone speaker.
    if (this.spokenLog.some((s) => !s.repeatUntil && overlaps(s, s.to) && similarity(text, s.text) >= ECHO_SIMILARITY)) {
      this.diag(`egen signal bortfiltrerad: "${text.slice(0, 60)}"`);
      return;
    }
    // The user saying the answer out loud, while or after hearing it. Kept for summaries, but it
    // is not new conversation: it must not count as a question or as the talk moving on.
    const own = this.spokenLog.some((s) => {
      if (!s.repeatUntil || !overlaps(s, s.repeatUntil)) return false;
      const sim = similarity(text, s.text);
      return sim >= OWN_SIMILARITY && (sim >= 0.7 || !looksLikeQuestion(text));
    });
    this.diag(`${own ? "du upprepar" : "text"}: "${text.slice(0, 80)}"`);
    this.addLine(text, segment.startedAt, segment.endedAt, own);
  }

  private onTranscribeError(err: ApiError, willRetry: boolean) {
    this.diag(`taligenkänning fel: ${err.code} ${err.message.slice(0, 80)}${willRetry ? " (försöker igen)" : ""}`);
    const t = getT();
    if (err.code === "unauthorized") {
      this.set({ needsPassword: true });
      this.showNotice(t.errors.unauthorized, "error");
    } else if (err.isPlanError) {
      this.showNotice(err.message, "error");
      setTimeout(() => this.stop(), 0);
    } else if (err.fatal) {
      this.showNotice(err.message, "error");
    } else if (err.code === "rate_limited") {
      this.showNotice(t.errors.sttLimit(err.retryAfterSeconds ?? 10), "warn");
    } else if (!willRetry) {
      this.showNotice(t.errors.sttClip(err.message), "warn");
    }
  }

  addTextLine(text: string) {
    const t = text.trim();
    if (!t || !this.running) return;
    const now = Date.now();
    this.addLine(t.slice(0, 600), now - 1500, now);
  }

  clearTranscript() {
    this.lines = [];
    this.answered = [];
    this.prefetch = null;
    this.publishLines();
    this.saveTranscript();
  }

  /** The request when a line is said to Aivia; "" when only her name was said; null for talk. */
  private wakeRequest(text: string): string | null {
    const match = WAKE.exec(text);
    if (match) {
      const rest = match[1].trim();
      if (wordCount(rest) >= 2) return rest;
      this.wakeUntil = Date.now() + WAKE_FOLLOW_MS;
      return "";
    }
    if (Date.now() < this.wakeUntil) {
      this.wakeUntil = 0;
      return text;
    }
    return null;
  }

  private addLine(text: string, startedAt: number, endedAt: number, own = false) {
    if (!own && this.running && FEATURES.notes) {
      const request = this.wakeRequest(text);
      if (request !== null) {
        // Said to Aivia, so it is the user talking, not a question to answer in the conversation.
        own = true;
        this.diag(request ? `till Aivia: "${request.slice(0, 80)}"` : "Aivia kallad");
        if (request) void this.assist(request, { spoken: this.state.mode === "mic" });
        else this.speaker.beep("ready");
      }
    }
    if (FEATURES.notes && getSettings().memory) archiveLine({ at: startedAt, end: endedAt, text, me: own });
    const line: Line = {
      id: this.nextLineId++,
      text,
      startedAt,
      endedAt,
      question: !own && looksLikeQuestion(text),
      own,
    };
    let index = this.lines.length;
    while (index > 0 && this.lines[index - 1].startedAt > startedAt) index--;
    this.lines.splice(index, 0, line);
    const cutoff = Date.now() - LINE_RETENTION_MS;
    while (this.lines.length > 0 && this.lines[0].endedAt < cutoff) this.lines.shift();
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.publishLines();
    this.scheduleSave();
    this.maybePrefetch(line);
  }

  private publishLines() {
    this.set({
      lines: this.lines.slice(-VISIBLE_LINES).map((l) => ({
        id: l.id,
        text: l.text,
        at: l.endedAt,
        question: l.question,
        own: l.own,
      })),
    });
  }

  /** The transcript is kept on the phone, so a reload in the middle of a meeting loses nothing. */
  private restoreTranscript() {
    if (this.transcriptRestored || typeof window === "undefined") return;
    this.transcriptRestored = true;
    const key = ownedKey(TRANSCRIPT_KEY);
    this.transcriptKey = key;
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as { savedAt?: number; lines?: Line[] };
      if (!saved.savedAt || Date.now() - saved.savedAt > TRANSCRIPT_MAX_AGE_MS || !Array.isArray(saved.lines)) {
        window.localStorage.removeItem(key);
        return;
      }
      this.lines = saved.lines
        .filter((l) => l && typeof l.text === "string" && Number.isFinite(l.startedAt) && Number.isFinite(l.endedAt))
        .map((l, i) => ({
          id: i + 1,
          text: l.text,
          startedAt: l.startedAt,
          endedAt: l.endedAt,
          question: !!l.question,
          own: !!l.own,
        }));
      this.nextLineId = this.lines.length + 1;
      this.publishLines();
    } catch {
      // unreadable: start empty
    }
  }

  private scheduleSave() {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = null;
      this.saveTranscript();
    }, TRANSCRIPT_SAVE_MS);
  }

  private saveTranscript() {
    const key = this.transcriptKey;
    if (typeof window === "undefined" || !key) return;
    try {
      if (this.lines.length === 0) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), lines: this.lines }));
    } catch {
      // storage full: the transcript stays in memory
    }
  }

  /** How much there is to summarize, for the summary sheet. */
  transcriptStats(): { lines: number; words: number; minutes: number } {
    const first = this.lines[0];
    const last = this.lines.at(-1);
    return {
      lines: this.lines.length,
      words: this.lines.reduce((n, l) => n + wordCount(l.text), 0),
      minutes: first && last ? Math.max(1, Math.round((last.endedAt - first.startedAt) / 60_000)) : 0,
    };
  }

  async summarize(opts: { kind: SummaryKind; minutes: number | null; instruction: string }): Promise<SummaryResult> {
    this.segmenter?.flush();
    if (this.transcriber && this.transcriber.pending > 0) {
      this.transcriber.hurry();
      await this.transcriber.whenIdle(TRANSCRIBE_WAIT_MS);
    }
    const since = opts.minutes ? Date.now() - opts.minutes * 60_000 : 0;
    const lines: SummaryLine[] = this.lines
      .filter((l) => l.endedAt >= since)
      .map((l) => ({ at: l.startedAt, text: l.text, me: l.own }));
    return this.requestSummary(opts.kind, lines, opts.instruction, this.summaryPrep());
  }

  /** Asks Aivia to turn e.g. "tandläkare torsdag kl 14" into calendar entries. */
  askCalendar(instruction: string): Promise<SummaryResult> {
    return this.requestSummary("auto", [], instruction, undefined);
  }

  /** A short diary note of one stretch of the memory, with what the user should not forget. */
  digest(lines: MemoryLine[]): Promise<SummaryResult> {
    const summaryLines = lines.map((l) => ({ at: l.at, text: l.text, me: l.me }));
    return this.requestSummary("auto", summaryLines, "", undefined, "digest");
  }

  /**
   * Anything the user asks Aivia, typed or said ("Whisper, påminn mig om det där med tandläkaren").
   * She gets the latest minutes and the parts of the memory that match the request. Said out loud
   * while listening, a short "one moment" plays at once and the answer follows in the ear.
   */
  async assist(request: string, opts: { spoken: boolean }): Promise<SavedSummary | null> {
    const text = request.trim().slice(0, 1000);
    if (!text) return null;
    const id = this.nextAssistId++;
    const view: AssistView = { id, request: text, spoken: opts.spoken, status: "working", summaryId: null, added: 0, error: "" };
    this.set({ assist: view });
    const update = (patch: Partial<AssistView>) => {
      if (this.state.assist?.id === id) this.set({ assist: { ...this.state.assist, ...patch } });
    };
    const speak = opts.spoken && this.running && this.state.mode === "mic";
    if (speak && !this.speaker.speaking) void this.say("wait");

    try {
      const frugal = !!this.state.config?.llm?.frugal;
      const memory = await this.memoryFor(text, frugal ? ASSIST_MEMORY_CHARS_FRUGAL : ASSIST_MEMORY_CHARS);
      const prep = this.summaryPrep();
      const context = [memory.notes && `Diary notes:\n${memory.notes}`, prep && `Uploaded material:\n${prep}`]
        .filter(Boolean)
        .join("\n\n");
      const result = await this.requestSummary("auto", memory.lines, text, context || undefined, "assist");
      const saved = saveSummary(result, text);
      const added = addAgendaItems(fromSummary(saved));
      update({ status: "done", summaryId: saved.id, added });
      if (speak && result.reply) await this.speakWhenFree(result.reply.slice(0, 1500), result.lang);
      return saved;
    } catch (err) {
      const message = err instanceof Error && !isAbort(err) ? err.message : getT().assist.failed;
      update({ status: "failed", error: message });
      if (speak) await this.say("error");
      if (err instanceof ApiError && err.isPlanError) void this.refreshConfig();
      return null;
    }
  }

  dismissAssist() {
    this.set({ assist: null });
  }

  /** The memory when it is on, otherwise the live transcript of the last hours. */
  private async memoryFor(request: string, maxChars: number): Promise<{ lines: SummaryLine[]; notes: string }> {
    if (getSettings().memory) {
      try {
        return await recall(request, maxChars, getT().locale);
      } catch {
        // the phone's storage failed: fall back to the live transcript
      }
    }
    const lines: SummaryLine[] = [];
    let chars = 0;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      chars += this.lines[i].text.length + 20;
      if (chars > maxChars) break;
      lines.unshift({ at: this.lines[i].startedAt, text: this.lines[i].text, me: this.lines[i].own });
    }
    return { lines, notes: "" };
  }

  /** Waits until no answer is playing, so Aivia does not talk over herself. */
  private async speakWhenFree(text: string, lang: string) {
    const until = Date.now() + ASSIST_SPEAK_WAIT_MS;
    while (Date.now() < until && this.running) {
      const phase = this.state.phase;
      const busy = this.speaker.speaking || phase === "thinking" || phase === "fetching-detail";
      if (!busy) break;
      await sleep(300);
    }
    if (!this.running) return;
    this.lastSpoken = { text, lang, detail: false };
    await this.speakText(text, lang, false);
  }

  /** Aivia found appointments or to-dos in what she heard. */
  notifySuggestions(count: number) {
    this.showNotice(getT().inbox.found(count), "info");
    if (this.running && this.state.mode === "mic" && !this.speaker.speaking) this.speaker.beep("ready");
  }

  private summaryPrep(): string | undefined {
    return this.prepText(Math.min(this.state.config?.llm?.maxPrepChars ?? 0, SUMMARY_PREP_CHARS));
  }

  private requestSummary(
    kind: SummaryKind,
    lines: SummaryLine[],
    instruction: string,
    context: string | undefined,
    purpose: SummaryPurpose = "summary",
  ) {
    const s = getSettings();
    const now = new Date();
    return this.api.summary({
      purpose,
      kind,
      lines,
      language: s.language,
      profile: s.profile,
      instruction: instruction.trim() || undefined,
      now: localIso(now),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      utcOffsetMinutes: -now.getTimezoneOffset(),
      context,
    });
  }

  /** Reads the text out of a file (CV, job ad, slides…) for a preparation. */
  readFile(file: Blob, name: string): Promise<ExtractResult> {
    return this.api.extract(file, name);
  }

  /** Reads a job ad, a company site or GitHub projects behind a link. */
  readLink(url: string): Promise<LinkResult> {
    return this.api.link(url);
  }

  /** Likely questions with answers, key facts and a pitch, from a preparation's material. */
  makeBrief(prep: Prep): Promise<PrepBrief> {
    const s = getSettings();
    return this.api.prepare({
      kind: prep.kind,
      title: prep.title,
      notes: prep.notes,
      docs: briefDocs(prep),
      language: s.language,
      profile: s.profile,
    });
  }

  /** Reads a text into the earbuds, e.g. a summary. */
  readAloud(text: string, lang: string) {
    this.ensureAudioContext();
    this.speaker.unlock();
    void this.speakText(text, lang, false);
  }

  stopReading() {
    const phase = this.state.phase;
    if (phase !== "speaking-short" && phase !== "speaking-detail") this.speaker.cancel();
  }

  private transcriptTail(): string {
    return this.lines
      .slice(-2)
      .map((l) => l.text)
      .join(" ")
      .slice(-150);
  }

  private buildTranscript(): TranscriptLine[] {
    const now = Date.now();
    const s = getSettings();
    const maxChars = this.state.config?.llm?.maxContextChars ?? 6000;
    const since = now - s.contextMinutes * 60_000;
    // What the user said is already in `answered`; as plain lines it would look like new talk.
    const recent = this.lines.filter((l) => l.endedAt >= since && !l.own);
    const out: TranscriptLine[] = [];
    let chars = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      chars += recent[i].text.length + 12;
      if (chars > maxChars && out.length > 0) break;
      out.unshift({
        secondsAgo: Math.max(0, Math.round((now - recent[i].endedAt) / 1000)),
        text: recent[i].text,
      });
    }
    return out;
  }

  private shortRequest(transcript: TranscriptLine[]): AnswerRequest {
    const s = getSettings();
    const now = Date.now();
    const since = now - s.contextMinutes * 60_000;
    const answered = this.answered
      .filter((a) => a.at >= since)
      .map((a) => ({ secondsAgo: Math.round((now - a.at) / 1000), question: a.question, answer: a.answer }));
    return {
      mode: "short",
      transcript,
      profile: s.profile,
      style: s.style,
      language: s.language,
      answered,
      context: this.prepText(),
      snippets: this.snippetsFor(
        transcript
          .slice(-4)
          .map((l) => l.text)
          .join(" "),
      ),
    };
  }

  // ---- prefetch ----------------------------------------------------------------------------

  private maybePrefetch(line: Line) {
    const llm = this.state.config?.llm;
    if (!llm || !line.question || !this.running) return;
    if (llm.frugal && !line.text.includes("?")) return;
    const phase = this.state.phase;
    if (phase !== "listening" && phase !== "short-done" && phase !== "detail-done") return;
    const now = Date.now();
    if (now < this.prefetchPausedUntil || now - this.lastPrefetchAt < llm.minPrefetchIntervalMs) return;
    if (this.prefetch && !this.prefetch.result && !this.prefetch.failed) return;

    this.lastPrefetchAt = now;
    const entry: PrefetchEntry = {
      basisId: line.id,
      createdAt: now,
      key: this.settingsKey(),
      promise: this.api.answer(this.shortRequest(this.buildTranscript())),
      result: null,
      failed: false,
      deep: null,
    };
    entry.promise.then(
      (result) => {
        entry.result = result;
        if (this.prefetch !== entry || result.kind !== "question") return;
        const deep = result.deep && !entry.deep ? this.deepRequest(result.question, result.answer, !!result.live) : null;
        if (deep) {
          entry.deep = this.api.answer(deep);
          entry.deep.catch(() => {});
        }
        // One press plays the answer at once, so have its audio ready too.
        if (this.cloudVoice() && result.answer) this.speaker.prefetch(result.answer, result.lang);
        if (getSettings().alertOnQuestion && this.state.phase === "listening") this.speaker.beep("ready");
      },
      (err: unknown) => {
        entry.failed = true;
        if (err instanceof ApiError && err.code === "rate_limited") {
          this.prefetchPausedUntil = Date.now() + Math.max(60, err.retryAfterSeconds ?? 0) * 1000;
        }
      },
    );
    this.prefetch = entry;
  }

  private usablePrefetch(): PrefetchEntry | null {
    const p = this.prefetch;
    if (!p || p.failed) return null;
    if (Date.now() - p.createdAt > PREFETCH_MAX_AGE_MS || p.key !== this.settingsKey()) return null;
    if (p.result && (p.result.kind === "none" || !p.result.answer)) return null;
    const newer = this.lines.filter((l) => l.id > p.basisId && !l.own);
    if (newer.some((l) => l.question)) return null;
    if (newer.reduce((n, l) => n + wordCount(l.text), 0) > PREFETCH_MAX_NEW_WORDS) return null;
    return p;
  }

  // ---- button logic ------------------------------------------------------------------------

  /**
   * The single button: one press plays the short answer straight away, then the app listens on.
   * The next press answers a new question if one has come up, otherwise it explains the answer
   * just heard.
   */
  press(source = "skärmen") {
    if (!this.running) return;
    this.diag(`tryck via ${source} (${this.state.phase})`);
    this.ensureAudioContext();
    switch (this.state.phase) {
      case "thinking":
      case "fetching-detail":
        this.speaker.beep("tick");
        return;
      case "speaking-short":
        void this.speakDetail();
        return;
      case "short-done":
        void this.analyze("detail");
        return;
      case "speaking-detail":
        this.stopSpeaking();
        return;
      default:
        void this.analyze();
    }
  }

  /** Long press / double click on headphones: repeat what was said last. */
  repeat() {
    if (!this.running) return;
    this.ensureAudioContext();
    const phase = this.state.phase;
    if (phase === "thinking" || phase === "fetching-detail") return;
    const last = this.lastSpoken;
    if (!last) {
      void this.say("nothingToRepeat");
      return;
    }
    const gen = ++this.gen;
    this.clearPhaseTimer();
    this.setPhase(last.detail ? "speaking-detail" : "speaking-short");
    void this.speakText(last.text, last.lang, false, true).then(() => {
      if (gen !== this.gen) return;
      if (last.detail) this.afterDetail();
      else this.afterShort();
    });
  }

  /** Forget the current answer and go back to listening. */
  reset() {
    if (!this.running) return;
    this.gen++;
    this.clearPhaseTimer();
    this.speaker.cancel();
    this.prefetch = null;
    this.setPhase("listening");
  }

  /** Start a fresh analysis regardless of the current step. */
  analyzeNow() {
    if (!this.running) return;
    this.ensureAudioContext();
    this.speaker.cancel();
    void this.analyze();
  }

  private stopSpeaking() {
    this.gen++;
    this.clearPhaseTimer();
    this.speaker.cancel();
    this.setPhase("listening");
  }

  /**
   * Whether someone asked a question or said something real after the current answer was made,
   * not counting the user saying the answer out loud.
   */
  private movedOn(): boolean {
    const current = this.state.current;
    if (!current) return true;
    return this.lines.some(
      (l) =>
        l.id > this.answerBasisId &&
        !l.own &&
        similarity(l.text, current.short) < 0.5 &&
        (l.question || wordCount(l.text) >= NEW_TALK_MIN_WORDS),
    );
  }

  private heardCurrent(): boolean {
    const id = this.state.current?.id;
    return this.answered.some((a) => a.id === id);
  }

  /**
   * Answers the newest open question and plays the answer right away. `fallback` "detail" means
   * the press came right after an answer: if nothing new has come up, explain that answer instead.
   */
  private async analyze(fallback?: "detail") {
    const gen = ++this.gen;
    this.clearPhaseTimer();
    this.speaker.cancel();
    this.setPhase("thinking");
    this.speaker.beep("tick");
    this.scheduleFiller(gen);

    // Make sure the last thing said is transcribed before answering.
    this.segmenter?.flush();
    const transcriber = this.transcriber;
    if (transcriber && transcriber.pending > 0) {
      transcriber.hurry();
      const done =
        transcriber.blockedForMs() < TRANSCRIBE_WAIT_MS && (await transcriber.whenIdle(TRANSCRIBE_WAIT_MS));
      if (gen !== this.gen) return;
      if (!done) this.showNotice(getT().errors.sttSlow, "warn");
    }

    if (!this.movedOn()) {
      if (fallback) {
        void this.speakDetail();
        return;
      }
      if (this.heardCurrent()) {
        await this.say("nothingFound");
        if (gen === this.gen) this.setPhase("listening");
        return;
      }
    }

    const transcript = this.buildTranscript();
    const basisId = this.nextLineId - 1;
    if (transcript.length === 0) {
      await this.say("nothingHeard");
      if (gen === this.gen) this.setPhase("listening");
      return;
    }

    let result: AnswerResult | null = null;
    let prefetched = false;
    const p = this.usablePrefetch();
    // Started together with the opener, so the concrete answer is ready by the time the opener has been said.
    let early: Promise<AnswerResult> | null = null;
    if (p && !p.result && !p.deep) {
      early = this.earlyDeep();
      p.deep = early;
    }
    if (p) {
      try {
        result = await p.promise;
        prefetched = result.kind !== "none" && !!result.answer;
        if (!prefetched) result = null;
      } catch {
        result = null;
      }
      if (gen !== this.gen) return;
    }
    if (this.prefetch === p) this.prefetch = null;
    if (!result && !early) early = this.earlyDeep();

    if (!result) {
      try {
        result = await this.api.answer(this.shortRequest(transcript));
      } catch (err) {
        if (gen !== this.gen) return;
        await this.failAnswer(err);
        if (gen === this.gen) this.setPhase("listening");
        return;
      }
      if (gen !== this.gen) return;
    }

    if (result.kind === "none" || !result.answer) {
      if (fallback && this.state.current) {
        void this.speakDetail();
        return;
      }
      await this.say("nothingFound");
      if (gen === this.gen) this.setPhase("listening");
      return;
    }

    const view: AnswerView = {
      id: this.nextAnswerId++,
      at: Date.now(),
      kind: result.kind,
      question: result.question,
      short: result.answer,
      detail: null,
      lang: result.lang,
      ms: result.ms,
      prefetched,
      deep: result.deep,
      live: result.live,
    };
    this.detail = null;
    this.answerBasisId = basisId;
    this.set({ current: view, history: [view, ...this.state.history].slice(0, HISTORY_SIZE) });
    this.chargeAnswer();
    const started = prefetched ? (p?.deep ?? null) : early;
    // The early answer had no web search; one that needs the internet starts again with it.
    const usable = started && !(view.live && started === early) ? started : null;
    if (view.deep) this.startDetail(view, usable);
    this.diag(`svar ${result.ms} ms${view.deep ? (usable ? ", djupt redan startat" : ", djupt") : ""}${view.live ? ", internet" : ""}`);
    void this.speakShort();
  }

  /** The newest question since the last answer, answered from all of the material right away. */
  private earlyDeep(): Promise<AnswerResult> | null {
    const fresh = this.lines.filter((l) => l.id > this.answerBasisId && !l.own);
    const question = [...fresh].reverse().find((l) => l.question)?.text ?? fresh.at(-1)?.text;
    if (!question) return null;
    const req = this.deepRequest(question, "");
    if (!req) return null;
    const promise = this.api.answer(req);
    promise.catch(() => {});
    return promise;
  }

  private fillerLang(): UiLang {
    if (getSettings().language !== "auto") return spokenLang();
    const text = this.lines
      .filter((l) => !l.own)
      .slice(-3)
      .map((l) => l.text)
      .join(" ")
      .toLowerCase();
    const count = (re: RegExp) => text.match(re)?.length ?? 0;
    const scores = (
      [
        ["sv", count(/(?<!\p{L})(och|är|inte|hur|varför|vad|vill|också|berätta|tycker|jobbar|kan|har)(?!\p{L})|[äö]/gu)],
        ["da", count(/(?<!\p{L})(og|ikke|hvordan|hvorfor|hvad|vil|også|fortæl|synes|arbejder|kan|har)(?!\p{L})|[æø]/gu)],
        ["en", count(/(?<!\p{L})(the|and|is|are|what|why|how|you|your|would|about|with|have|tell|do|does|can)(?!\p{L})/gu)],
      ] as Array<[UiLang, number]>
    ).sort((a, b) => b[1] - a[1]);
    if (scores[0][1] >= 1 && scores[0][1] >= scores[1][1] * 2) return scores[0][0];
    const last = this.state.current?.lang;
    return last === "sv" || last === "da" || last === "en" ? last : spokenLang();
  }

  private nextFiller(lang: UiLang): string {
    const fillers = DICTS[lang].cues.fillers;
    return fillers[this.fillerCount % fillers.length];
  }

  /**
   * Fills the silence while the opener is written and turned into speech: if it is not ready soon
   * after the tap, a short ready-made filler ("Mm, bra fråga.") plays at once.
   */
  private scheduleFiller(gen: number) {
    this.cancelFiller();
    if (getSettings().cue === "beep") return;
    this.fillerTimer = setTimeout(() => {
      this.fillerTimer = null;
      if (gen !== this.gen || this.state.phase !== "thinking") return;
      // Only when there is something to answer: speech still being transcribed, or new talk.
      const transcribing = (this.transcriber?.pending ?? 0) > 0;
      if (!transcribing && (this.lines.length === 0 || !this.movedOn())) return;
      const lang = this.fillerLang();
      const text = this.nextFiller(lang);
      this.fillerCount++;
      const playing = this.speakText(text, lang, true, true);
      this.filler = playing;
      void playing.finally(() => {
        if (this.filler === playing) this.filler = null;
      });
      if (this.cloudVoice()) this.speaker.prefetch(this.nextFiller(lang), lang);
    }, FILLER_DELAY_MS);
  }

  private cancelFiller() {
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    this.fillerTimer = null;
  }

  private async speakShort() {
    const current = this.state.current;
    if (!current) {
      void this.analyze();
      return;
    }
    const gen = this.gen;
    this.clearPhaseTimer();
    this.cancelFiller();
    this.setPhase("speaking-short");
    // Prepare the explanation while the short answer plays, unless tokens are scarce.
    if (!this.state.config?.llm?.frugal) this.startDetail(current);
    if (this.filler) {
      // Download the opener's voice during the filler, then let the filler finish.
      if (this.cloudVoice()) this.speaker.prefetch(current.short, current.lang);
      await this.filler;
      if (gen !== this.gen || this.state.phase !== "speaking-short") return;
    }
    this.lastSpoken = { text: current.short, lang: current.lang, detail: false };
    if (!this.answered.some((a) => a.id === current.id)) {
      // Timed from when the answer was made, so anything said after that counts as new.
      this.answered.push({ id: current.id, at: current.at, question: current.question, answer: current.short });
      if (this.answered.length > MAX_ANSWERED) this.answered.shift();
    }
    await this.speakText(current.short, current.lang, false, true, OPENER_VOICE_WAIT_MS);
    if (gen !== this.gen || this.state.phase !== "speaking-short") return;
    if (current.deep) void this.speakDetail();
    else this.afterShort();
  }

  private afterShort() {
    this.setPhase("short-done");
    this.startPhaseTimer(DETAIL_WINDOW_MS, () => this.setPhase("listening"));
  }

  /**
   * The answer that follows the short one. For questions about the user's material it is a deep
   * answer, where a stronger model reads all of it; `early` is one already started from the prefetch.
   */
  private startDetail(current: AnswerView, early?: Promise<AnswerResult> | null) {
    if (current.detail || this.detail?.answerId === current.id) return;
    const promise = (early ?? this.api.answer(this.detailRequest(current))).then((result) => {
      this.updateAnswer(current.id, { detail: result.answer });
      if (this.cloudVoice()) this.speaker.prefetch(result.answer, current.lang);
      return result.answer;
    });
    const entry: DetailEntry = { answerId: current.id, promise };
    promise.catch(() => {
      if (this.detail === entry) this.detail = null;
    });
    this.detail = entry;
  }

  private detailRequest(current: AnswerView): AnswerRequest {
    const deep = current.deep ? this.deepRequest(current.question, current.short, current.live) : null;
    if (deep) return deep;
    const s = getSettings();
    return {
      mode: "detail",
      transcript: this.buildTranscript(),
      profile: s.profile,
      style: s.style,
      language: s.language,
      question: current.question,
      shortAnswer: current.short,
      context: this.prepText(),
      snippets: this.snippetsFor(`${current.question} ${current.short} ${this.transcriptTail()}`),
      repos: this.repos(),
    };
  }

  /**
   * All of the active prep for the stronger model; null without material (unless the answer needs
   * the internet) or when tokens are scarce.
   */
  private deepRequest(question: string, opener: string, live = false): AnswerRequest | null {
    if (this.state.config?.llm?.frugal) return null;
    const { context, snippets } = deepMaterial(getActivePrep(), MAX_DEEP_CHARS, `${question} ${this.transcriptTail()}`);
    if (!context && !live) return null;
    const s = getSettings();
    return {
      mode: "deep",
      transcript: this.buildTranscript(),
      profile: s.profile,
      style: s.style,
      language: s.language,
      question,
      shortAnswer: opener,
      context: context || undefined,
      snippets: snippets || undefined,
      repos: this.repos(),
      ...(live ? { live } : {}),
    };
  }

  /** GitHub repos in the active prep, whose newest changes the server fetches with each detailed answer. */
  private repos(): string[] | undefined {
    const repos = (getActivePrep()?.docs ?? []).flatMap((d) => {
      const match = d.kind === "code" && d.url ? /^https:\/\/github\.com\/([^/]+\/[^/?#]+)/.exec(d.url) : null;
      return match ? [match[1]] : [];
    });
    return repos.length > 0 ? repos.slice(0, 3) : undefined;
  }

  private async speakDetail() {
    const current = this.state.current;
    if (!current) return;
    const gen = ++this.gen;
    this.clearPhaseTimer();
    this.speaker.cancel();

    let text = current.detail;
    if (!text) {
      this.setPhase("fetching-detail");
      this.startDetail(current);
      const pending = this.detail?.promise;
      if (!pending) return;
      const waitCue = setTimeout(() => {
        if (gen === this.gen && this.state.phase === "fetching-detail") void this.say("wait");
      }, DETAIL_WAIT_CUE_MS);
      try {
        text = await pending;
      } catch (err) {
        clearTimeout(waitCue);
        if (gen !== this.gen) return;
        await this.failAnswer(err);
        if (gen === this.gen) this.afterShort();
        return;
      }
      clearTimeout(waitCue);
      if (gen !== this.gen || this.state.phase !== "fetching-detail") return;
    }

    this.setPhase("speaking-detail");
    this.lastSpoken = { text, lang: current.lang, detail: true };
    await this.speakText(text, current.lang, false, true);
    if (gen !== this.gen || this.state.phase !== "speaking-detail") return;
    this.afterDetail();
  }

  private afterDetail() {
    this.setPhase("detail-done");
    this.startPhaseTimer(DETAIL_DONE_MS, () => this.setPhase("listening"));
  }

  private async failAnswer(err: unknown) {
    if (err instanceof ApiError) {
      if (err.code === "unauthorized") {
        this.set({ needsPassword: true });
        this.showNotice(err.message, "error");
      } else if (err.code === "rate_limited") {
        this.showNotice(err.message, "warn");
        await this.say("rateLimited");
        return;
      } else {
        this.showNotice(err.message, err.fatal ? "error" : "warn");
        if (err.isPlanError) void this.refreshConfig();
      }
    } else if (!isAbort(err)) {
      this.showNotice(getT().errors.answerFailed, "warn");
    }
    await this.say("error");
  }

  private updateAnswer(id: number, patch: Partial<AnswerView>) {
    const current = this.state.current?.id === id ? { ...this.state.current, ...patch } : this.state.current;
    const history = this.state.history.map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.set({ current, history });
  }

  // ---- speech ------------------------------------------------------------------------------

  private cloudVoice(): boolean {
    return getSettings().voice === "cloud" && !!this.state.config?.cloudTts;
  }

  private async say(name: CueName): Promise<boolean> {
    this.cancelFiller();
    if (getSettings().cue === "beep") {
      this.speaker.beep(CUE_BEEPS[name]);
      await sleep(350);
      return true;
    }
    const cue = cueText(name);
    return this.speakText(cue.text, cue.lang, true);
  }

  /** `answer`: text the user will say out loud, so their voice afterwards is recognized as theirs. */
  private async speakText(
    text: string,
    lang: string,
    instant: boolean,
    answer = false,
    maxWaitMs?: number,
  ): Promise<boolean> {
    const s = getSettings();
    const backend: VoiceBackend = this.cloudVoice() ? "cloud" : "device";
    const entry: SpokenEntry = {
      text,
      from: Date.now(),
      to: Number.POSITIVE_INFINITY,
      repeatUntil: answer ? Number.POSITIVE_INFINITY : 0,
    };
    this.spokenLog.push(entry);
    if (this.spokenLog.length > 8) this.spokenLog.shift();
    this.diag(`säger (${backend}): "${text.slice(0, 50)}"`);
    let completed = false;
    try {
      completed = await this.speaker.speak(text, { lang, rate: s.rate, backend, instant, maxWaitMs });
      return completed;
    } finally {
      const now = Date.now();
      this.speechEndedAt = now;
      entry.to = now + 800;
      if (answer) entry.repeatUntil = now + Math.max(REPEAT_TAIL_MIN_MS, now - entry.from + REPEAT_TAIL_EXTRA_MS);
      this.diag(`${completed ? "klar" : "avbruten"} efter ${((now - entry.from) / 1000).toFixed(1)} s`);
    }
  }

  /** Plays a sample so the user can check volume and voice (works before starting too). */
  testVoice() {
    this.ensureAudioContext();
    this.speaker.unlock();
    const lang = spokenLang();
    void this.speakText(DICTS[lang].cues.sample, lang, false);
  }

  /** A calendar reminder: spoken in the ear while listening, otherwise only a beep. */
  remind(title: string) {
    const lang = spokenLang();
    if (this.state.mode === "mic" && this.running && !this.speaker.speaking) {
      void this.speakText(DICTS[lang].reminder.spoken(title), lang, false);
    } else if (this.ctx) {
      this.speaker.beep("ready");
    }
  }

  // ---- misc --------------------------------------------------------------------------------

  /** A diagnostic event for the server console, sent only when the server has PHONE_LOG=1. */
  private diag(message: string) {
    if (!this.state.config?.phoneLog) return;
    const now = new Date();
    const time = `${now.toLocaleTimeString("sv-SE")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
    this.diagQueue.push(`${time} ${message}`);
    if (this.diagQueue.length > DIAG_BATCH * 4) this.diagQueue.shift();
    this.diagTimer ??= setTimeout(() => this.flushDiag(), DIAG_FLUSH_MS);
  }

  private flushDiag() {
    if (this.diagTimer) clearTimeout(this.diagTimer);
    this.diagTimer = null;
    const events = this.diagQueue.splice(0, DIAG_BATCH);
    if (events.length === 0) return;
    this.api.log(events).catch(() => {});
    if (this.diagQueue.length > 0) this.diagTimer = setTimeout(() => this.flushDiag(), DIAG_FLUSH_MS);
  }

  showNotice(text: string, tone: Notice["tone"]) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    const id = ++this.noticeId;
    this.set({ notice: { id, text, tone } });
    if (tone !== "error") {
      this.noticeTimer = setTimeout(() => {
        if (this.state.notice?.id === id) this.set({ notice: null });
      }, NOTICE_MS);
    }
  }

  dismissNotice() {
    this.set({ notice: null });
  }

  selftest() {
    return this.api.selftest();
  }

  clearHistory() {
    this.set({ history: [], current: this.running ? this.state.current : null });
  }

  hasCloudVoice(): boolean {
    return !!this.state.config?.cloudTts;
  }

  async enumerateMics(): Promise<MediaDeviceInfo[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Chrome lists "default" and "communications" aliases; "Standard" in the picker covers them.
      return devices.filter(
        (d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications",
      );
    } catch {
      return [];
    }
  }

  private startPhaseTimer(ms: number, fn: () => void) {
    this.clearPhaseTimer();
    const gen = this.gen;
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      if (gen === this.gen) fn();
    }, ms);
  }

  private clearPhaseTimer() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }
}

let engine: Engine | null = null;

export function getEngine(): Engine {
  engine ??= new Engine();
  return engine;
}
