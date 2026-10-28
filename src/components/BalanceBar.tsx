"use client";

import { useEffect, useState } from "react";
import type { EngineState } from "@/lib/client/engine";
import { useT, useUiLang } from "@/lib/client/i18n";
import type { Dict } from "@/lib/i18n";
import { ANSWER_ORE, LISTEN_ORE_PER_MINUTE } from "@/lib/shared/pricing";
import { accountCurrency, formatMoney, trialMinutesLeft } from "./Account";

function duration(minutes: number, t: Dict): string {
  return minutes < 120 ? t.bar.minutes(minutes) : t.bar.hours(Math.round(minutes / 60));
}

/** Balance or free minutes left, and what the current or last conversation used. */
export function BalanceBar({ state, onTopUp }: { state: EngineState; onTopUp: () => void }) {
  const t = useT();
  const lang = useUiLang();
  const live = state.phase !== "idle";
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [live]);

  const account = state.config?.account;
  if (!account) return null;
  const currency = accountCurrency(account, lang);
  const money = (ore: number) => formatMoney(ore, currency, t);

  const balance = account.balanceOre > 0 ? t.bar.balance(money(account.balanceOre)) : "";
  let left: string;
  if (account.plan === "trial" && account.active) left = [t.bar.trial(trialMinutesLeft(account)), balance].filter(Boolean).join(" · ");
  else if (account.balanceOre > 0) left = `${balance} · ${t.bar.lasts(duration(Math.floor(account.balanceOre / LISTEN_ORE_PER_MINUTE), t))}`;
  else left = t.bar.empty;

  const usage = state.usage;
  let used = "";
  if (usage) {
    const minutes = Math.max(0, Math.round(((usage.endedAt ?? Math.max(now, usage.startedAt)) - usage.startedAt) / 60_000));
    const cost = usage.spentOre > 0 ? money(usage.spentOre) : usage.freeSeconds > 0 || account.plan === "trial" ? t.bar.free : money(0);
    used = `${usage.endedAt ? t.bar.last : t.bar.now}: ${t.bar.minutes(minutes)} · ${t.bar.answers(usage.answers)} · ${cost}`;
  }

  return (
    <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <p className={`min-w-0 flex-1 truncate font-medium ${account.active ? "text-zinc-100" : "text-rose-300"}`}>{left}</p>
        {state.config?.accounts.billing && (
          <button
            type="button"
            onClick={onTopUp}
            className="shrink-0 rounded-full bg-violet-500/20 px-3 py-1 text-xs font-medium text-violet-100 active:bg-violet-500/30"
          >
            {t.bar.topUp}
          </button>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-zinc-500">
        {used || t.bar.explain(money(LISTEN_ORE_PER_MINUTE), money(ANSWER_ORE))}
      </p>
    </div>
  );
}
