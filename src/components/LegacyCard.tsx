"use client";

import { useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/client/i18n";
import { claimLegacy, legacyPreview } from "@/lib/client/legacy";
import { dismissLegacy, legacyWaiting, onOwnerChange } from "@/lib/client/owner";

/** Asks the signed-in person whether what the phone saved before accounts is theirs. */
export function LegacyCard() {
  const t = useT();
  const waiting = useSyncExternalStore(onOwnerChange, legacyWaiting, () => false);
  const [busy, setBusy] = useState(false);
  if (!waiting) return null;

  const p = legacyPreview();
  const items = [
    p.preps > 0 ? `${t.legacy.preps(p.preps)}${p.prepTitles.length ? ` (${p.prepTitles.join(", ")})` : ""}` : "",
    p.summaries > 0 ? t.legacy.summaries(p.summaries) : "",
    p.agenda > 0 ? t.legacy.agenda(p.agenda) : "",
    p.profile ? t.legacy.profile : "",
    t.legacy.memory,
  ].filter(Boolean);

  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-950/30 p-4 text-sm text-amber-50">
      <p className="font-semibold">{t.legacy.title}</p>
      <p className="mt-1 text-amber-100/80">{t.legacy.text}</p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-100">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void claimLegacy().finally(() => setBusy(false));
          }}
          className="flex-1 rounded-xl bg-white py-2.5 font-semibold text-black disabled:opacity-50"
        >
          {t.legacy.mine}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={dismissLegacy}
          className="flex-1 rounded-xl bg-white/10 py-2.5 font-medium disabled:opacity-50"
        >
          {t.legacy.notMine}
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-100/60">{t.legacy.note}</p>
    </div>
  );
}
