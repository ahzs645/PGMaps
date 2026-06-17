"use client";

import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Editor tool-rail chrome, faithful to tasmap's layout but theme-aware: the
 * vertical rail of round buttons, the secondary sub-button column, popover
 * panels, and the path-type preview tiles all follow the app's light/dark
 * theme via design-system tokens.
 */

type MapToolRailProps = {
  children: ReactNode;
  className?: string;
};

/** Vertical dock of round tool buttons — tasmap's left tool rail. */
export function MapToolRail({ children, className }: MapToolRailProps) {
  return <div className={cn("absolute left-4 top-4 z-20 flex flex-col gap-3", className)}>{children}</div>;
}

const RAIL_BUTTON_BASE =
  "relative flex size-12 items-center justify-center rounded-full shadow-lg backdrop-blur transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5";

function railButtonClasses(active: boolean) {
  return cn(
    RAIL_BUTTON_BASE,
    active
      ? "bg-background text-primary ring-2 ring-primary"
      : "bg-background/95 text-foreground ring-1 ring-border hover:bg-accent",
  );
}

type MapToolRailButtonProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: boolean;
  onClick?: () => void;
  flyout?: ReactNode;
  flyoutOpen?: boolean;
};

/** A round 48px rail button (theme-aware). */
export function MapToolRailButton({
  icon,
  label,
  active = false,
  badge = false,
  onClick,
  flyout,
  flyoutOpen = false,
}: MapToolRailButtonProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={railButtonClasses(active)}
      >
        {icon}
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-primary shadow ring-2 ring-background" />
        ) : null}
      </button>
      {flyout && flyoutOpen ? <div className="absolute left-full top-0 z-30 ml-3">{flyout}</div> : null}
    </div>
  );
}

type MapSubToolButtonProps = {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  badge?: boolean;
  onClick?: () => void;
  children?: ReactNode;
};

/** A round 48px secondary tool-rail button (theme-aware). */
export function MapSubToolButton({
  icon,
  label,
  active = false,
  badge = false,
  onClick,
  children,
}: MapSubToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={railButtonClasses(active)}
    >
      {children ?? icon}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-primary shadow ring-2 ring-background" />
      ) : null}
    </button>
  );
}

/** Popover card for editor submenus — uses the design-system popover surface. */
export function MapEditorPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

type PathPreviewSwatchProps = {
  curved: boolean;
  dashed: boolean;
  arrow: boolean;
  color: string;
  selected?: boolean;
  onClick?: () => void;
  label?: string;
};

/** A mini SVG preview of a path type — tasmap's 2×4 path picker tiles. */
export function PathPreviewSwatch({
  curved,
  dashed,
  arrow,
  color,
  selected = false,
  onClick,
  label,
}: PathPreviewSwatchProps) {
  const d = curved ? "M7 36 C 19 12, 30 38, 41 14" : "M7 35 L41 14";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "flex size-12 items-center justify-center rounded-lg border transition-colors",
        selected ? "border-primary bg-accent" : "border-border hover:bg-accent",
      )}
    >
      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={dashed ? "5 4" : undefined}
        />
        {arrow ? <path d="M41 14 l-7 0.5 l3.5 4.2 z" fill={color} /> : null}
      </svg>
    </button>
  );
}
