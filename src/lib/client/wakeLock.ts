export type WakeLockStatus = "on" | "off" | "unsupported";

/** Keeps the screen on; iOS stops the microphone for web pages when the phone locks. */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor(private readonly onChange: (status: WakeLockStatus) => void) {}

  async enable() {
    this.wanted = true;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      this.onChange("unsupported");
      return;
    }
    if (this.sentinel || document.visibilityState !== "visible") return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!this.wanted) {
        void sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) this.sentinel = null;
        this.onChange("off");
      });
      this.onChange("on");
    } catch {
      this.onChange("off");
    }
  }

  /** Wake locks are released when the page is hidden; take it again when it comes back. */
  handleVisible() {
    if (this.wanted && !this.sentinel) void this.enable();
  }

  disable() {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) void sentinel.release().catch(() => {});
    this.onChange("off");
  }
}
