"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Iconify integration — mirrors tasmap's icon picker, which is backed by the
 * iconify icon DB (api.iconify.design). Icons are fetched on demand and cached;
 * bodies use `currentColor`, so markers tint via their `color2`.
 */

const ICONIFY_HOST = "https://api.iconify.design";

type IconData = { body: string; viewBox: string };
const iconCache = new Map<string, IconData | null>();

/** A starter set shown before the user searches. */
export const DEFAULT_MARKER_ICONS = [
  "mdi:map-marker",
  "mdi:flag",
  "mdi:camera",
  "mdi:silverware-fork-knife",
  "mdi:waves",
  "mdi:coffee",
  "mdi:star",
  "mdi:home",
  "mdi:tree",
  "mdi:car",
  "mdi:bed",
  "mdi:cart",
  "mdi:hospital-box",
  "mdi:school",
  "mdi:parking",
  "mdi:hiking",
];

/** Search the iconify DB; returns up to `limit` icon names (e.g. "mdi:home"). */
export async function searchIconify(query: string, limit = 64): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return DEFAULT_MARKER_ICONS;
  try {
    const response = await fetch(
      `${ICONIFY_HOST}/search?query=${encodeURIComponent(trimmed)}&limit=${limit}`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { icons?: string[] };
    return data.icons ?? [];
  } catch {
    return [];
  }
}

async function loadIcon(name: string): Promise<IconData | null> {
  if (iconCache.has(name)) return iconCache.get(name) ?? null;
  const [prefix, icon] = name.split(":");
  if (!prefix || !icon) {
    iconCache.set(name, null);
    return null;
  }
  try {
    const response = await fetch(`${ICONIFY_HOST}/${prefix}.json?icons=${icon}`);
    if (!response.ok) throw new Error("icon fetch failed");
    const data = (await response.json()) as {
      width?: number;
      height?: number;
      icons?: Record<string, { body: string; width?: number; height?: number }>;
    };
    const entry = data.icons?.[icon];
    if (!entry) {
      iconCache.set(name, null);
      return null;
    }
    const width = entry.width ?? data.width ?? 24;
    const height = entry.height ?? data.height ?? 24;
    const value: IconData = { body: entry.body, viewBox: `0 0 ${width} ${height}` };
    iconCache.set(name, value);
    return value;
  } catch {
    iconCache.set(name, null);
    return null;
  }
}

type IconifyIconProps = {
  /** Iconify name, e.g. "mdi:flag" */
  name: string;
  className?: string;
};

/**
 * Renders an iconify icon as inline SVG using `currentColor`. Sizing is left to
 * the parent (so the on-map marker rules like `[&_svg]:size-full` apply).
 */
export function IconifyIcon({ name, className }: IconifyIconProps) {
  const [data, setData] = useState<IconData | null>(() => iconCache.get(name) ?? null);

  useEffect(() => {
    let cancelled = false;
    // loadIcon resolves synchronously-cached entries on a microtask, so this
    // never sets state during the effect body.
    loadIcon(name).then((value) => {
      if (!cancelled) setData(value);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!data) {
    // Reserve space while loading / on failure.
    return <span className={cn("inline-block", className)} aria-hidden="true" />;
  }

  return (
    <svg
      viewBox={data.viewBox}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: data.body }}
    />
  );
}
