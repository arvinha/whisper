"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { takeDueReminders, type AgendaItem } from "@/lib/client/agenda";
import { startDigester } from "@/lib/client/digester";
import { getEngine, type InputMode } from "@/lib/client/engine";
import { FEATURES } from "@/lib/shared/features";
import { AuthScreen, SetupScreen } from "./Account";
import { useT, useUiLang } from "@/lib/client/i18n";
import { CalendarPage, whenLabel } from "./CalendarPage";
import { HistorySheet } from "./HistorySheet";
import { HomeScreen } from "./HomeScreen";
import { BellIcon, BriefcaseIcon, CalendarIcon, CloseIcon, HeadphonesIcon, NotesIcon, SettingsIcon } from "./icons";
import { InterruptedOverlay } from "./InterruptedOverlay";
import { LiveScreen } from "./LiveScreen";
import { NotesPage } from "./NotesPage";
import { NoticeBar } from "./NoticeBar";
import { PrepPage } from "./PrepPage";
import { SettingsPage } from "./SettingsPage";
import { StealthScreen } from "./StealthScreen";

type Tab = "listen" | "prep" | "notes" | "calendar" | "settings";

const REMINDER_CHECK_MS = 15_000;

const TAB_ICONS: Record<Tab, (p: { width: number; height: number }) => ReactNode> = {
  listen: (p) => <HeadphonesIcon {...p} />,
  prep: (p) => <BriefcaseIcon {...p} />,
  notes: (p) => <NotesIcon {...p} />,
  calendar: (p) => <CalendarIcon {...p} />,
  settings: (p) => <SettingsIcon {...p} />,
};

const TABS = (Object.keys(TAB_ICONS) as Tab[]).filter(
  (key) => (key !== "notes" || FEATURES.notes) && (key !== "calendar" || FEATURES.calendar),
);

function TabBar({ tab, live, onChange }: { tab: Tab; live: boolean; onChange: (tab: Tab) => void }) {
  const t = useT();
  return (
    <nav className="tabbar fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-zinc-950/90 backdrop-blur-lg">
      <div className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`relative flex flex-col items-center gap-1 pt-2.5 pb-1 text-[11px] ${
              tab === key ? "text-white" : "text-zinc-500 active:text-zinc-300"
            }`}
          >
            {TAB_ICONS[key]({ width: 22, height: 22 })}
            <span className="max-w-full truncate px-0.5">{t.tabs[key]}</span>
            {key === "listen" && live && (
              <span className="absolute top-2 right-[calc(50%-16px)] size-2 animate-pulse rounded-full bg-violet-400" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

function ReminderBanner({ items, onOpen, onDismiss }: { items: AgendaItem[]; onOpen: () => void; onDismiss: () => void }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-safe">
      <div className="notice-in mt-2 flex w-full max-w-xl items-start gap-3 rounded-2xl border border-violet-400/40 bg-violet-950/95 px-4 py-3 shadow-2xl backdrop-blur">
        <BellIcon className="mt-0.5 shrink-0 text-violet-300" />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-xs font-semibold tracking-wide text-violet-300 uppercase">{t.reminder.title}</p>
          {items.map((item) => (
            <p key={item.id} className="mt-0.5 text-sm text-white">
              <span className="font-medium">{item.title}</span>
              <span className="text-violet-200/70"> · {whenLabel(item, t)}</span>
            </p>
          ))}
        </button>
        <button type="button" onClick={onDismiss} aria-label={t.reminder.ok} className="-mr-1 shrink-0 text-violet-200">
          <CloseIcon width={18} height={18} />
        </button>
      </div>
    </div>
  );
}

/** Calendar reminders while the app is open: a banner, and Aivia saying it in the ear when listening. */
function useReminders(): [AgendaItem[], () => void] {
  const [due, setDue] = useState<AgendaItem[]>([]);
  useEffect(() => {
    if (!FEATURES.calendar) return;
    const check = () => {
      const items = takeDueReminders();
      if (items.length === 0) return;
      setDue((prev) => [...prev, ...items].slice(-3));
      for (const item of items) getEngine().remind(item.title);
    };
    check();
    const id = setInterval(check, REMINDER_CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return [due, useCallback(() => setDue([]), [])];
}

export function PsstApp() {
  const engine = getEngine();
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getServerState);
  const lang = useUiLang();
  const [tab, setTab] = useState<Tab>("listen");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stealthWanted, setStealthWanted] = useState(false);
  const [reminders, dismissReminders] = useReminders();

  useEffect(() => {
    const url = new URL(window.location.href);
    const payment = url.searchParams.get("betalning");
    if (payment) url.searchParams.delete("betalning");
    // Back from Google/Apple/Microsoft: the session token or an error is in the fragment.
    const hash = new URLSearchParams(url.hash.slice(1));
    const token = hash.get("login");
    const loginError = hash.get("login_error");
    if (token || loginError) url.hash = "";
    if (payment || token || loginError) window.history.replaceState(null, "", url.pathname + url.search);
    const loaded = token ? engine.submitPassword(token) : engine.loadConfig();
    void loaded.then(() => {
      if (payment) void engine.afterPayment(payment);
      if (loginError) engine.showNotice(loginError, "error");
    });
  }, [engine]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => (FEATURES.notes ? startDigester() : undefined), []);

  const changeTab = (next: Tab) => {
    if (next !== tab) engine.stopReading();
    setTab(next);
    window.scrollTo({ top: 0 });
  };
  const start = (mode: InputMode) => {
    setStealthWanted(false);
    engine.start(mode);
  };
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  const live = state.phase !== "idle";
  const stealth = live && stealthWanted && tab === "listen" && !historyOpen;

  if (state.config && state.needsPassword && !live) {
    return (
      <>
        <AuthScreen config={state.config} />
        <NoticeBar notice={state.notice} onDismiss={() => engine.dismissNotice()} />
      </>
    );
  }

  if (state.config?.account?.reason === "setup" && !live) {
    return (
      <>
        <SetupScreen account={state.config.account} />
        <NoticeBar notice={state.notice} onDismiss={() => engine.dismissNotice()} />
      </>
    );
  }

  if (stealth) {
    return (
      <>
        <StealthScreen phase={state.phase} onExit={() => setStealthWanted(false)} />
        {state.interrupted && <InterruptedOverlay onResume={() => engine.resume()} />}
      </>
    );
  }

  return (
    <>
      <div hidden={tab !== "listen"}>
        {live ? (
          <LiveScreen
            state={state}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenNotes={() => changeTab("notes")}
            onOpenPrep={() => changeTab("prep")}
            onOpenCalendar={() => changeTab("calendar")}
            onStealth={() => setStealthWanted(true)}
          />
        ) : (
          <HomeScreen
            state={state}
            onStart={start}
            onOpenPrep={() => changeTab("prep")}
            onOpenCalendar={() => changeTab("calendar")}
          />
        )}
      </div>
      <div hidden={tab !== "prep"}>
        <PrepPage />
      </div>
      {FEATURES.notes && (
        <div hidden={tab !== "notes"}>
          <NotesPage active={tab === "notes"} onOpenCalendar={() => changeTab("calendar")} />
        </div>
      )}
      {FEATURES.calendar && (
        <div hidden={tab !== "calendar"}>
          <CalendarPage />
        </div>
      )}
      <div hidden={tab !== "settings"}>
        <SettingsPage state={state} onOpenHistory={() => setHistoryOpen(true)} />
      </div>

      <TabBar tab={tab} live={live} onChange={changeTab} />

      {reminders.length > 0 ? (
        <ReminderBanner
          items={reminders}
          onOpen={() => {
            dismissReminders();
            changeTab("calendar");
          }}
          onDismiss={dismissReminders}
        />
      ) : (
        <NoticeBar notice={state.notice} onDismiss={() => engine.dismissNotice()} />
      )}
      {live && state.interrupted && <InterruptedOverlay onResume={() => engine.resume()} />}
      {historyOpen && <HistorySheet history={state.history} onClose={closeHistory} />}
    </>
  );
}
