"use client";

import { useState, type FormEvent } from "react";
import type { AssistView } from "@/lib/client/engine";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { useSettings } from "@/lib/client/settings";
import { useSummaries } from "@/lib/client/summaries";
import { CloseIcon, SendIcon, SparkIcon } from "./icons";
import { SummaryView } from "./NotesPage";

/** Aivia's answer to the latest request, typed here or said ("Whisper, …"). */
export function AssistResult({ assist, onOpenCalendar }: { assist: AssistView; onOpenCalendar: () => void }) {
  const t = useT();
  const saved = useSummaries();
  const summary = assist.summaryId ? saved.find((s) => s.id === assist.summaryId) : undefined;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => getEngine().dismissAssist()}
        aria-label={t.common.close}
        className="absolute top-2 right-2 z-10 grid size-8 place-items-center rounded-full text-zinc-500 active:bg-white/10"
      >
        <CloseIcon width={16} height={16} />
      </button>
      {assist.status === "working" ? (
        <div className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4">
          <p className="pr-8 text-sm text-zinc-400">{t.assist.youAsked(assist.request)}</p>
          <p className="mt-2 animate-pulse text-sm text-violet-200">{t.assist.working}</p>
        </div>
      ) : assist.status === "failed" ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-950/30 p-4 text-sm">
          <p className="pr-8 text-zinc-400">{t.assist.youAsked(assist.request)}</p>
          <p className="mt-2 text-rose-200">{assist.error || t.assist.failed}</p>
        </div>
      ) : summary ? (
        <SummaryView s={summary} added={assist.added} onOpenCalendar={onOpenCalendar} />
      ) : null}
    </div>
  );
}

/** One place to ask for anything: about the day, a reminder, an email. */
export function AskBox({ assist, onOpenCalendar }: { assist: AssistView | null; onOpenCalendar: () => void }) {
  const t = useT();
  const settings = useSettings();
  const [text, setText] = useState("");
  const busy = assist?.status === "working";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const request = text.trim();
    if (!request || busy) return;
    setText("");
    void getEngine().assist(request, { spoken: false });
  };

  return (
    <section className="space-y-3">
      <form onSubmit={submit} className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <SparkIcon width={18} height={18} className="text-violet-300" /> {t.assist.title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{settings.memory ? t.assist.hint : t.assist.memoryOff}</p>
        <div className="mt-3 flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            rows={2}
            maxLength={1000}
            enterKeyHint="send"
            placeholder={t.assist.placeholder}
            className="min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-base leading-snug outline-none focus:border-violet-400/60"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            aria-label={t.assist.send}
            className="grid w-11 shrink-0 place-items-center rounded-xl bg-violet-500 text-white disabled:opacity-40"
          >
            <SendIcon width={18} height={18} />
          </button>
        </div>
      </form>
      {assist && <AssistResult assist={assist} onOpenCalendar={onOpenCalendar} />}
    </section>
  );
}
