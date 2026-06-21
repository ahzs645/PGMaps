"use client";

import { cn } from "@/lib/utils";

/**
 * tasmap-style theme swatches: each map theme is drawn as a small multi-slice
 * "pinwheel" pie (the same fixed wedge geometry tasmap uses), so a whole palette
 * reads at a glance. Picking one recolors the shared basemap.
 *
 * The wedge `d` strings below are tasmap's exact fixed geometry — every 4-colour
 * theme reuses the same four wedges, every 7-colour theme the same seven — so we
 * store only the colours per theme and reuse the paths.
 */

const PIE_PATHS_4 = [
  "M 24,24 l 24,0 a24,24 0 0,0 -45.62325282965806,-10.413209738821397 z",
  "M 24,24 l -21.623252829658057,-10.413209738821397 a24,24 0 0,0 16.282750414706506,33.811479631185165 z",
  "M 24,24 l -5.34050241495155,23.398269892363768 a24,24 0 0,0 20.304257659561152,-4.63431431313105 z",
  "M 24,24 l 14.963755244609601,18.763955579232718 a24,24 0 0,0 9.036244755390399,-18.76395557923271 z",
];

const PIE_PATHS_7 = [
  "M 24,24 l 24,0 a24,24 0 0,0 -41.46909144886786,-16.456939082073916 z",
  "M 24,24 l -17.469091448867857,-16.456939082073916 a24,24 0 0,0 1.3627291682509757,34.24977736284075 z",
  "M 24,24 l -16.10636228061688,17.792838280766837 a24,24 0 0,0 17.53712528469256,6.164476201999555 z",
  "M 24,24 l 1.4307630040756778,23.957314482766392 a24,24 0 0,0 16.678787879721845,-8.207896500277378 z",
  "M 24,24 l 18.109550883797525,15.749417982489014 a24,24 0 0,0 3.2092318221816427,-4.726283041137542 z",
  "M 24,24 l 21.318782705979167,11.023134941351472 a24,24 0 0,0 2.0012814549906714,-5.350868416561751 z",
  "M 24,24 l 23.32006416096984,5.6722665247897215 a24,24 0 0,0 0.6799358390301613,-5.672266524789715 z",
];

function piePaths(count: number): string[] {
  return count >= 7 ? PIE_PATHS_7 : PIE_PATHS_4;
}

export type MapThemePreset = {
  id: string;
  label: string;
  /** Display colours, in wedge order (alpha preserved for swatch fidelity). */
  colors: string[];
};

/** The basemap colours a theme drives, derived from its wedge colours. */
export type ThemeColors = {
  primaryColor: string;
  backgroundColor: string;
  waterColor: string;
  landcoverColor: string;
  roadColor: string;
  boundaryColor: string;
  buildingColor: string;
};

/** Normalise any css colour (hex 3/6, rgb, rgba) to a 6-digit hex, dropping alpha. */
export function toHex6(input: string): string {
  const value = input.trim();
  if (value.startsWith("#")) {
    const body = value.slice(1);
    if (body.length === 3) {
      return (
        "#" +
        body
          .split("")
          .map((c) => c + c)
          .join("")
          .toLowerCase()
      );
    }
    return "#" + body.slice(0, 6).toLowerCase();
  }
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const [r, g, b] = match[1].split(",").map((part) => parseFloat(part.trim()));
    const channel = (n: number) =>
      Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)))
        .toString(16)
        .padStart(2, "0");
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }
  return "#000000";
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Perceived relative luminance (0 dark … 1 light). */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSV-style saturation (0 grey … 1 vivid). */
function saturation(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Pick a label/marker accent: the wedge that contrasts most with the background
 * (so labels stay legible), nudged toward the more vivid option on ties. This
 * yields a dark accent on light themes and a bright accent (e.g. neon) on dark
 * ones — matching how tasmap keeps its brand colour readable over the map.
 */
function pickAccent(hexes: string[], background: string): string {
  const base = luminance(background);
  let best = hexes[0];
  let bestScore = -Infinity;
  for (const hex of hexes) {
    const score = Math.abs(luminance(hex) - base) + 0.15 * saturation(hex);
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }
  return best;
}

/**
 * Map a theme's wedge colours onto the basemap roles the way tasmap's style
 * does (see tasmapLocalMapStyle.js): the four wedges of a palette read as
 * `[land, water, road, green]`, i.e. background / water / roads / landcover. The
 * label+marker accent is derived for contrast since the pie carries no separate
 * brand colour.
 */
export function deriveThemeColors(colors: string[]): ThemeColors {
  const hex = colors.map(toHex6);
  const long = hex.length >= 7;

  const backgroundColor = hex[0];
  const waterColor = hex[1] ?? hex[0];
  const roadColor = (long ? hex[3] : hex[2]) ?? hex[0];
  const landcoverColor = (long ? (hex[5] ?? hex[4]) : hex[3]) ?? waterColor;
  const primaryColor = pickAccent(hex, backgroundColor);

  return {
    backgroundColor,
    waterColor,
    roadColor,
    landcoverColor,
    primaryColor,
    boundaryColor: primaryColor,
    buildingColor: roadColor,
  };
}

/** Theme palettes lifted verbatim from tasmap's swatch picker. */
export const MAP_THEMES: MapThemePreset[] = [
  { id: "classic", label: "Classic", colors: ["#e3d7c2", "#7abff1", "#fbfbfb", "#c9d67a"] },
  { id: "midnight", label: "Midnight", colors: ["#343332", "#191A1A", "#454545", "#454545"] },
  { id: "greyscale", label: "Greyscale", colors: ["#EDEDED", "#CAD2D3", "#929292", "#E5E5E5"] },
  {
    id: "mono-light",
    label: "Mono Light",
    colors: ["rgba(238, 238, 238, 1)", "rgba(189, 189, 189, 1)", "rgba(66, 66, 66, 1)", "rgba(189, 189, 189, 1)"],
  },
  {
    id: "amber-noir",
    label: "Amber Noir",
    colors: ["rgba(18, 18, 18, 1)", "rgba(33, 33, 33, 1)", "rgba(238, 170, 43, 0.45)", "rgba(28, 38, 23, 1)"],
  },
  { id: "rose", label: "Rosé", colors: ["#e5aab4", "#f0ced3", "#d46981", "#c1cd75"] },
  {
    id: "teal-coral",
    label: "Teal Coral",
    colors: ["rgba(128, 203, 196, 1)", "rgba(77, 182, 172, 1)", "#fbfbfb", "rgba(239, 154, 154, 1)"],
  },
  {
    id: "sea-green",
    label: "Sea Green",
    colors: ["rgba(244, 243, 237, 1)", "#5BA6A6", "rgba(117, 117, 117, 1)", "#8BBCB5"],
  },
  {
    id: "sunset-pop",
    label: "Sunset Pop",
    colors: ["rgba(245, 245, 245, 1)", "rgba(245, 245, 245, 1)", "rgba(255, 112, 67, 1)", "rgba(156, 204, 101, 1)"],
  },
  { id: "peach-mint", label: "Peach Mint", colors: ["#F9F5E9", "#8ECCC0", "#E8A08E", "#D6E2C9"] },
  {
    id: "sand-sea",
    label: "Sand & Sea",
    colors: ["rgba(230, 213, 195, 1)", "rgba(92, 137, 179, 1)", "rgba(245, 235, 224, 1)", "rgba(152, 179, 150, 1)"],
  },
  { id: "mint", label: "Mint", colors: ["#F7F7F5", "#5BBFB0", "#D9D9D9", "#A8D4C9"] },
  { id: "pastel", label: "Pastel", colors: ["#F9F5F0", "#B8E1F2", "#F2C1B6", "#D1E8C5"] },
  {
    id: "coral-indigo",
    label: "Coral Indigo",
    colors: ["rgba(241, 176, 160, 1)", "rgba(132, 148, 188, 1)", "rgba(251, 251, 251, 1)", "rgba(184, 212, 184, 1)"],
  },
  {
    id: "mauve-sand",
    label: "Mauve Sand",
    colors: ["rgba(231, 224, 206, 1)", "rgba(231, 224, 206, 1)", "rgba(145, 142, 159, 1)", "rgba(145, 142, 159, 0.25)"],
  },
  {
    id: "pine",
    label: "Pine",
    colors: ["rgba(93, 129, 122, 1)", "rgba(93, 129, 122, 1)", "rgba(220, 219, 192, 1)", "rgba(139, 159, 149, 1)"],
  },
  {
    id: "navy-stone",
    label: "Navy Stone",
    colors: ["rgba(230, 222, 209, 1)", "rgba(30, 53, 81, 1)", "rgba(114, 130, 145, 0.65)", "rgba(143, 163, 181, 1)"],
  },
  {
    id: "lilac",
    label: "Lilac",
    colors: ["rgba(247, 232, 234, 1)", "rgba(232, 209, 214, 1)", "rgba(155, 139, 158, 1)", "rgba(181, 163, 184, 1)"],
  },
  { id: "olive", label: "Olive", colors: ["#94a540", "#c0c67a", "#eddfb2", "#7a8446"] },
  {
    id: "cartographer",
    label: "Cartographer",
    colors: ["#f9f7f0", "#3471ae", "#09558c", "#cdd9db", "#a1a7ad", "#9d9981", "#cbc1bc"],
  },
  { id: "desert-sunset", label: "Desert Sunset", colors: ["#fff0d6", "#efd196", "#DB4E11", "#D35F22"] },
  {
    id: "vivid",
    label: "Vivid",
    colors: ["#F9F8F7", "#674196", "#130012", "#F6AD48", "#F9D5D8", "#EC6700", "#D7003A"],
  },
  {
    id: "heather",
    label: "Heather",
    colors: ["rgba(235, 230, 195, 1)", "rgba(168, 201, 185, 1)", "rgba(123, 110, 136, 1)", "rgba(230, 168, 153, 1)"],
  },
  { id: "cyberpunk", label: "Cyberpunk", colors: ["#16213e", "#1a1a2e", "#0f3460", "#00ff41"] },
];

/** The pinwheel pie for a single theme palette. */
export function ThemeSwatch({ colors, size = 48 }: { colors: string[]; size?: number }) {
  const paths = piePaths(colors.length);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <g transform="rotate(-90 24 24)">
        {colors.map((color, index) => (
          <path key={index} d={paths[index] ?? paths[paths.length - 1]} fill={color} />
        ))}
      </g>
    </svg>
  );
}

/** A round, clickable theme swatch button (theme-aware focus/active ring). */
export function ThemeSwatchButton({
  colors,
  label,
  active = false,
  size = 48,
  onClick,
}: {
  colors: string[];
  label: string;
  active?: boolean;
  size?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "rounded-full shadow-xl transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-primary ring-offset-2 ring-offset-popover",
      )}
      style={{ width: size, height: size }}
    >
      <ThemeSwatch colors={colors} size={size} />
    </button>
  );
}
