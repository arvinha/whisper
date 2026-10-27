import type { Phase } from "@/lib/client/engine";
import type { Dict } from "@/lib/i18n";
import type { LlmProvider, SttProvider, TtsProvider } from "@/lib/shared/types";

export type Tone = "idle" | "listen" | "think" | "ready" | "speak";

export interface PhaseInfo {
  label: string;
  hint: string;
  tone: Tone;
}

const PHASE_KEY: Record<Exclude<Phase, "idle">, { key: keyof Dict["phase"]; tone: Tone }> = {
  starting: { key: "starting", tone: "think" },
  listening: { key: "listening", tone: "listen" },
  thinking: { key: "thinking", tone: "think" },
  "speaking-short": { key: "speakingShort", tone: "speak" },
  "short-done": { key: "shortDone", tone: "listen" },
  "fetching-detail": { key: "fetchingDetail", tone: "think" },
  "speaking-detail": { key: "speakingDetail", tone: "speak" },
  "detail-done": { key: "detailDone", tone: "listen" },
};

export function phaseInfo(phase: Phase, t: Dict): PhaseInfo {
  if (phase === "idle") return { label: "", hint: "", tone: "idle" };
  const { key, tone } = PHASE_KEY[phase];
  return { ...t.phase[key], tone };
}

export function providerName(provider: SttProvider | LlmProvider, t: Dict): string {
  return provider === "mock" ? t.live.testMode : PROVIDER_NAME[provider];
}

const PROVIDER_NAME: Record<Exclude<SttProvider | LlmProvider, "mock">, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  groq: "Groq",
  deepseek: "DeepSeek",
};

export const TTS_NAME: Record<TtsProvider, string> = {
  azure: "Azure",
  openai: "OpenAI",
};

export function timeLabel(at: number, locale: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
