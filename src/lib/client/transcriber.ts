import type { LanguageCode } from "@/lib/shared/types";
import { ApiError, isAbort, type Api } from "./api";
import type { Segment } from "./audio/segmenter";
import { concatWithGap, encodeWav } from "./audio/wav";

export interface TranscribedSegment {
  text: string;
  startedAt: number;
  endedAt: number;
  speechMs: number;
}

export interface TranscriberOptions {
  api: Api;
  sampleRate: number;
  maxRequestsPerMinute: number;
  paceRequestsPerMinute: number;
  getLanguage: () => LanguageCode | undefined;
  getPrompt: () => string;
  onResult: (segment: TranscribedSegment) => void;
  onError: (err: ApiError, willRetry: boolean) => void;
  onPendingChange: (pending: number) => void;
}

const MAX_IN_FLIGHT = 2;
const MAX_MERGED_MS = 28_000;
const MAX_QUEUED_MS = 180_000;
const MAX_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 6;

/**
 * Sends speech segments for transcription while respecting the provider's rate limits.
 * Segments that wait in the queue are merged into one request, which matters on Groq where
 * each request is billed as at least 10 seconds of audio.
 */
export class Transcriber {
  private queue: Segment[] = [];
  private inFlight = 0;
  private sentAt: number[] = [];
  private lastSentAt = 0;
  private blockedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly controller = new AbortController();
  private idleWaiters = new Set<() => void>();
  private rateLimitHits = new WeakMap<Segment, number>();

  constructor(private readonly opts: TranscriberOptions) {}

  get pending(): number {
    return this.queue.length + this.inFlight;
  }

  enqueue(segment: Segment) {
    if (this.stopped) return;
    this.queue.push(segment);
    this.dropOldestIfTooLong();
    this.changed();
    this.pump();
  }

  /** The user is waiting: send everything that is queued as soon as the hard limit allows. */
  hurry() {
    for (const s of this.queue) s.urgent = true;
    this.pump();
  }

  /** Resolves true when all queued audio is transcribed, or false after the timeout. */
  whenIdle(timeoutMs: number): Promise<boolean> {
    if (this.pending === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.idleWaiters.delete(waiter);
        resolve(false);
      }, timeoutMs);
      this.idleWaiters.add(waiter);
    });
  }

  /** Milliseconds until the provider accepts requests again, if we were rate limited. */
  blockedForMs(): number {
    return Math.max(0, this.blockedUntil - Date.now());
  }

  stop() {
    this.stopped = true;
    this.controller.abort();
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.resolveIdle();
  }

  private durationMs(segment: Segment): number {
    return (segment.samples.length / this.opts.sampleRate) * 1000;
  }

  private dropOldestIfTooLong() {
    let total = this.queue.reduce((ms, s) => ms + this.durationMs(s), 0);
    while (total > MAX_QUEUED_MS && this.queue.length > 1) {
      const dropped = this.queue.shift()!;
      total -= this.durationMs(dropped);
    }
  }

  private changed() {
    this.opts.onPendingChange(this.pending);
    if (this.pending === 0) this.resolveIdle();
  }

  private resolveIdle() {
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    waiters.forEach((w) => w());
  }

  private waitMs(now: number, urgent: boolean): number {
    let wait = Math.max(0, this.blockedUntil - now);
    const max = this.opts.maxRequestsPerMinute;
    const limit = urgent ? max : Math.max(1, max - 2);
    if (this.sentAt.length >= limit) {
      wait = Math.max(wait, this.sentAt[this.sentAt.length - limit] + 60_000 - now + 50);
    }
    if (!urgent) {
      const interval = 60_000 / Math.max(1, this.opts.paceRequestsPerMinute);
      wait = Math.max(wait, this.lastSentAt + interval - now);
    }
    return wait;
  }

  private pump() {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0 && this.inFlight < MAX_IN_FLIGHT) {
      const now = Date.now();
      this.sentAt = this.sentAt.filter((t) => now - t < 60_000);
      const urgent = this.queue.some((s) => s.urgent);
      const wait = this.waitMs(now, urgent);
      if (wait > 0) {
        this.timer = setTimeout(() => this.pump(), wait);
        return;
      }
      void this.send(this.takeBatch());
    }
  }

  private takeBatch(): Segment[] {
    const batch: Segment[] = [];
    let ms = 0;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      const duration = this.durationMs(next);
      if (batch.length > 0 && ms + duration > MAX_MERGED_MS) break;
      batch.push(this.queue.shift()!);
      ms += duration;
    }
    return batch;
  }

  private async send(batch: Segment[]) {
    this.inFlight++;
    const now = Date.now();
    this.sentAt.push(now);
    this.lastSentAt = now;

    const samples = concatWithGap(
      batch.map((s) => s.samples),
      this.opts.sampleRate,
      0.3,
    );
    const wav = encodeWav(samples, this.opts.sampleRate);

    try {
      const result = await this.opts.api.transcribe(wav, {
        language: this.opts.getLanguage(),
        prompt: this.opts.getPrompt(),
        signal: this.controller.signal,
      });
      if (!this.stopped) {
        this.opts.onResult({
          text: result.text,
          startedAt: batch[0].startedAt,
          endedAt: batch[batch.length - 1].endedAt,
          speechMs: batch.reduce((ms, s) => ms + s.speechMs, 0),
        });
      }
    } catch (err) {
      if (!this.stopped && !isAbort(err)) this.handleError(err, batch);
    } finally {
      this.inFlight--;
      this.changed();
      this.pump();
    }
  }

  private handleError(err: unknown, batch: Segment[]) {
    const error =
      err instanceof ApiError ? err : new ApiError("Okänt fel vid transkribering.", "internal", 0);

    let retry = false;
    if (error.code === "rate_limited") {
      this.blockedUntil = Date.now() + (error.retryAfterSeconds ?? 10) * 1000;
      const hits = Math.max(...batch.map((s) => this.rateLimitHits.get(s) ?? 0)) + 1;
      batch.forEach((s) => this.rateLimitHits.set(s, hits));
      retry = hits <= MAX_RATE_LIMIT_RETRIES;
    } else if (!error.fatal && error.code !== "bad_request") {
      const retries = Math.max(...batch.map((s) => s.retries));
      retry = retries < MAX_RETRIES;
      if (retry) {
        batch.forEach((s) => s.retries++);
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + 1500 * (retries + 1));
      }
    }

    if (retry) this.queue.unshift(...batch);
    this.opts.onError(error, retry);
  }
}
