const KEY = "psst.device";

/** A random id that stays on this phone, so one phone gets one free trial. */
export function deviceId(): string {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return "";
  }
}
