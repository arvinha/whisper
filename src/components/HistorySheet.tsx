"use client";

import type { AnswerView } from "@/lib/client/engine";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { timeLabel } from "./phase";
import { Sheet } from "./Sheet";

export function HistorySheet({ history, onClose }: { history: AnswerView[]; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet title={t.history.title} onClose={onClose}>
      {history.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">{t.history.empty}</p>
      ) : (
        <ul className="space-y-3 pb-6">
          {history.map((a) => (
            <li key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-zinc-500">{timeLabel(a.at, t.locale)}</div>
              {a.question && <p className="mt-1 text-sm text-zinc-400">{a.question}</p>}
              <p className="mt-1.5 font-medium text-white">{a.short}</p>
              {a.detail && <p className="mt-2 text-sm leading-relaxed text-zinc-300">{a.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <button
          type="button"
          onClick={() => {
            getEngine().clearHistory();
            onClose();
          }}
          className="mb-6 w-full rounded-xl border border-white/10 bg-white/5 py-3 text-sm text-zinc-300"
        >
          {t.history.clear}
        </button>
      )}
    </Sheet>
  );
}
