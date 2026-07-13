"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type MapLoaderVariant = "spinner" | "globe";

/** Default loader for every map unless a specific map explicitly requests another variant. */
export const DEFAULT_MAP_LOADER: MapLoaderVariant = "globe";

// Rough land-mass ellipses [centerLat, centerLon, latRadius, lonRadius] — enough
// silhouette for a thumbnail-sized globe without shipping real coastline data.
const LAND_MASSES = [
  [48, -100, 22, 33], [62, -98, 16, 42], [30, -98, 12, 16], [15, -88, 10, 9], [72, -40, 11, 17],
  [-8, -62, 18, 16], [-30, -65, 16, 9], [50, 14, 13, 22], [62, 18, 9, 12], [8, 18, 22, 20],
  [-18, 24, 16, 13], [50, 70, 24, 40], [60, 120, 20, 55], [25, 80, 13, 12], [30, 110, 14, 20],
  [5, 110, 11, 16], [-25, 134, 12, 19],
] as const;

function isLand(lat: number, lon: number) {
  if (lat < -62) return true;
  return LAND_MASSES.some(([cLat, cLon, rLat, rLon]) => {
    const dl = Math.min(Math.abs(lon - cLon), 360 - Math.abs(lon - cLon));
    return ((lat - cLat) / rLat) ** 2 + (dl / rLon) ** 2 <= 1;
  });
}

const LAND_CHARS = ["░", "▒", "▓", "█"];
const OCEAN_CHARS = [" ", "·", ".", ":", "░"];

/** Spinning ASCII globe rendered on canvas. Static frame under prefers-reduced-motion. */
const MAP_LOADER_EXIT_DURATION = 1700;

function AsciiGlobe({ exiting }: { exiting: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exitingRef = useRef(exiting);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    exitingRef.current = exiting;
  }, [exiting]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = isDark
      ? { bright: "#e9edea", dim: "#76817c", rim: "#4da3ff" }
      : { bright: "#334155", dim: "#94a3b8", rim: "#0284c7" };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let rotation = 0.6;
    let last = performance.now();
    let exitStartedAt = 0;
    let wasExiting = exitingRef.current;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      if (width === 0 || height === 0) return;
      const radius = Math.min(width, height) * 0.46;
      const fontSize = Math.max(6, Math.round((radius * 2) / 40));
      const xStep = fontSize * 0.6;
      const yStep = fontSize * 1.02;
      const cols = Math.ceil(width / xStep);
      const rows = Math.ceil(height / yStep);
      const cx = width / 2;
      const cy = height / 2;
      const tilt = (16 * Math.PI) / 180;
      const exitProgress = exitingRef.current
        ? Math.min(1, (performance.now() - exitStartedAt) / MAP_LOADER_EXIT_DURATION)
        : 0;
      const cut = exitProgress * 2;

      ctx.clearRect(0, 0, width, height);
      ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let row = 0; row < rows; row++) {
        const py = row * yStep + yStep / 2;
        const ny = (py - cy) / radius;
        if (ny < -1.05 || ny > 1.05) continue;
        for (let col = 0; col < cols; col++) {
          const px = col * xStep + xStep / 2;
          const nx = (px - cx) / radius;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) continue;
          const edge = Math.sqrt(r2);
          if (cut > 0 && edge < cut - 0.035) continue;
          const z = Math.sqrt(1 - r2);
          const latY = -ny * Math.cos(tilt) + z * Math.sin(tilt);
          const depth = ny * Math.sin(tilt) + z * Math.cos(tilt);
          const rx = nx * Math.cos(rotation) - depth * Math.sin(rotation);
          const rz = nx * Math.sin(rotation) + depth * Math.cos(rotation);
          const lat = (Math.asin(Math.max(-1, Math.min(1, latY))) * 180) / Math.PI;
          const lon = (Math.atan2(rx, rz) * 180) / Math.PI;
          const light = Math.max(0, nx * -0.55 + -ny * 0.5 + z * 0.66) * 0.85 + 0.15;
          if (light < 0.08) continue;
          const chars = isLand(lat, lon) ? LAND_CHARS : OCEAN_CHARS;
          const char = chars[Math.min(chars.length - 1, Math.floor(light * chars.length))];
          if (char === " ") continue;
          ctx.fillStyle =
            r2 > 0.9 && nx > 0 ? palette.rim : light > 0.62 ? palette.bright : palette.dim;
          ctx.globalAlpha = r2 > 0.9 ? 0.86 : 1;
          ctx.fillText(char, px, py);
        }
      }
      ctx.globalAlpha = 1;
    };

    const frame = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;
      if (exitingRef.current && !wasExiting) exitStartedAt = time;
      if (!exitingRef.current) exitStartedAt = 0;
      wasExiting = exitingRef.current;
      rotation += (Math.PI / 6) * dt;
      draw();
      raf = requestAnimationFrame(frame);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw();
    });
    observer.observe(canvas);
    resize();

    if (reduceMotion) {
      draw();
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [isDark]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}

type MapLoaderProps = {
  label?: string;
  variant?: MapLoaderVariant;
  /** Keep the loader mounted long enough to play its completion transition. */
  visible?: boolean;
};

/** Full-map loading overlay shared by Map and the persistent shared map. */
export function MapLoader({
  label = "Loading map data",
  variant = DEFAULT_MAP_LOADER,
  visible = true,
}: MapLoaderProps) {
  const [phase, setPhase] = useState<"hidden" | "visible" | "exiting">(visible ? "visible" : "hidden");
  const hasShownRef = useRef(visible);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (visible) {
      hasShownRef.current = true;
      frameRef.current = requestAnimationFrame(() => {
        setPhase("visible");
        frameRef.current = null;
      });
      return () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      };
    }

    if (!hasShownRef.current) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) {
      frameRef.current = requestAnimationFrame(() => {
        setPhase("exiting");
        frameRef.current = null;
      });
    }
    timeoutRef.current = setTimeout(() => {
      setPhase("hidden");
      timeoutRef.current = null;
    }, reduceMotion ? 0 : MAP_LOADER_EXIT_DURATION);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [visible]);

  if (phase === "hidden") return null;

  const exiting = phase === "exiting";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden transition-[background-color,backdrop-filter] duration-[1700ms] ease-in-out",
        exiting ? "bg-background/0 backdrop-blur-0" : "bg-background/45 backdrop-blur-[2px]",
      )}
      role={visible ? "status" : undefined}
      aria-live={visible ? "polite" : undefined}
      aria-label={visible ? label : undefined}
      aria-hidden={exiting || undefined}
    >
      {exiting && (
        <svg className="map-loader-bloom" aria-hidden="true">
          <circle cx="50%" cy="50%" />
        </svg>
      )}
      {variant === "globe" ? (
        <div className="h-28 w-28">
          <AsciiGlobe exiting={exiting} />
        </div>
      ) : (
        <div
          className={cn(
            "relative flex h-28 w-28 items-center justify-center transition-[opacity,transform] duration-700",
            exiting && "scale-125 opacity-0",
          )}
        >
          <span className="absolute h-24 w-24 rounded-full border border-sky-500/20" />
          <span className="absolute h-20 w-20 animate-ping rounded-full border border-sky-500/25" />
          <span className="absolute h-16 w-16 rounded-full border-2 border-sky-500/45 border-t-transparent animate-spin" />
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background/95 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-sky-600 dark:text-sky-400" aria-hidden="true" />
          </div>
        </div>
      )}
      <span
        className={cn(
          "absolute translate-y-20 rounded-md border border-border bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-[opacity,transform] duration-300",
          exiting && "translate-y-16 opacity-0",
        )}
      >
        {label}
      </span>
    </div>
  );
}
