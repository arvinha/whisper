import { getT } from "../i18n";
import { Downsampler } from "./resample";

export type CaptureState = "running" | "muted" | "ended";

export interface CaptureOptions {
  deviceId?: string;
  /** Mono samples at `sampleRate`. */
  onSamples: (samples: Float32Array) => void;
  onStateChange: (state: CaptureState) => void;
}

export interface CaptureInfo {
  label: string;
  deviceId: string;
}

const WORKLET_URL = "/worklets/capture-processor.js";

/** Microphone capture through Web Audio, downsampled for speech recognition. */
export class AudioCapture {
  readonly sampleRate: number;
  private readonly downsampler: Downsampler;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly opts: CaptureOptions,
  ) {
    this.downsampler = new Downsampler(ctx.sampleRate, 16000);
    this.sampleRate = this.downsampler.outRate;
  }

  /** False if the system has stopped or muted the microphone (calls, Siri, other apps). */
  get healthy(): boolean {
    const track = this.stream?.getAudioTracks()[0];
    return !!track && track.readyState === "live" && !track.muted;
  }

  async start(): Promise<CaptureInfo> {
    const stream = await this.openStream();
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      throw new DOMException("Stopped", "AbortError");
    }
    this.stream = stream;

    const track = stream.getAudioTracks()[0];
    track.addEventListener("ended", () => !this.stopped && this.opts.onStateChange("ended"));
    track.addEventListener("mute", () => !this.stopped && this.opts.onStateChange("muted"));
    track.addEventListener("unmute", () => !this.stopped && this.opts.onStateChange("running"));

    this.source = this.ctx.createMediaStreamSource(stream);
    // Processors must be connected to the destination to run; a zero gain keeps them silent.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.ctx.destination);
    await this.connectProcessor(this.source, this.sink);

    return { label: track.label, deviceId: track.getSettings().deviceId ?? "" };
  }

  stop() {
    this.stopped = true;
    try {
      this.source?.disconnect();
      this.processor?.disconnect();
      this.sink?.disconnect();
    } catch {
      // already disconnected
    }
    if (this.processor instanceof AudioWorkletNode) this.processor.port.onmessage = null;
    else if (this.processor) this.processor.onaudioprocess = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private async openStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new NoMicAccessError();
    }
    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    if (this.opts.deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { ...audio, deviceId: { exact: this.opts.deviceId } },
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name !== "OverconstrainedError" && name !== "NotFoundError") throw err;
        // The chosen microphone is gone (e.g. headphones disconnected): use the default one.
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio });
  }

  private async connectProcessor(source: MediaStreamAudioSourceNode, sink: GainNode) {
    if (this.ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        await this.ctx.audioWorklet.addModule(WORKLET_URL);
        const node = new AudioWorkletNode(this.ctx, "psst-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: "explicit",
        });
        node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handle(e.data);
        source.connect(node);
        node.connect(sink);
        this.processor = node;
        return;
      } catch (err) {
        console.warn("[psst] AudioWorklet unavailable, using ScriptProcessor", err);
      }
    }
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => this.handle(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(sink);
    this.processor = node;
  }

  private handle(samples: Float32Array) {
    if (this.stopped) return;
    const out = this.downsampler.process(samples);
    if (out.length > 0) this.opts.onSamples(out);
  }
}

export class NoMicAccessError extends Error {
  constructor() {
    super("No microphone access");
    this.name = "NoMicAccessError";
  }
}

export function micErrorMessage(err: unknown): string {
  const t = getT().errors;
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return t.micDenied;
  if (name === "NotFoundError") return t.micNotFound;
  if (name === "NotReadableError") return t.micBusy;
  if (name === "NoMicAccessError") return t.micNoAccess;
  return t.micFailed;
}
