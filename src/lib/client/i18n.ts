import { useSyncExternalStore } from "react";
import { DICTS, type Dict, type UiLang } from "@/lib/i18n";
import { getSettings, subscribeSettings } from "./settings";

function phoneLang(): UiLang {
  if (typeof navigator === "undefined") return "sv";
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "sv") return "sv";
    if (base === "da" || base === "nb" || base === "no" || base === "nn") return "da";
    if (base === "en") return "en";
  }
  return "en";
}

export function uiLang(): UiLang {
  const pref = getSettings().uiLang;
  return pref === "auto" ? phoneLang() : pref;
}

export function getT(): Dict {
  return DICTS[uiLang()];
}

const serverLang = (): UiLang => "sv";

export function useUiLang(): UiLang {
  return useSyncExternalStore(subscribeSettings, uiLang, serverLang);
}

export function useT(): Dict {
  return DICTS[useUiLang()];
}
