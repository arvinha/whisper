"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getEngine, type EngineState } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { clearMemory, pruneMemory } from "@/lib/client/memory";
import { FEATURES } from "@/lib/shared/features";
import {
  MEMORY_DAY_OPTIONS,
  updateSettings,
  useSettings,
  type CuePref,
  type UiLangPref,
  type VoicePref,
} from "@/lib/client/settings";
import { UI_LANG_NAMES } from "@/lib/i18n";
import type { AnswerStyle, LanguagePref, SelfTestResult } from "@/lib/shared/types";
import { Page } from "./Page";
import { AccountPanel, AuthForm } from "./Account";
import { TTS_NAME } from "./phase";
import { DeviceVoiceLine } from "./VoiceNote";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b border-white/5 py-5 first:pt-1 last:border-0">
      <h3 className="font-medium text-zinc-100">{title}</h3>
      {hint && <p className="mt-1 text-sm leading-relaxed text-zinc-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-white/5 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-2 text-sm transition disabled:opacity-30 ${
            o.value === value ? "bg-white text-black shadow" : "text-zinc-300 active:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span className="text-sm text-zinc-300">{label}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-violet-500" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

const CONTEXT_OPTIONS = [1, 3, 5, 10].map((m) => ({ value: m, label: `${m} min` }));

function MicPicker({ micLabel }: { micLabel: string }) {
  const t = useT();
  const settings = useSettings();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let alive = true;
    void getEngine()
      .enumerateMics()
      .then((list) => {
        if (alive) setMics(list);
      });
    return () => {
      alive = false;
    };
  }, [micLabel]);

  const hasLabels = mics.some((m) => m.label);
  return (
    <div className="space-y-2">
      <select
        value={settings.micId}
        onChange={(e) => updateSettings({ micId: e.target.value })}
        className="w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-base outline-none focus:border-violet-400/60"
      >
        <option value="">{t.settings.micDefault}</option>
        {mics.map((m, i) => {
          const label = m.label || t.settings.micN(i + 1);
          return (
            <option key={m.deviceId} value={m.deviceId}>
              {label}
              {/iphone/i.test(label) ? t.settings.recommended : ""}
            </option>
          );
        })}
      </select>
      {!hasLabels && <p className="text-xs text-zinc-500">{t.settings.micNamesLater}</p>}
    </div>
  );
}

function SelfTest() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await getEngine().selftest());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.settings.selftestFailed);
    } finally {
      setBusy(false);
    }
  };

  const rows = result
    ? ([
        [t.settings.selftestRows.stt, result.stt],
        [t.settings.selftestRows.llm, result.llm],
        [t.settings.selftestRows.tts, result.tts],
      ] as const)
    : [];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium active:bg-white/10 disabled:opacity-50"
      >
        {busy ? t.settings.testing : t.settings.runSelftest}
      </button>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {rows.map(([label, item]) =>
        item ? (
          <div key={label} className="rounded-xl bg-white/[0.03] px-3.5 py-2.5 text-sm">
            <div className="flex justify-between">
              <span className={item.ok ? "text-emerald-300" : "text-rose-300"}>
                {item.ok ? "✓" : "✗"} {label}
              </span>
              <span className="text-zinc-500 tabular-nums">{(item.ms / 1000).toFixed(1)} s</span>
            </div>
            <p className="mt-1 break-words text-xs leading-relaxed text-zinc-400">{item.detail}</p>
          </div>
        ) : null,
      )}
    </div>
  );
}

export function SettingsPage({ state, onOpenHistory }: { state: EngineState; onOpenHistory: () => void }) {
  const t = useT();
  const s = useSettings();
  const engine = getEngine();
  const cloud = engine.hasCloudVoice();
  const voiceOptions: Array<{ value: VoicePref; label: string; disabled?: boolean }> = [
    { value: "cloud", label: t.settings.cloud, disabled: !cloud },
    { value: "device", label: t.settings.device },
  ];
  const voice: VoicePref = cloud ? s.voice : "device";

  const uiLangOptions: Array<{ value: UiLangPref; label: string }> = [
    { value: "auto", label: t.settings.uiLangAuto },
    { value: "sv", label: UI_LANG_NAMES.sv },
    { value: "da", label: UI_LANG_NAMES.da },
    { value: "en", label: UI_LANG_NAMES.en },
  ];
  const languageOptions: Array<{ value: LanguagePref; label: string }> = [
    { value: "auto", label: t.settings.auto },
    { value: "sv", label: UI_LANG_NAMES.sv },
    { value: "da", label: UI_LANG_NAMES.da },
    { value: "en", label: UI_LANG_NAMES.en },
  ];
  const styleOptions: Array<{ value: AnswerStyle; label: string }> = [
    { value: "smart", label: t.settings.styles.smart },
    { value: "expert", label: t.settings.styles.expert },
    { value: "witty", label: t.settings.styles.witty },
  ];
  const cueOptions: Array<{ value: CuePref; label: string }> = [
    { value: "voice", label: t.settings.cueOptions.voice },
    { value: "short", label: t.settings.cueOptions.short },
    { value: "beep", label: t.settings.cueOptions.beep },
  ];

  return (
    <Page title={t.settings.title}>
      <Section title={t.settings.uiLang} hint={t.settings.uiLangHint}>
        <Segmented value={s.uiLang} options={uiLangOptions} onChange={(uiLang) => updateSettings({ uiLang })} />
      </Section>

      <Section title={t.settings.about} hint={t.settings.aboutHint}>
        <textarea
          value={s.profile}
          onChange={(e) => updateSettings({ profile: e.target.value })}
          rows={3}
          maxLength={800}
          placeholder={t.settings.aboutPlaceholder}
          className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-base leading-relaxed outline-none focus:border-violet-400/60"
        />
      </Section>

      <Section title={t.settings.language} hint={t.settings.languageHint}>
        <Segmented value={s.language} options={languageOptions} onChange={(language) => updateSettings({ language })} />
      </Section>

      <Section title={t.settings.style} hint={t.settings.styleHint}>
        <Segmented value={s.style} options={styleOptions} onChange={(style) => updateSettings({ style })} />
      </Section>

      <Section
        title={t.settings.voice}
        hint={
          state.config?.cloudTts
            ? t.settings.voiceHintCloud(TTS_NAME[state.config.cloudTts.provider])
            : t.settings.voiceHintNoCloud
        }
      >
        <div className="space-y-4">
          <Segmented value={voice} options={voiceOptions} onChange={(v) => updateSettings({ voice: v })} />
          {voice === "device" && <DeviceVoiceLine />}
          {voice === "device" && (
            <label className="block">
              <div className="flex justify-between text-sm text-zinc-300">
                <span>{t.settings.rate}</span>
                <span className="tabular-nums text-zinc-500">{s.rate.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={0.8}
                max={1.5}
                step={0.05}
                value={s.rate}
                onChange={(e) => updateSettings({ rate: Number(e.target.value) })}
                className="mt-2 w-full accent-violet-400"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => engine.testVoice()}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium active:bg-white/10"
          >
            {t.settings.testVoice}
          </button>
        </div>
      </Section>

      <Section title={t.settings.cues} hint={t.settings.cuesHint}>
        <div className="space-y-4">
          <Segmented value={s.cue} options={cueOptions} onChange={(cue) => updateSettings({ cue })} />
          <Toggle
            checked={s.alertOnQuestion}
            onChange={(alertOnQuestion) => updateSettings({ alertOnQuestion })}
            label={t.settings.alertOnQuestion}
          />
        </div>
      </Section>

      <Section title={t.settings.mic} hint={t.settings.micHint}>
        <MicPicker micLabel={state.micLabel} />
        <label className="mt-4 block">
          <div className="flex justify-between text-sm text-zinc-300">
            <span>{t.settings.sensitivity}</span>
            <span className="tabular-nums text-zinc-500">{s.sensitivity}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={s.sensitivity}
            onChange={(e) => updateSettings({ sensitivity: Number(e.target.value) })}
            className="mt-2 w-full accent-violet-400"
          />
          <p className="mt-1 text-xs text-zinc-500">{t.settings.sensitivityHint}</p>
        </label>
      </Section>

      <Section title={t.settings.memory} hint={t.settings.memoryHint}>
        <Segmented
          value={s.contextMinutes}
          options={CONTEXT_OPTIONS}
          onChange={(contextMinutes) => updateSettings({ contextMinutes })}
        />
        <div className="mt-4 space-y-4">
          <Toggle
            checked={s.showTranscript}
            onChange={(showTranscript) => updateSettings({ showTranscript })}
            label={t.settings.showTranscript}
          />
          <button
            type="button"
            onClick={onOpenHistory}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium active:bg-white/10"
          >
            {t.settings.history} ({state.history.length})
          </button>
        </div>
      </Section>

      {FEATURES.notes && <Section title={t.settings.memoryTitle} hint={t.settings.memoryOnHint}>
        <div className="space-y-4">
          <Toggle checked={s.memory} onChange={(memory) => updateSettings({ memory })} label={t.settings.memoryOn} />
          {s.memory && (
            <>
              <div>
                <p className="mb-2 text-sm text-zinc-300">{t.settings.memoryDays}</p>
                <Segmented
                  value={s.memoryDays}
                  options={MEMORY_DAY_OPTIONS.map((d) => ({ value: d as number, label: t.settings.memoryDayOption(d) }))}
                  onChange={(memoryDays) => {
                    updateSettings({ memoryDays });
                    void pruneMemory(memoryDays).catch(() => {});
                  }}
                />
              </div>
              <div>
                <Toggle checked={s.suggest} onChange={(suggest) => updateSettings({ suggest })} label={t.settings.suggest} />
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t.settings.suggestHint}</p>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(t.settings.clearMemoryConfirm)) return;
              void clearMemory().then(() => getEngine().showNotice(t.settings.memoryCleared, "info"));
            }}
            className="w-full rounded-xl border border-rose-400/20 bg-rose-500/5 py-3 text-sm font-medium text-rose-200 active:bg-rose-500/15"
          >
            {t.settings.clearMemory}
          </button>
        </div>
      </Section>}

      {state.config?.passwordRequired && (
        <Section title={state.config.accounts.enabled ? t.account.section : t.settings.code}>
          {state.needsPassword ? (
            <AuthForm config={state.config} />
          ) : (
            <div className="space-y-4">
              {state.config.account && <AccountPanel config={state.config} account={state.config.account} />}
              <div className="flex items-center justify-between text-sm">
                <span className="text-emerald-300">
                  {t.settings.unlocked}
                  {state.config.user ? ` · ${state.config.user}` : ""}
                </span>
                <button type="button" className="text-zinc-400" onClick={() => engine.logout()}>
                  {t.settings.logout}
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title={t.settings.selftest} hint={t.settings.selftestHint}>
        <SelfTest />
      </Section>
    </Page>
  );
}
