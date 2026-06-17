"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * tasmap-style custom color picker: a round swatch that opens a dark popover
 * with an HSV square, a hue slider, a hex input, and quick theme swatches —
 * replacing the OS-native color input.
 */

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  if ([r, g, b].some((n) => Number.isNaN(n))) return { h: 0, s: 0, v: 0 };

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Track pointer drag over an element, reporting fractional [0..1] x/y. */
function dragHandler(onPos: (x: number, y: number) => void) {
  return (event: React.PointerEvent) => {
    const el = event.currentTarget as HTMLElement;
    const report = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      onPos(clamp01((clientX - rect.left) / rect.width), clamp01((clientY - rect.top) / rect.height));
    };
    report(event.clientX, event.clientY);
    const move = (ev: PointerEvent) => report(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

type MapColorPickerProps = {
  value: string;
  onChange: (value: string) => void;
  title?: string;
  /** Quick-pick swatches (e.g. current theme colors) */
  swatches?: string[];
  /** Open the popover above or below the swatch (default below) */
  placement?: "top" | "bottom";
  className?: string;
};

/** Round swatch button that opens a tasmap-style HSV/hex picker popover. */
export function MapColorPicker({
  value,
  onChange,
  title,
  swatches = [],
  placement = "bottom",
  className,
}: MapColorPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  const hsv = hexToHsv(value);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title ?? "Color"}
        style={{ backgroundColor: value }}
        className="size-7 shrink-0 rounded-full ring-1 ring-border transition-transform hover:scale-110"
      />
      {open ? (
        <div
          className={cn(
            "absolute right-0 z-50 w-56 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl",
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          <div
            onPointerDown={dragHandler((x, y) => onChange(hsvToHex(hsv.h, x, 1 - y)))}
            className="relative h-28 w-full cursor-crosshair rounded-md"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
            }}
          >
            <span
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          <div
            onPointerDown={dragHandler((x) => onChange(hsvToHex(x * 360, hsv.s, hsv.v)))}
            className="relative mt-3 h-3 w-full cursor-pointer rounded-full"
            style={{
              background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
          >
            <span
              className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${(hsv.h / 360) * 100}%` }}
            />
          </div>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            className="mt-3 w-full rounded-md border border-input bg-background px-2 py-1 text-xs uppercase text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {swatches.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {swatches.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => onChange(swatch)}
                  title={swatch}
                  aria-label={swatch}
                  style={{ backgroundColor: swatch }}
                  className="size-5 rounded-full ring-1 ring-border transition-transform hover:scale-110"
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
