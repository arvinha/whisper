export interface Segment {
  startedAt: number;
  endedAt: number;
  samples: Float32Array;
  speechMs: number;
  reason: "pause" | "max" | "flush";
  urgent: boolean;
  retries: number;
}

export interface SegmenterOptions {
  sampleRate: number;
  /** 1 (only loud, close speech) to 10 (picks up quiet, distant speech). */
  sensitivity: number;
  /** A pause shorter than this does not end a segment unless the segment is long enough. */
  minSegmentMs: number;
  maxSegmentMs?: number;
  onSegment: (segment: Segment) => void;
  onLevel?: (rms: number, speech: boolean) => void;
}

const FRAME_MS = 20;
const PRE_ROLL_MS = 300;
const END_SILENCE_MS = 700;
const LONG_SILENCE_MS = 1100;
const MIN_SPEECH_MS = 240;
const TRAILING_KEEP_MS = 250;

/**
 * Energy-based voice activity detection that cuts the microphone stream into speech segments
 * at natural pauses. An adaptive noise floor keeps it usable in both quiet rooms and cafés.
 */
export class Segmenter {
  private readonly frameSize: number;
  private readonly maxSegmentMs: number;
  private sensitivity: number;
  private pending = new Float32Array(0);
  private totalSamples = 0;
  /** Wall-clock anchor: the last received sample was captured at about this time. */
  private receivedSamples = 0;
  private receivedAt = Date.now();

  private noiseFloor = 0.002;
  private voicedRun = 0;
  private preRoll: Float32Array[] = [];

  private inSegment = false;
  private frames: Float32Array[] = [];
  private frameRms: number[] = [];
  private segStartSample = 0;
  private speechFrames = 0;
  private silenceRun = 0;

  constructor(private readonly opts: SegmenterOptions) {
    this.frameSize = Math.round((opts.sampleRate * FRAME_MS) / 1000);
    this.maxSegmentMs = opts.maxSegmentMs ?? 15000;
    this.sensitivity = opts.sensitivity;
  }

  setSensitivity(value: number) {
    this.sensitivity = value;
  }

  push(samples: Float32Array) {
    // Anchoring to the wall clock on every chunk keeps timestamps right even after the
    // system paused the microphone for a while.
    this.receivedSamples += samples.length;
    this.receivedAt = Date.now();
    let data = samples;
    if (this.pending.length > 0) {
      data = new Float32Array(this.pending.length + samples.length);
      data.set(this.pending, 0);
      data.set(samples, this.pending.length);
    }
    let offset = 0;
    while (offset + this.frameSize <= data.length) {
      this.processFrame(data.slice(offset, offset + this.frameSize));
      offset += this.frameSize;
    }
    this.pending = data.slice(offset);
  }

  /** Ends the current segment right away (used when the user presses the button). */
  flush(): void {
    if (!this.inSegment) return;
    if (this.speechFrames * FRAME_MS >= MIN_SPEECH_MS) {
      this.emit(this.frames.length, "flush", true);
    } else {
      this.discard();
    }
  }

  private threshold(): number {
    const s = Math.max(1, Math.min(10, this.sensitivity));
    const t = (s - 1) / 9;
    const multiplier = 4 - t * 2.4; // 4.0 .. 1.6
    const absolute = 0.012 - t * 0.0105; // 0.012 .. 0.0015
    return Math.max(this.noiseFloor * multiplier, absolute);
  }

  private processFrame(frame: Float32Array) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const isLoud = rms > this.threshold();

    // Fast to fall, slow to rise.
    if (rms < this.noiseFloor) this.noiseFloor = this.noiseFloor * 0.9 + rms * 0.1;
    else if (!isLoud) this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
    else this.noiseFloor = this.noiseFloor * 0.9995 + rms * 0.0005;
    this.noiseFloor = Math.max(this.noiseFloor, 0.0002);

    this.voicedRun = isLoud ? this.voicedRun + 1 : 0;
    this.opts.onLevel?.(rms, this.inSegment && isLoud);

    const frameStart = this.totalSamples;
    this.totalSamples += frame.length;

    if (!this.inSegment) {
      this.preRoll.push(frame);
      const maxPreRoll = Math.ceil(PRE_ROLL_MS / FRAME_MS);
      if (this.preRoll.length > maxPreRoll) this.preRoll.shift();
      if (this.voicedRun >= 2) {
        this.inSegment = true;
        this.frames = [...this.preRoll];
        this.frameRms = this.frames.map(() => 0);
        this.frameRms[this.frameRms.length - 1] = rms;
        this.segStartSample = frameStart + frame.length - this.frames.length * this.frameSize;
        this.preRoll = [];
        this.speechFrames = 2;
        this.silenceRun = 0;
      }
      return;
    }

    this.frames.push(frame);
    this.frameRms.push(rms);
    if (isLoud) {
      this.speechFrames++;
      this.silenceRun = 0;
    } else {
      this.silenceRun++;
    }

    const durationMs = this.frames.length * FRAME_MS;
    const silenceMs = this.silenceRun * FRAME_MS;
    const speechMs = this.speechFrames * FRAME_MS;

    if (silenceMs >= END_SILENCE_MS && durationMs >= this.opts.minSegmentMs) {
      this.endAfterPause();
    } else if (silenceMs >= LONG_SILENCE_MS) {
      if (speechMs >= MIN_SPEECH_MS) this.endAfterPause();
      else this.discard();
    } else if (durationMs >= this.maxSegmentMs) {
      this.cutAtQuietestFrame();
    }
  }

  private endAfterPause() {
    const keepSilence = Math.ceil(TRAILING_KEEP_MS / FRAME_MS);
    const end = Math.max(1, this.frames.length - this.silenceRun + keepSilence);
    this.emit(Math.min(this.frames.length, end), "pause", false);
  }

  /** At max length, cut at the quietest frame of the last second so words are not split. */
  private cutAtQuietestFrame() {
    const lookback = Math.min(this.frames.length - 1, Math.ceil(1000 / FRAME_MS));
    let cut = this.frames.length;
    let quietest = Infinity;
    for (let i = this.frames.length - lookback; i < this.frames.length; i++) {
      if (this.frameRms[i] < quietest) {
        quietest = this.frameRms[i];
        cut = i + 1;
      }
    }
    this.emit(cut, "max", false);
  }

  private emit(frameCount: number, reason: Segment["reason"], urgent: boolean) {
    const used = this.frames.slice(0, frameCount);
    const rest = this.frames.slice(frameCount);
    const restRms = this.frameRms.slice(frameCount);

    const samples = new Float32Array(used.length * this.frameSize);
    used.forEach((f, i) => samples.set(f, i * this.frameSize));

    const startedAt = this.wallTime(this.segStartSample);
    const endedAt = this.wallTime(this.segStartSample + samples.length);
    const speechMs = Math.min(this.speechFrames, used.length) * FRAME_MS;
    const nextStart = this.segStartSample + used.length * this.frameSize;

    this.reset();
    this.opts.onSegment({ startedAt, endedAt, samples, speechMs, reason, urgent, retries: 0 });

    if (reason === "max" && rest.length > 0) {
      // Speech continues past the cut: carry the remainder into a new segment.
      this.inSegment = true;
      this.frames = rest;
      this.frameRms = restRms;
      this.segStartSample = nextStart;
      this.speechFrames = restRms.filter((r) => r > this.threshold()).length;
      this.silenceRun = 0;
    }
  }

  private wallTime(sampleIndex: number): number {
    return this.receivedAt - ((this.receivedSamples - sampleIndex) * 1000) / this.opts.sampleRate;
  }

  private discard() {
    this.reset();
  }

  private reset() {
    this.inSegment = false;
    this.frames = [];
    this.frameRms = [];
    this.speechFrames = 0;
    this.silenceRun = 0;
    this.preRoll = [];
  }
}
