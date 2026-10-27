"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

interface PressOptions {
  onTap: () => void;
  onLongPress?: () => void;
  longPressMs?: number;
}

/**
 * Tap fires on click (which iOS treats as a user gesture, needed to resume audio);
 * long press fires after holding still. A long press suppresses the following click.
 */
export function usePress({ onTap, onLongPress, longPressMs = 650 }: PressOptions) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      suppressClick.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      if (onLongPress) {
        timer.current = setTimeout(() => {
          timer.current = null;
          suppressClick.current = true;
          onLongPress();
        }, longPressMs);
      }
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 24) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onTap();
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  };
}
