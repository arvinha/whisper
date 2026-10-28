import { useSyncExternalStore } from "react";
import type { AnswerStyle, LanguagePref } from "@/lib/shared/types";
import { onOwnerChange, ownedKey, PROFILE_KEY } from "./owner";

export type VoicePref = "cloud" | "device";
export type CuePref = "voice" | "short" | "beep";
export type UiLangPref = "auto" | "sv" | "da" | "en";

export interface Settings {
  /** The language of buttons and texts; "auto" follows the phone. */
  uiLang: UiLangPref;
  profile: string;
  style: AnswerStyle;
  language: LanguagePref;
  voice: VoicePref;
  rate: number;
  cue: CuePref;
  alertOnQuestion: boolean;
  sensitivity: number;
  micId: string;
  contextMinutes: number;
  showTranscript: boolean;
  /** Keep what is heard on the phone, so Aivia can answer about it later. */
  memory: boolean;
  memoryDays: number;
  /** Look for appointments and to-dos in what is heard and suggest them. */
  suggest: boolean;
  password: string;
}

export const MEMORY_DAY_OPTIONS = [1, 7, 14, 30] as const;

export const DEFAULT_SETTINGS: Settings = {
  uiLang: "auto",
  profile: "",
  style: "smart",
  language: "auto",
  voice: "cloud",
  rate: 1.1,
  cue: "voice",
  alertOnQuestion: false,
  sensitivity: 6,
  micId: "",
  contextMinutes: 3,
  showTranscript: true,
  memory: true,
  memoryDays: 14,
  suggest: true,
  password: "",
};

const STORAGE_KEY = "psst.settings.v1";

const STYLES: readonly AnswerStyle[] = ["smart", "expert", "witty"];
const LANGUAGES: readonly LanguagePref[] = ["auto", "sv", "da", "en"];
const VOICES: readonly VoicePref[] = ["cloud", "device"];
const CUES: readonly CuePref[] = ["voice", "short", "beep"];
const UI_LANGS: readonly UiLangPref[] = ["auto", "sv", "da", "en"];

function pick<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sanitize(raw: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    uiLang: pick(UI_LANGS, raw.uiLang, d.uiLang),
    profile: typeof raw.profile === "string" ? raw.profile.slice(0, 800) : d.profile,
    style: pick(STYLES, raw.style, d.style),
    language: pick(LANGUAGES, raw.language, d.language),
    voice: pick(VOICES, raw.voice, d.voice),
    rate: num(raw.rate, 0.7, 1.6, d.rate),
    cue: pick(CUES, raw.cue, d.cue),
    alertOnQuestion: typeof raw.alertOnQuestion === "boolean" ? raw.alertOnQuestion : d.alertOnQuestion,
    sensitivity: Math.round(num(raw.sensitivity, 1, 10, d.sensitivity)),
    micId: typeof raw.micId === "string" ? raw.micId : d.micId,
    contextMinutes: num(raw.contextMinutes, 1, 15, d.contextMinutes),
    showTranscript: typeof raw.showTranscript === "boolean" ? raw.showTranscript : d.showTranscript,
    memory: typeof raw.memory === "boolean" ? raw.memory : d.memory,
    memoryDays: pick(MEMORY_DAY_OPTIONS as readonly number[], raw.memoryDays, d.memoryDays),
    suggest: typeof raw.suggest === "boolean" ? raw.suggest : d.suggest,
    password: typeof raw.password === "string" ? raw.password : d.password,
  };
}

let current: Settings = DEFAULT_SETTINGS;
let loaded = false;
const listeners = new Set<() => void>();

/** The profile is about a person, so it belongs to whoever is signed in; the rest is the phone's. */
function readProfile(): string {
  const key = ownedKey(PROFILE_KEY);
  try {
    return (key && window.localStorage.getItem(key)) || "";
  } catch {
    return "";
  }
}

if (typeof window !== "undefined") {
  onOwnerChange(() => {
    if (!loaded) return;
    const profile = readProfile();
    if (profile === current.profile) return;
    current = { ...current, profile };
    listeners.forEach((l) => l());
  });
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const profile = readProfile();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) current = sanitize(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    current = DEFAULT_SETTINGS;
  }
  current = { ...current, profile };
}

export function getSettings(): Settings {
  load();
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  load();
  current = sanitize({ ...current, ...patch });
  try {
    const { profile, ...phone } = current;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(phone));
    const key = ownedKey(PROFILE_KEY);
    if (key && "profile" in patch) window.localStorage.setItem(key, profile);
  } catch {
    // private mode or storage full: keep in memory
  }
  listeners.forEach((l) => l());
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getServerSettings = () => DEFAULT_SETTINGS;

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getServerSettings);
}
