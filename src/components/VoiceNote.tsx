"use client";

import { useT, useUiLang } from "@/lib/client/i18n";
import { useSettings } from "@/lib/client/settings";
import { addVoiceHint, useDeviceVoiceName } from "@/lib/client/voices";
import type { UiLang } from "@/lib/i18n";
import type { PublicConfig } from "@/lib/shared/types";

/** The language answers and spoken messages are read in when the conversation language is automatic. */
export function useSpokenLang(): UiLang {
  const { language } = useSettings();
  const ui = useUiLang();
  return language === "auto" ? ui : language;
}

/** Without a voice for the language, browsers read it with e.g. an English voice. */
export function VoiceMissingNote({ config, className = "" }: { config: PublicConfig | null; className?: string }) {
  const t = useT();
  const settings = useSettings();
  const lang = useSpokenLang();
  const voice = useDeviceVoiceName(lang);
  if (voice !== "" || (settings.voice === "cloud" && config?.cloudTts)) return null;
  const name = t.voices.langName[lang] ?? lang;
  return (
    <p
      className={`rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100 ${className}`}
    >
      {t.voices.missing(name, addVoiceHint(t.voices.where))}
      {config?.cloudTts ? t.voices.orCloud : ""}
    </p>
  );
}

/** Which built-in voice reads the answers. */
export function DeviceVoiceLine() {
  const t = useT();
  const lang = useSpokenLang();
  const voiceName = useDeviceVoiceName(lang);
  if (voiceName === null) return null;
  const name = t.voices.langName[lang] ?? lang;
  return voiceName ? (
    <p className="text-xs text-zinc-500">{t.voices.line(name, voiceName)}</p>
  ) : (
    <p className="text-xs text-amber-200">{t.voices.lineMissing(name, addVoiceHint(t.voices.where))}</p>
  );
}
