"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { drawAsciiGlobe, globePalette } from "./map-loader-globe";

export type MapLoaderVariant = "spinner" | "globe";

/** Default loader for every map unless a specific map explicitly requests another variant. */
export const DEFAULT_MAP_LOADER: MapLoaderVariant = "globe";

/** Spinning ASCII globe rendered on canvas. Static frame under prefers-reduced-motion. */
const MAP_LOADER_EXIT_DURATION = 1700;

function AsciiGlobe({ exiting }: { exiting: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const exitingRef = useRef(exiting);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isDarkRef = useRef(isDark);

  useEffect(() => {
    exitingRef.current = exiting;
    isDarkRef.current = isDark;
    workerRef.current?.postMessage({ type: "state", exiting, isDark });
  }, [exiting, isDark]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full";
    host.appendChild(canvas);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canUseWorker =
      typeof Worker !== "undefined" &&
      "transferControlToOffscreen" in canvas;

    let ctx: CanvasRenderingContext2D | null = null;
    let worker: Worker | null = null;
    let transferred = false;
    let raf = 0;
    let rotation = 0.6;
    let last = performance.now();
    let exitStartedAt = 0;
    let wasExiting = exitingRef.current;

    const dimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return { width: rect.width, height: rect.height, dpr };
    };

    const resize = () => {
      const { width, height, dpr } = dimensions();
      if (worker) {
        worker.postMessage({ type: "resize", width, height, dpr });
        return;
      }
      if (!ctx) return;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      if (!ctx || transferred) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const exitProgress = exitingRef.current
        ? Math.min(1, (performance.now() - exitStartedAt) / MAP_LOADER_EXIT_DURATION)
        : 0;
      drawAsciiGlobe(ctx, width, height, rotation, exitProgress, globePalette(isDarkRef.current));
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
      if (reduceMotion && !worker) draw();
    });
    observer.observe(canvas);

    if (canUseWorker) {
      let candidate: Worker | null = null;
      try {
        candidate = new Worker(new URL("./map-loader.worker.ts", import.meta.url), { type: "module" });
        const offscreen = canvas.transferControlToOffscreen();
        transferred = true;
        worker = candidate;
        workerRef.current = worker;
        const { width, height, dpr } = dimensions();
        worker.postMessage({
          type: "init",
          canvas: offscreen,
          width,
          height,
          dpr,
          isDark: isDarkRef.current,
          exiting: exitingRef.current,
          reduceMotion,
          exitDuration: MAP_LOADER_EXIT_DURATION,
        }, [offscreen]);
      } catch {
        candidate?.terminate();
        worker = null;
      }
    }

    if (!worker && !transferred) {
      ctx = canvas.getContext("2d");
      resize();
      if (reduceMotion) draw();
      else raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      canvas.remove();
    };
  }, []);

  return <div ref={hostRef} className="h-full w-full" aria-hidden="true" />;
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
