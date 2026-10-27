import { makeSilentWav } from "./audio/wav";

export interface MediaButtonHandlers {
  press: (source: string) => void;
  next: (source: string) => void;
  previous: (source: string) => void;
}

export type MicrophoneActivation = "on" | "refused" | "unsupported";

type MicrophoneSession = MediaSession & { setMicrophoneActive?: (active: boolean) => Promise<void> | void };

/** iOS can report one press in two ways (a media action and a microphone mute). */
const PRESS_DEBOUNCE_MS = 350;

/**
 * Headphone buttons reach a web page through the Media Session API, but only while the page is
 * the active "now playing" app. A looping, inaudible clip keeps it that way.
 */
export class MediaButtons {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private handlers: MediaButtonHandlers | null = null;
  private lastPressAt = 0;

  /** Must run synchronously inside a user gesture on iOS. */
  start(handlers: MediaButtonHandlers) {
    if (typeof window === "undefined") return;
    this.handlers = handlers;
    if (!this.audio) {
      this.url = URL.createObjectURL(makeSilentWav(6));
      const audio = new Audio();
      audio.src = this.url;
      audio.loop = true;
      audio.preload = "auto";
      this.audio = audio;
    }
    this.keepPlaying();

    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({ title: "Whisper", artist: "Aivia lyssnar" });
    } catch {
      // MediaMetadata missing
    }
    this.setHandler("play", () => this.press("play"));
    this.setHandler("pause", () => this.press("pause"));
    this.setHandler("stop", () => this.press("stop"));
    this.setHandler("togglemicrophone" as MediaSessionAction, () => {
      void this.activateMicrophone();
      this.press("togglemicrophone");
    });
    this.setHandler("nexttrack", () => {
      this.keepPlaying();
      handlers.next("nexttrack");
    });
    this.setHandler("previoustrack", () => {
      this.keepPlaying();
      handlers.previous("previoustrack");
    });
    // While the microphone records, a double press on AirPods means "hang up", as in a call.
    this.setHandler("hangup" as MediaSessionAction, () => {
      this.keepPlaying();
      handlers.next("hangup");
    });
  }

  /** A single press on the headphones, from a media action or a microphone mute. */
  press(source: string) {
    if (!this.handlers) return;
    this.keepPlaying();
    const now = Date.now();
    if (now - this.lastPressAt < PRESS_DEBOUNCE_MS) return;
    this.lastPressAt = now;
    this.handlers.press(source);
  }

  /** Call from a user gesture to recover after iOS paused the clip (e.g. after a phone call). */
  keepPlaying() {
    const audio = this.audio;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "playing";
      } catch {
        // ignore
      }
    }
  }

  /** Asks the browser to undo a mute it applied to the microphone (AirPods stem press). */
  async activateMicrophone(): Promise<MicrophoneActivation> {
    if (!("mediaSession" in navigator)) return "unsupported";
    const session = navigator.mediaSession as MicrophoneSession;
    if (typeof session.setMicrophoneActive !== "function") return "unsupported";
    try {
      await session.setMicrophoneActive(true);
      return "on";
    } catch {
      return "refused";
    }
  }

  stop() {
    this.handlers = null;
    for (const action of ["play", "pause", "stop", "nexttrack", "previoustrack", "togglemicrophone", "hangup"]) {
      this.setHandler(action as MediaSessionAction, null);
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      } catch {
        // ignore
      }
    }
  }

  private setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // action not supported on this platform
    }
  }
}
