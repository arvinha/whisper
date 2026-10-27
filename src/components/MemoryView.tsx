"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/client/i18n";
import {
  dayMoments,
  forgetRange,
  memoryDays,
  searchMemory,
  startOfDay,
  useMemoryVersion,
  type MemoryHit,
  type Moment,
} from "@/lib/client/memory";
import { useSettings } from "@/lib/client/settings";
import type { Dict } from "@/lib/i18n";
import { Chips } from "./NotesPage";
import { timeLabel } from "./phase";

/** Shorter stretches never get a note (the digester skips them). */
const NOTE_MIN_WORDS = 25;
const DAY_CHIPS = 7;

function dayLabel(day: number, t: Dict): string {
  const today = startOfDay(Date.now());
  if (day === today) return t.memory.today;
  if (day === startOfDay(today - 12 * 60 * 60_000)) return t.memory.yesterday;
  return new Date(day).toLocaleDateString(t.locale, { weekday: "short", day: "numeric", month: "short" });
}

function MomentCard({ m }: { m: Moment }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const note = m.digest;
  const range = `${timeLabel(m.from, t.locale)}–${timeLabel(m.to, t.locale)}`;

  const forget = () => {
    if (window.confirm(t.memory.forgetConfirm)) void forgetRange(m.from, m.to);
  };

  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-zinc-500 tabular-nums">
        {range} · {t.memory.words(m.words)}
      </div>
      {note && (note.title || note.summary) ? (
        <>
          {note.title && <h3 className="mt-1 font-medium text-zinc-100">{note.title}</h3>}
          {note.summary && <p className="mt-1 text-sm leading-relaxed text-zinc-300">{note.summary}</p>}
        </>
      ) : (
        <p className="mt-1 text-sm text-zinc-500 italic">{m.words >= NOTE_MIN_WORDS ? t.memory.pending : t.memory.short}</p>
      )}
      {open && (
        <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto border-t border-white/5 pt-3">
          {m.lines.map((line, i) => (
            <li key={`${line.at}-${i}`} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="w-10 shrink-0 pt-px text-xs text-zinc-600 tabular-nums">{timeLabel(line.at, t.locale)}</span>
              <span className={line.me ? "text-zinc-500" : "text-zinc-300"}>
                {line.me && <span className="mr-1.5 text-xs font-medium text-sky-300/80">{t.live.you}</span>}
                {line.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between text-xs">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-violet-300 active:text-violet-200">
          {open ? t.memory.hideText : t.memory.showText}
        </button>
        <button type="button" onClick={forget} className="text-zinc-500 active:text-zinc-300">
          {t.memory.forget}
        </button>
      </div>
    </li>
  );
}

function Hits({ hits, query }: { hits: MemoryHit[]; query: string }) {
  const t = useT();
  if (hits.length === 0) return <p className="py-6 text-center text-sm text-zinc-500">{t.memory.noHits(query)}</p>;
  return (
    <ul className="space-y-2">
      {hits.map((h, i) => (
        <li key={`${h.line.at}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
          <div className="text-xs text-zinc-500">
            {dayLabel(startOfDay(h.line.at), t)} {timeLabel(h.line.at, t.locale)}
            {h.title && ` · ${h.title}`}
          </div>
          <p className={`mt-0.5 text-sm leading-relaxed ${h.line.me ? "text-zinc-400" : "text-zinc-200"}`}>{h.line.text}</p>
        </li>
      ))}
    </ul>
  );
}

/** Everything Aivia has heard, day by day, with a short note for each stretch and a search. */
export function MemoryView() {
  const t = useT();
  const settings = useSettings();
  const version = useMemoryVersion();
  const [days, setDays] = useState<number[] | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemoryHit[] | null>(null);

  useEffect(() => {
    let live = true;
    void memoryDays()
      .then((list) => live && setDays(list))
      .catch(() => live && setDays([]));
    return () => {
      live = false;
    };
  }, [version]);

  const shownDay = day ?? days?.[0] ?? null;
  useEffect(() => {
    if (shownDay === null) return;
    let live = true;
    void dayMoments(shownDay)
      .then((list) => live && setMoments(list))
      .catch(() => live && setMoments([]));
    return () => {
      live = false;
    };
  }, [shownDay, version]);

  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let live = true;
    const id = setTimeout(() => {
      void searchMemory(query.trim())
        .then((list) => live && setHits(list))
        .catch(() => live && setHits([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, searching, version]);

  const keptNote = <p className="mt-6 text-center text-xs leading-relaxed text-zinc-600">{t.memory.kept(settings.memoryDays)}</p>;

  if (!settings.memory) {
    return <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-400">{t.memory.off}</p>;
  }
  if (days === null) return <div className="h-24 animate-pulse rounded-2xl bg-white/5" />;
  if (days.length === 0) {
    return (
      <>
        <p className="py-6 text-center text-sm leading-relaxed text-zinc-500">{t.memory.empty}</p>
        {keptNote}
      </>
    );
  }

  const dayOptions = days.slice(0, DAY_CHIPS).map((d) => ({ value: d, label: dayLabel(d, t) }));
  if (shownDay !== null && !dayOptions.some((o) => o.value === shownDay)) {
    dayOptions.push({ value: shownDay, label: dayLabel(shownDay, t) });
  }
  const olderDays = days.slice(DAY_CHIPS).filter((d) => d !== shownDay);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-zinc-400">{t.memory.intro}</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.memory.searchPlaceholder}
        enterKeyHint="search"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-base outline-none focus:border-violet-400/60"
      />

      {searching ? (
        hits === null ? (
          <div className="h-16 animate-pulse rounded-2xl bg-white/5" />
        ) : (
          <Hits hits={hits} query={query.trim()} />
        )
      ) : (
        <>
          <Chips value={shownDay} options={dayOptions} onChange={(d) => setDay(d)} />
          {olderDays.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && setDay(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300"
            >
              <option value="">{t.memory.olderDays}</option>
              {olderDays.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d, t)}
                </option>
              ))}
            </select>
          )}
          {moments === null ? (
            <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
          ) : moments.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">{t.memory.emptyDay}</p>
          ) : (
            <ul className="space-y-2.5">
              {moments.map((m) => (
                <MomentCard key={m.from} m={m} />
              ))}
            </ul>
          )}
        </>
      )}
      {keptNote}
    </div>
  );
}
