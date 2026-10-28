"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { AnswerView, EngineState, LineView } from "@/lib/client/engine";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { updateSettings, useSettings } from "@/lib/client/settings";
import { FEATURES } from "@/lib/shared/features";
import { PrepCard, Wordmark } from "./HomeScreen";
import { HistoryIcon, MoonIcon, NotesIcon, RepeatIcon, SendIcon, SparkIcon, StopIcon } from "./icons";
import { Orb } from "./Orb";
import { AuthForm } from "./Account";
import { AssistResult } from "./AskBox";
import { BalanceBar } from "./BalanceBar";
import { InboxCard } from "./InboxCard";
import { PasswordForm } from "./PasswordForm";
import { phaseInfo, providerName, timeLabel } from "./phase";
import { usePress } from "./usePress";
import { VoiceMissingNote } from "./VoiceNote";

function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" | "busy" }) {
  const style =
    tone === "warn"
      ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
      : tone === "busy"
        ? "border-violet-400/30 bg-violet-500/10 text-violet-200"
        : "border-white/10 bg-white/5 text-zinc-300";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${style}`}>{children}</span>;
}

function AnswerCard({ answer }: { answer: AnswerView }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>
          {answer.kind === "topic" ? t.live.remark : t.live.answer} · {timeLabel(answer.at, t.locale)}
        </span>
        <span>
          {(answer.ms / 1000).toFixed(1)} s{answer.prefetched ? ` · ${t.live.prefetched}` : ""}
        </span>
      </div>
      {answer.question && <p className="mt-2 text-sm text-zinc-400">{answer.question}</p>}
      <p className="mt-1.5 text-lg leading-snug font-medium text-white">{answer.short}</p>
      {answer.detail && <p className="mt-3 border-t border-white/5 pt-3 leading-relaxed text-zinc-300">{answer.detail}</p>}
    </section>
  );
}

function Transcript({ lines, textMode }: { lines: LineView[]; textMode: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const [showInput, setShowInput] = useState(textMode);
  const visible = lines.slice(-8);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    getEngine().addTextLine(text);
    setText("");
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-300">{textMode ? t.live.transcriptText : t.live.transcriptLive}</h2>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {!textMode && (
            <button type="button" onClick={() => setShowInput((v) => !v)} className="active:text-zinc-300">
              {showInput ? t.live.hideInput : t.live.showInput}
            </button>
          )}
          {lines.length > 0 && (
            <button type="button" onClick={() => getEngine().clearTranscript()} className="active:text-zinc-300">
              {t.live.clear}
            </button>
          )}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{textMode ? t.live.emptyText : t.live.emptyLive}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {visible.map((line) => (
            <li key={line.id} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="w-10 shrink-0 pt-px text-xs text-zinc-600 tabular-nums">{timeLabel(line.at, t.locale)}</span>
              <span className={line.own ? "text-zinc-500" : line.question ? "text-violet-200" : "text-zinc-300"}>
                {line.own && <span className="mr-1.5 text-xs font-medium text-sky-300/80">{t.live.you}</span>}
                {line.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(showInput || textMode) && (
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.live.inputPlaceholder}
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-base outline-none focus:border-violet-400/60"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label={t.common.add}
            className="grid w-11 place-items-center rounded-xl bg-violet-500 text-white disabled:opacity-40"
          >
            <SendIcon width={18} height={18} />
          </button>
        </form>
      )}
    </section>
  );
}

export function LiveScreen({
  state,
  onOpenHistory,
  onOpenNotes,
  onOpenPrep,
  onOpenCalendar,
  onStealth,
  onTopUp,
}: {
  state: EngineState;
  onOpenHistory: () => void;
  onOpenNotes: () => void;
  onOpenPrep: () => void;
  onOpenCalendar: () => void;
  onStealth: () => void;
  onTopUp: () => void;
}) {
  const t = useT();
  const engine = getEngine();
  const settings = useSettings();
  const info = phaseInfo(state.phase, t);
  const press = usePress({ onTap: () => engine.press(), onLongPress: () => engine.repeat() });
  const textMode = state.mode === "text";
  const headsetMic = /airpods|bluetooth|headset|hands-free|buds|beats/i.test(state.micLabel);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col px-4 pt-safe pb-tabs">
      <header className="flex items-center gap-2 py-3">
        <Wordmark />
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5 overflow-hidden">
          {state.config?.mock ? (
            <Chip tone="warn">{t.live.testMode}</Chip>
          ) : (
            state.config?.llm && <Chip>{providerName(state.config.llm.provider, t)}</Chip>
          )}
          {state.pendingTranscriptions > 0 && <Chip tone="busy">{t.live.transcribing}</Chip>}
        </div>
        <button
          type="button"
          onClick={() => engine.stop()}
          className="flex h-10 items-center gap-1.5 rounded-full bg-rose-500/15 px-3.5 text-sm font-medium text-rose-200 active:bg-rose-500/25"
        >
          <StopIcon width={16} height={16} /> {t.live.stop}
        </button>
      </header>
      <BalanceBar state={state} onTopUp={onTopUp} />

      {state.needsPassword && (
        <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          {state.config ? <AuthForm config={state.config} /> : <PasswordForm />}
        </div>
      )}

      {(state.wakeLock === "unsupported" || headsetMic || state.deviceVoiceProblem) && (
        <div className="mb-2 space-y-2 text-xs leading-relaxed">
          {state.wakeLock === "unsupported" && !textMode && (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-amber-100">{t.live.wakeLock}</p>
          )}
          {headsetMic && (
            <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-zinc-300">
              {t.live.headsetMic(state.micLabel)}
            </p>
          )}
          {state.deviceVoiceProblem && (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-amber-100">
              {t.live.deviceVoiceProblem}
            </p>
          )}
        </div>
      )}
      <VoiceMissingNote config={state.config} className="mb-2" />
      <PrepCard onOpen={onOpenPrep} compact />

      <section className="flex flex-col items-center py-4">
        <button
          type="button"
          {...press}
          className="no-callout rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          aria-label={`${info.label.replace(/[.…]+$/, "")}${/[?!]$/.test(info.label) ? "" : "."} ${info.hint}`}
        >
          <Orb tone={info.tone} label={info.label} hint={info.hint} />
        </button>
        <div className={`mt-5 grid w-full gap-2 ${FEATURES.notes ? "grid-cols-4" : "grid-cols-3"}`}>
          <button
            type="button"
            onClick={() => engine.repeat()}
            className="flex flex-col items-center gap-1 rounded-2xl bg-white/5 py-2.5 text-xs text-zinc-300 active:bg-white/10"
          >
            <RepeatIcon /> {t.live.repeat}
          </button>
          <button
            type="button"
            onClick={() => engine.analyzeNow()}
            className="flex flex-col items-center gap-1 rounded-2xl bg-white/5 py-2.5 text-xs text-zinc-300 active:bg-white/10"
          >
            <SparkIcon /> {t.live.newQuestion}
          </button>
          {FEATURES.notes && (
            <button
              type="button"
              onClick={onOpenNotes}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white/5 py-2.5 text-xs text-zinc-300 active:bg-white/10"
            >
              <NotesIcon /> {t.live.summarize}
            </button>
          )}
          <button
            type="button"
            onClick={onStealth}
            className="flex flex-col items-center gap-1 rounded-2xl bg-white/5 py-2.5 text-xs text-zinc-300 active:bg-white/10"
          >
            <MoonIcon /> {t.live.stealth}
          </button>
        </div>
      </section>

      <div className="space-y-3 pb-4">
        {FEATURES.notes && state.assist && <AssistResult assist={state.assist} onOpenCalendar={onOpenCalendar} />}
        {state.current && <AnswerCard answer={state.current} />}
        {FEATURES.calendar && <InboxCard onOpenCalendar={onOpenCalendar} />}
        {settings.showTranscript || textMode ? (
          <Transcript lines={state.lines} textMode={textMode} />
        ) : (
          <button
            type="button"
            onClick={() => updateSettings({ showTranscript: true })}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 text-sm text-zinc-400"
          >
            {t.live.showTranscript}
          </button>
        )}
        {state.history.length > 1 && (
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] py-3 text-sm text-zinc-300 active:bg-white/10"
          >
            <HistoryIcon width={18} height={18} /> {t.live.earlier(state.history.length)}
          </button>
        )}
      </div>
    </main>
  );
}
