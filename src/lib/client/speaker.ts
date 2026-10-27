import type { Api } from "./api";
import { bestVoice, deviceVoices, localeTag } from "./voices";

export type VoiceBackend = "cloud" | "device";
export type BeepKind = "tick" | "ready" | "error";

export interface SpeakOptions {
  lang: string;
  rate: number;
  backend: VoiceBackend;
  /** Only use the cloud voice if the audio is already downloaded (for short cues). */
  instant?: boolean;
  /** Longest wait for the cloud audio before the phone's own voice says it instead. */
  maxWaitMs?: number;
}

const CACHE_SIZE = 24;
/** Longest wait for cloud audio before the phone's own voice takes over. */
const CLOUD_WAIT_MS = 6_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Molnrösten dröjer.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Callback form for older Safari; the returned promise (if any) is ignored.
    const result = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    result?.catch?.(() => {});
  });
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const sentences: string[] = [];
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    // Merge very short fragments so the voice does not pause unnaturally.
    if (sentences.length > 0 && p.length < 12) sentences[sentences.length - 1] += ` ${p}`;
    else sentences.push(p);
  }
  return sentences.length > 0 ? sentences : [text];
}

/** Speaks answers with the cloud voice (via Web Audio) or the phone's built-in voice. */
export class Speaker {
  private ctx: AudioContext | null = null;
  private output: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private finish: (() => void) | null = null;
  private token = 0;
  private cache = new Map<string, Promise<AudioBuffer>>();
  private decoded = new Map<string, AudioBuffer>();

  /** Called when the built-in voice does not start (some iOS setups block it). */
  onDeviceVoiceProblem: (() => void) | null = null;

  constructor(private readonly api: Api) {}

  attach(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.output.connect(ctx.destination);
    this.cache.clear();
    this.decoded.clear();
  }

  detach() {
    this.cancel();
    this.ctx = null;
    this.output = null;
  }

  /** Must run synchronously inside a user gesture on iOS. */
  unlock() {
    if (typeof speechSynthesis === "undefined") return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch {
      // ignore
    }
    deviceVoices();
  }

  get speaking(): boolean {
    return this.finish !== null;
  }

  hasDeviceVoice(): boolean {
    return typeof speechSynthesis !== "undefined";
  }

  /** Starts downloading cloud audio so it can play without delay later. */
  prefetch(text: string, lang: string) {
    if (!this.ctx) return;
    this.cloudBuffer(text, lang).catch(() => {});
  }

  /** Resolves true if the text was spoken to the end, false if cancelled. */
  async speak(text: string, opts: SpeakOptions): Promise<boolean> {
    this.cancel();
    const token = ++this.token;
    if (!text.trim()) return true;

    if (opts.backend === "cloud" && this.ctx) {
      const key = `${opts.lang}|${text}`;
      const ready = this.decoded.get(key);
      if (ready || !opts.instant) {
        try {
          const buffer = ready ?? (await within(this.cloudBuffer(text, opts.lang), opts.maxWaitMs ?? CLOUD_WAIT_MS));
          if (token !== this.token) return false;
          return await this.playBuffer(buffer, token);
        } catch (err) {
          if (token !== this.token) return false;
          console.warn("[psst] cloud voice failed, using device voice", err);
        }
      } else {
        this.prefetch(text, opts.lang);
      }
    }
    return this.speakDevice(text, opts, token);
  }

  cancel() {
    this.token++;
    const finish = this.finish;
    this.finish = null;
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source = null;
    }
    if (typeof speechSynthesis !== "undefined" && (this.utterance || speechSynthesis.speaking)) {
      speechSynthesis.cancel();
    }
    this.utterance = null;
    finish?.();
  }

  beep(kind: BeepKind) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.output) return;
    const tones: Array<[number, number]> =
      kind === "tick" ? [[1500, 0.035]] : kind === "ready" ? [[880, 0.08], [1320, 0.12]] : [[330, 0.12], [247, 0.18]];
    let t = ctx.currentTime + 0.01;
    for (const [freq, duration] of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(kind === "tick" ? 0.08 : 0.15, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(this.output);
      osc.start(t);
      osc.stop(t + duration + 0.02);
      t += duration + 0.05;
    }
  }

  private cloudBuffer(text: string, lang: string): Promise<AudioBuffer> {
    const ctx = this.ctx;
    if (!ctx) return Promise.reject(new Error("Ingen ljudutgång."));
    const key = `${lang}|${text}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.api.tts(text, lang).then((data) => decode(ctx, data));
      pending.then(
        (buffer) => this.decoded.set(key, buffer),
        () => this.cache.delete(key),
      );
      this.cache.set(key, pending);
      while (this.cache.size > CACHE_SIZE) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
        this.decoded.delete(oldest);
      }
    }
    return pending;
  }

  private playBuffer(buffer: AudioBuffer, token: number): Promise<boolean> {
    const ctx = this.ctx;
    const output = this.output;
    if (!ctx || !output) return Promise.resolve(false);
    if (ctx.state !== "running") void ctx.resume().catch(() => {});

    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        source.onended = null;
        if (this.source === source) this.source = null;
        if (this.finish === done) this.finish = null;
        resolve(token === this.token);
      };
      source.onended = done;
      // onended never fires if the audio context is suspended by the system.
      const watchdog = setTimeout(done, buffer.duration * 1000 + 3000);
      this.source = source;
      this.finish = done;
      source.start();
    });
  }

  private async speakDevice(text: string, opts: SpeakOptions, token: number): Promise<boolean> {
    if (typeof speechSynthesis === "undefined") return false;
    for (const sentence of splitSentences(text)) {
      if (token !== this.token) return false;
      let outcome = await this.speakUtterance(sentence, opts, token);
      // iOS can cut the voice off when its audio setup changes; say the sentence again once.
      if (outcome === "cut") outcome = await this.speakUtterance(sentence, opts, token);
      if (outcome === "cancelled") return false;
    }
    return token === this.token;
  }

  private speakUtterance(text: string, opts: SpeakOptions, token: number): Promise<"done" | "cut" | "cancelled"> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = localeTag(opts.lang);
      const voice = bestVoice(opts.lang);
      if (voice) u.voice = voice;
      u.rate = opts.rate;

      let settled = false;
      let started = false;
      const done = (cut = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearTimeout(startCheck);
        if (this.finish === done) this.finish = null;
        if (this.utterance === u) this.utterance = null;
        resolve(token !== this.token ? "cancelled" : cut ? "cut" : "done");
      };
      u.onstart = () => {
        started = true;
      };
      u.onend = () => done();
      // Our own cancel() changes the token first, so an error with the same token came from iOS.
      u.onerror = (e) => done(e.error === "interrupted" || e.error === "audio-busy");

      const words = text.split(/\s+/).length;
      const watchdog = setTimeout(done, (words / (2.4 * opts.rate)) * 1000 + 4000);
      const startCheck = setTimeout(() => {
        if (!started && !settled) this.onDeviceVoiceProblem?.();
      }, 3000);

      // Keep a reference: iOS can garbage-collect an utterance mid-speech and never fire onend.
      this.utterance = u;
      this.finish = done;
      speechSynthesis.speak(u);
    });
  }
}
