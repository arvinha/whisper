"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from "react";
import { addAgendaItems, fromSummary } from "@/lib/client/agenda";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { deleteSummary, formatLocal, saveSummary, summaryText, useSummaries, type SavedSummary } from "@/lib/client/summaries";
import type { SummaryKind } from "@/lib/shared/types";
import { getSettings } from "@/lib/client/settings";
import { CalendarIcon } from "./icons";
import { MemoryView } from "./MemoryView";
import { Page } from "./Page";
import { Suggestions } from "./Suggestions";

export function Chips<T>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1.5 text-sm ${
            o.value === value
              ? "border-white bg-white text-black"
              : "border-white/10 bg-white/5 text-zinc-300 active:bg-white/10"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-white/5 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-2 text-sm ${value === o.value ? "bg-white text-black shadow" : "text-zinc-300"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function List({ title, items }: { title: string; items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-4">
      <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h4>
      <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-zinc-200">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-violet-300">•</span>
            <div className="min-w-0 flex-1">{item}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SummaryView({
  s,
  added,
  onOpenCalendar,
  onDelete,
}: {
  s: SavedSummary;
  added?: number;
  onOpenCalendar: () => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const engine = getEngine();
  const text = summaryText(s, t);
  const kindLabel = s.kind in t.notes.kinds ? t.notes.kinds[s.kind] : t.notes.defaultKind;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };
  const share = async () => {
    if (navigator.share) await navigator.share({ title: s.title, text }).catch(() => {});
    else await copy();
  };
  const readAloud = () => {
    const spoken = s.reply && !s.summary ? s.reply : [s.summary, ...s.points.slice(0, 5)].join(" ");
    engine.readAloud(spoken.slice(0, 1500), s.lang);
  };
  const hasCalendar = s.events.length > 0 || s.tasks.some((x) => x.due);

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-zinc-500">
        {kindLabel}
        {s.minutes > 0 && ` · ${s.minutes} min`} ·{" "}
        {new Date(s.createdAt).toLocaleString(t.locale, { dateStyle: "short", timeStyle: "short" })}
      </div>
      <h3 className="mt-1 text-lg leading-snug font-semibold text-white">{s.title}</h3>
      {s.instruction && <p className="mt-2 text-sm text-zinc-500">{t.notes.youAsked(s.instruction)}</p>}
      {s.reply && (
        <p className="mt-2 rounded-xl bg-violet-500/10 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-violet-100">
          {s.reply}
        </p>
      )}
      {s.summary && <p className="mt-3 leading-relaxed text-zinc-200">{s.summary}</p>}

      <List title={t.notes.points} items={s.points} />
      <List title={t.notes.decisions} items={s.decisions} />
      <List
        title={t.notes.tasks}
        items={s.tasks.map((x) => (
          <>
            <span>{x.text}</span>
            {(x.who || x.due) && (
              <span className="text-zinc-500">
                {" "}
                {[x.who, x.due && formatLocal(x.due, t.locale)].filter(Boolean).join(" · ")}
              </span>
            )}
          </>
        ))}
      />
      <List
        title={t.notes.events}
        items={s.events.map((e) => (
          <>
            <span className="font-medium">{e.title}</span>
            <span className="text-zinc-500">
              {" "}
              {formatLocal(e.start, t.locale)}
              {e.location && ` · ${e.location}`}
            </span>
            {e.notes && <div className="text-zinc-400">{e.notes}</div>}
          </>
        ))}
      />
      <List title={t.notes.positions} items={s.positions.map((p) => (p.who ? `${p.who}: ${p.view}` : p.view))} />
      <List title={t.notes.openQuestions} items={s.openQuestions} />

      <Suggestions s={s} shortcutUrl={engine.getState().config?.remindersShortcutUrl ?? ""} />
      {hasCalendar && (
        <button
          type="button"
          onClick={onOpenCalendar}
          className="mt-2 flex w-full items-center justify-center gap-2 py-1.5 text-xs text-zinc-400 active:text-zinc-200"
        >
          <CalendarIcon width={14} height={14} />
          {added ? `${t.notes.addedToCalendar(added)} · ${t.notes.openCalendar}` : t.notes.openCalendar}
        </button>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={readAloud} className="rounded-xl bg-white/5 py-2.5 text-sm text-zinc-200 active:bg-white/10">
          {t.common.readAloud}
        </button>
        <button type="button" onClick={copy} className="rounded-xl bg-white/5 py-2.5 text-sm text-zinc-200 active:bg-white/10">
          {copied ? t.common.copied : t.common.copy}
        </button>
        <button type="button" onClick={share} className="rounded-xl bg-white/5 py-2.5 text-sm text-zinc-200 active:bg-white/10">
          {t.common.share}
        </button>
      </div>
      {onDelete && (
        <button type="button" onClick={onDelete} className="mt-3 w-full text-center text-xs text-zinc-500 active:text-zinc-300">
          {t.common.delete}
        </button>
      )}
    </article>
  );
}

/** New words since the last automatic summary before opening the tab makes a new one. */
const AUTO_MIN_NEW_WORDS = 40;
const AUTO_KEY = "psst.autoSummaryWords";

function getAutoWords(): number {
  try {
    return Number(window.localStorage.getItem(AUTO_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setAutoWords(words: number) {
  try {
    window.localStorage.setItem(AUTO_KEY, String(words));
  } catch {
    // private mode
  }
}

export function NotesPage({ active, onOpenCalendar }: { active: boolean; onOpenCalendar: () => void }) {
  const t = useT();
  const engine = getEngine();
  const saved = useSummaries();
  const [tab, setTab] = useState<"new" | "memory" | "saved">(() => (getSettings().memory ? "memory" : "new"));
  const [kind, setKind] = useState<SummaryKind>("auto");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: SavedSummary; added: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Re-render as the transcript grows, so the numbers stay current.
  useSyncExternalStore(engine.subscribe, engine.getState, engine.getServerState);
  const stats = engine.transcriptStats();
  const nothing = stats.lines === 0;

  const kindOptions = (Object.keys(t.notes.kinds) as SummaryKind[]).map((value) => ({
    value,
    label: t.notes.kinds[value],
  }));
  const rangeOptions: Array<{ value: number | null; label: string }> = [
    { value: null, label: t.notes.all },
    { value: 10, label: "10 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: t.notes.hour },
  ];

  const run = async (auto = false) => {
    setBusy(true);
    setError(null);
    setResult(null);
    const asked = auto ? "" : instruction.trim();
    try {
      const r = await engine.summarize(auto ? { kind: "auto", minutes: null, instruction: "" } : { kind, minutes, instruction });
      const summary = saveSummary(r, asked);
      const added = addAgendaItems(fromSummary(summary));
      setResult({ summary, added });
      if (!auto) setInstruction("");
      setAutoWords(stats.words);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.notes.failed);
    } finally {
      setBusy(false);
    }
  };

  // Opening the tab after Aivia has heard something new gives fresh suggestions by itself.
  const onOpened = useEffectEvent(() => {
    if (busy) return;
    const last = getAutoWords();
    if (stats.words < last) setAutoWords(0);
    if (stats.words - Math.min(last, stats.words) < AUTO_MIN_NEW_WORDS) return;
    setTab("new");
    setOpenId(null);
    void run(true);
  });
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(onOpened, 0);
    return () => clearTimeout(id);
  }, [active]);

  const open = saved.find((s) => s.id === openId) ?? null;

  return (
    <Page title={t.notes.title}>
      <div className="mb-4">
        <Segmented
          value={tab}
          options={[
            { value: "new", label: t.notes.tabNew },
            { value: "memory", label: t.memory.tab },
            { value: "saved", label: t.notes.tabSaved(saved.length) },
          ]}
          onChange={(v) => {
            setTab(v);
            setOpenId(null);
          }}
        />
      </div>

      {tab === "memory" ? (
        <MemoryView />
      ) : tab === "new" ? (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-zinc-400">
            {nothing ? t.notes.nothing : t.notes.heard(stats.words, stats.minutes)}
          </p>

          {!nothing && (
            <>
              <div>
                <h3 className="mb-2 text-sm font-medium text-zinc-200">{t.notes.whatWasIt}</h3>
                <Chips value={kind} options={kindOptions} onChange={setKind} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium text-zinc-200">{t.notes.howFar}</h3>
                <Chips value={minutes} options={rangeOptions} onChange={setMinutes} />
              </div>
            </>
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-200">
              {t.notes.askAivia} {!nothing && <span className="text-zinc-500">{t.common.optional}</span>}
            </h3>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={nothing ? t.notes.placeholderNothing : t.notes.placeholderSome}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-base leading-relaxed outline-none focus:border-violet-400/60"
            />
          </div>

          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || (nothing && !instruction.trim())}
            className="w-full rounded-2xl bg-white py-3.5 font-semibold text-black disabled:opacity-40"
          >
            {busy ? t.notes.working : nothing ? t.notes.send : t.notes.run}
          </button>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {result && <SummaryView s={result.summary} added={result.added} onOpenCalendar={onOpenCalendar} />}
        </div>
      ) : open ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setOpenId(null)} className="text-sm text-zinc-400 active:text-zinc-200">
            {t.notes.allSaved}
          </button>
          <SummaryView
            s={open}
            onOpenCalendar={onOpenCalendar}
            onDelete={() => {
              deleteSummary(open.id);
              setOpenId(null);
            }}
          />
        </div>
      ) : saved.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">{t.notes.savedEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {saved.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOpenId(s.id)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left active:bg-white/10"
              >
                <div className="text-xs text-zinc-500">
                  {s.kind in t.notes.kinds ? t.notes.kinds[s.kind] : t.notes.defaultKind} ·{" "}
                  {new Date(s.createdAt).toLocaleString(t.locale, { dateStyle: "short", timeStyle: "short" })}
                </div>
                <div className="mt-0.5 font-medium text-zinc-100">{s.title}</div>
                {(s.tasks.length > 0 || s.events.length > 0) && (
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {[s.tasks.length > 0 && t.notes.countTodo(s.tasks.length), s.events.length > 0 && t.notes.countCal(s.events.length)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
