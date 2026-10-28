"use client";

import { useAgenda, useNow } from "@/lib/client/agenda";
import type { EngineState, InputMode } from "@/lib/client/engine";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { usePreps } from "@/lib/client/preps";
import { useSettings } from "@/lib/client/settings";
import { useDeviceVoiceName } from "@/lib/client/voices";
import { FEATURES } from "@/lib/shared/features";
import { upcoming, whenLabel } from "./CalendarPage";
import { BriefcaseIcon, CalendarIcon, ChevronIcon, HeadphonesIcon, KeyboardIcon, MicIcon } from "./icons";
import { AccountPanel, AuthForm } from "./Account";
import { AskBox } from "./AskBox";
import { BalanceBar } from "./BalanceBar";
import { InboxCard } from "./InboxCard";
import { providerName, TTS_NAME } from "./phase";
import { useSpokenLang, VoiceMissingNote } from "./VoiceNote";

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className={`font-semibold tracking-tight ${size === "lg" ? "text-3xl" : "text-lg"}`}>
      whis<span className="text-violet-300">per</span>
    </span>
  );
}

function Logo() {
  return (
    <div className="relative grid size-20 place-items-center">
      <div className="absolute inset-0 rounded-full bg-violet-500/30 blur-xl" />
      <div className="relative grid size-20 place-items-center rounded-full border border-white/10 bg-gradient-to-b from-zinc-800 to-zinc-950">
        <svg viewBox="0 0 40 24" width={40} height={24} aria-hidden="true">
          {[4, 10, 16, 22, 28, 34].map((x, i) => {
            const h = [6, 14, 22, 16, 10, 5][i];
            return <rect key={x} x={x - 1.5} y={12 - h / 2} width={3} height={h} rx={1.5} fill={i % 2 ? "#c4b5fd" : "#fff"} />;
          })}
        </svg>
      </div>
    </div>
  );
}

function StatusCard({ state }: { state: EngineState }) {
  const t = useT();
  const settings = useSettings();
  const deviceVoice = useDeviceVoiceName(useSpokenLang());
  const { config, configLoading, configError } = state;

  if (configLoading && !config) {
    return <div className="h-14 animate-pulse rounded-2xl bg-white/5" />;
  }
  if (!config) {
    return (
      <div className="rounded-2xl border border-rose-400/30 bg-rose-950/40 p-4 text-sm text-rose-100">
        <p className="font-medium">{t.home.serverDown}</p>
        <p className="mt-1 text-rose-200/80">{configError}</p>
        <button
          type="button"
          onClick={() => void getEngine().loadConfig()}
          className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 font-medium"
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  const voice =
    settings.voice === "cloud" && config.cloudTts
      ? `${TTS_NAME[config.cloudTts.provider]} · ${config.cloudTts.voice}`
      : deviceVoice
        ? t.home.deviceVoice(deviceVoice)
        : t.home.deviceVoiceDefault;
  const rows: Array<[string, string | null]> = [
    [t.home.listensWith, config.stt ? `${providerName(config.stt.provider, t)} · ${config.stt.model}` : null],
    [t.home.answersWith, config.llm ? `${providerName(config.llm.provider, t)} · ${config.llm.model}` : null],
    [t.home.voice, voice],
  ];
  const ok = !!config.llm && !!config.stt && config.problems.length === 0;

  return (
    <div className="space-y-3">
      {state.needsPassword && (
        <div className="rounded-2xl border border-violet-400/30 bg-violet-500/10 p-4">
          <AuthForm config={config} />
        </div>
      )}
      {config.account && !config.account.active && (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4">
          <AccountPanel config={config} account={config.account} />
        </div>
      )}
      {config.mock && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-950/40 p-3.5 text-sm text-amber-100">{t.home.mock}</div>
      )}
      <details className="group rounded-2xl border border-white/10 bg-white/[0.03] text-sm" open={!ok}>
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3">
          <span className={`size-2.5 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`} />
          <span className="flex-1 text-zinc-200">
            {ok ? t.home.ready : t.home.fixTitle}
            {config.user && <span className="text-zinc-500"> · {config.user}</span>}
          </span>
          <ChevronIcon width={16} height={16} className="text-zinc-500 transition group-open:rotate-180" />
        </summary>
        <dl className="divide-y divide-white/5 border-t border-white/5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <dt className="text-zinc-500">{label}</dt>
              <dd className={`truncate text-right ${value ? "text-zinc-300" : "text-rose-300"}`}>{value ?? t.home.missing}</dd>
            </div>
          ))}
        </dl>
        {config.problems.length > 0 && (
          <div className="border-t border-white/5 px-4 py-3 text-rose-200/90">
            <ul className="list-disc space-y-1 pl-5">
              {config.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="mt-2 text-rose-200/70">{t.home.fixRestart}</p>
          </div>
        )}
      </details>
      <VoiceMissingNote config={config} />
    </div>
  );
}

/** Shows which preparation the answers build on, or invites the user to make one. */
export function PrepCard({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  const t = useT();
  const { preps, activeId } = usePreps();
  const active = preps.find((p) => p.id === activeId) ?? null;
  const name = active ? active.title || t.prep.kinds[active.kind] : "";
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${
          active ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-white/5 text-zinc-400"
        }`}
      >
        <BriefcaseIcon width={16} height={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {active ? t.home.prepCompact(name, active.docs.length) : t.home.prepCompactNone}
        </span>
        <span className="shrink-0 text-zinc-500">{t.common.change}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left active:bg-white/10 ${
        active ? "border-emerald-400/25 bg-emerald-500/10" : "border-violet-400/25 bg-violet-500/10"
      }`}
    >
      <BriefcaseIcon className={active ? "shrink-0 text-emerald-300" : "shrink-0 text-violet-300"} />
      <span className="min-w-0 flex-1">
        {active ? (
          <>
            <span className="block font-medium text-emerald-100">{name}</span>
            <span className="block text-sm text-emerald-200/70">
              {t.home.prepActive(active.docs.length, active.brief?.questions.length ?? 0)}
            </span>
          </>
        ) : (
          <>
            <span className="block font-medium text-violet-100">{t.home.prepInviteTitle}</span>
            <span className="block text-sm text-violet-200/70">{t.home.prepInviteText}</span>
          </>
        )}
      </span>
    </button>
  );
}

function NextUp({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const t = useT();
  const items = useAgenda();
  const now = useNow();
  const next = upcoming(items, now, 3);
  if (next.length === 0) return null;
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <CalendarIcon width={18} height={18} className="text-violet-300" /> {t.home.nextUp}
        </h2>
        <button type="button" onClick={onOpenCalendar} className="text-sm text-violet-300 active:text-violet-200">
          {t.home.seeAll}
        </button>
      </div>
      <ul className="space-y-2">
        {next.map((item) => (
          <li key={item.id} className="flex items-baseline gap-3 text-sm">
            <span className="w-28 shrink-0 text-zinc-500">{whenLabel(item, t)}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-100">{item.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeScreen({
  state,
  onStart,
  onOpenPrep,
  onOpenCalendar,
  onTopUp,
}: {
  state: EngineState;
  onStart: (mode: InputMode) => void;
  onOpenPrep: () => void;
  onOpenCalendar: () => void;
  onTopUp: () => void;
}) {
  const t = useT();
  const engine = getEngine();
  const micProblem = engine.startProblem("mic");
  const textProblem = engine.startProblem("text");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col px-5 pt-safe pb-tabs">
      <header className="flex items-center py-3">
        <Wordmark />
      </header>
      <BalanceBar state={state} onTopUp={onTopUp} />

      <section className="flex flex-col items-center pt-1 pb-6 text-center">
        <Logo />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t.home.greeting}</h1>
        <p className="mt-1.5 max-w-sm text-balance text-zinc-400">{t.home.tagline}</p>
      </section>

      <div className="space-y-3">
        <StatusCard state={state} />
        <PrepCard onOpen={onOpenPrep} />
      </div>

      <div className="mt-5 space-y-2.5">
        <button
          type="button"
          disabled={!!micProblem}
          onClick={() => onStart("mic")}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-white py-4 text-lg font-semibold text-black shadow-[0_10px_40px_-10px_rgba(167,139,250,0.6)] transition active:scale-[0.99] disabled:opacity-40"
        >
          <MicIcon /> {t.home.start}
        </button>
        <button
          type="button"
          disabled={!!textProblem}
          onClick={() => onStart("text")}
          className="flex w-full items-center justify-center gap-2 py-2 text-sm text-zinc-400 active:text-zinc-200 disabled:opacity-40"
        >
          <KeyboardIcon width={18} height={18} /> {t.home.startText}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {FEATURES.calendar && <InboxCard onOpenCalendar={onOpenCalendar} />}
        {FEATURES.notes && state.config?.llm && <AskBox assist={state.assist} onOpenCalendar={onOpenCalendar} />}
        {FEATURES.calendar && <NextUp onOpenCalendar={onOpenCalendar} />}

        <details className="group rounded-2xl border border-white/10 bg-white/[0.03]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 font-medium">
            <HeadphonesIcon className="text-violet-300" />
            <span className="flex-1">{t.home.howTitle}</span>
            <ChevronIcon width={16} height={16} className="text-zinc-500 transition group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4">
            <ol className="space-y-2.5 text-sm text-zinc-300">
              {(FEATURES.notes ? t.home.steps : t.home.steps.slice(0, 5)).map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500">{t.home.controls}</p>
            <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              {t.home.airpodsTip}
            </p>
          </div>
        </details>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-zinc-600">{t.home.privacy}</p>
    </main>
  );
}
