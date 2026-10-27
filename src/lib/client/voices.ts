import { useSyncExternalStore } from "react";
import type { Dict } from "@/lib/i18n";

const LANG_TAG: Record<string, string> = { sv: "sv-SE", da: "da-DK", en: "en-US" };
const BETTER_VOICE = /(enhanced|premium|förbättrad|forbedret|neural|natural|siri)/i;
// Apple's Eloquence and novelty voices are listed for many languages but sound robotic or silly.
const ODD_VOICE =
  /(eloquence|\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph)\b)/i;

let voices: SpeechSynthesisVoice[] = [];
let listening = false;
const listeners = new Set<() => void>();

function supported(): boolean {
  return typeof window !== "undefined" && typeof speechSynthesis !== "undefined";
}

function refresh() {
  try {
    voices = speechSynthesis.getVoices();
  } catch {
    voices = [];
  }
}

function listen() {
  if (listening || !supported()) return;
  listening = true;
  // Chrome fills the list asynchronously and announces it with this event.
  speechSynthesis.addEventListener?.("voiceschanged", () => {
    refresh();
    listeners.forEach((l) => l());
  });
}

export function deviceVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return [];
  listen();
  if (voices.length === 0) refresh();
  return voices;
}

export function localeTag(lang: string): string {
  return LANG_TAG[lang] ?? lang;
}

export function bestVoice(lang: string): SpeechSynthesisVoice | null {
  const tag = localeTag(lang).toLowerCase();
  const base = tag.slice(0, 2);
  const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const matching = deviceVoices().filter((v) => norm(v).startsWith(base));
  if (matching.length === 0) return null;
  const score = (v: SpeechSynthesisVoice) => {
    const id = `${v.name} ${v.voiceURI}`;
    return (
      (norm(v) === tag ? 4 : 0) +
      (BETTER_VOICE.test(id) ? 3 : 0) +
      (v.default ? 1 : 0) +
      (v.localService ? 1 : 0) -
      (ODD_VOICE.test(id) ? 8 : 0)
    );
  };
  return matching.reduce((best, v) => (score(v) > score(best) ? v : best));
}

/** The voice name used for `lang`, "" if the device has none, null while the list is unknown. */
export function deviceVoiceName(lang: string): string | null {
  if (!supported()) return "";
  if (deviceVoices().length === 0) return null;
  return bestVoice(lang)?.name ?? "";
}

function subscribe(listener: () => void) {
  listen();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDeviceVoiceName(lang: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => deviceVoiceName(lang),
    () => null,
  );
}

/** Where to add a voice for another language on this device. */
export function addVoiceHint(where: Dict["voices"]["where"]): string {
  if (typeof navigator === "undefined") return where.other;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return where.ios;
  if (/Windows/.test(ua)) return where.windows;
  if (/Macintosh/.test(ua)) return where.mac;
  if (/Android/.test(ua)) return where.android;
  return where.other;
}
