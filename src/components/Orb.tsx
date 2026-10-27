"use client";

import { useEffect, useRef } from "react";
import { getEngine } from "@/lib/client/engine";
import type { Tone } from "./phase";

/** The big round button. Its rings follow the microphone level. */
export function Orb({ tone, label, hint }: { tone: Tone; label: string; hint: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const engine = getEngine();
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const { rms } = engine.getLevel();
      const target = Math.min(1, Math.sqrt(rms) * 4);
      smooth = smooth * 0.82 + target * 0.18;
      ref.current?.style.setProperty("--level", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className="orb" data-tone={tone}>
      <div className="orb-ripple" />
      <div className="orb-ripple orb-ripple-late" />
      <div className="orb-ring" />
      <div className="orb-spinner" />
      <div className="orb-core">
        <div className="px-6 text-center">
          <div className="text-[1.65rem] font-semibold tracking-tight text-white">{label}</div>
          <div className="mt-1.5 text-[0.95rem] leading-snug text-zinc-400">{hint}</div>
        </div>
      </div>
    </div>
  );
}
