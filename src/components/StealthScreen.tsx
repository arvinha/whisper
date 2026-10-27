"use client";

import { useEffect, useRef, useState } from "react";
import type { Phase } from "@/lib/client/engine";
import { getEngine } from "@/lib/client/engine";
import { useT } from "@/lib/client/i18n";
import { phaseInfo } from "./phase";
import { usePress } from "./usePress";

const DOT: Record<string, string> = {
  listen: "bg-violet-400/40",
  think: "bg-amber-300/50",
  ready: "bg-emerald-400/60",
  speak: "bg-sky-400/50",
  idle: "bg-zinc-700",
};

/** A black screen (looks switched off on OLED) where the whole screen is the button. */
export function StealthScreen({ phase, onExit }: { phase: Phase; onExit: () => void }) {
  const engine = getEngine();
  const t = useT();
  const press = usePress({ onTap: () => engine.press(), onLongPress: () => engine.repeat() });
  const [hint, setHint] = useState(true);
  const lastCornerTap = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const tone = phaseInfo(phase, t).tone;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button type="button" {...press} className="no-callout absolute inset-0 cursor-default" aria-label={t.stealth.button} />
      <div className={`pointer-events-none absolute right-5 bottom-[max(env(safe-area-inset-bottom),20px)] size-1.5 rounded-full ${DOT[tone]}`} />
      <button
        type="button"
        aria-label={t.stealth.exit}
        className="absolute top-0 left-0 size-24"
        onClick={() => {
          const now = Date.now();
          if (now - lastCornerTap.current < 450) onExit();
          lastCornerTap.current = now;
        }}
      />
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 px-10 text-center text-sm leading-relaxed text-zinc-600 transition-opacity">
          {t.stealth.hintTap}
          <br />
          {t.stealth.hintHold}
          <br />
          {t.stealth.hintExit}
        </div>
      )}
    </div>
  );
}
