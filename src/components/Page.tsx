"use client";

import type { ReactNode } from "react";

/** A full screen behind one of the tabs. */
export function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl px-5 pt-safe pb-tabs">
      <header className="flex items-center justify-between gap-3 pt-3 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {action}
      </header>
      {children}
    </main>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>{children}</section>;
}
