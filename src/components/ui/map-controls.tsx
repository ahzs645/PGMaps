"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Locate, Maximize, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { MAP_OVERLAY_Z } from "./map-overlay";
import { useMap } from "./map-context";
import { greatCircleMeters, scaleBarFor, type ScaleBar } from "./map-scale";

type MapControlsProps = {
  /** Position of the controls on the map (default: "bottom-right") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Optional mobile-only position. Desktop keeps `position`. */
  mobilePosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Show zoom in/out buttons (default: true) */
  showZoom?: boolean;
  /** Show compass button to reset bearing (default: false) */
  showCompass?: boolean;
  /** Show locate button to find user's location (default: false) */
  showLocate?: boolean;
  /** Show fullscreen toggle button (default: false) */
  showFullscreen?: boolean;
  /** Additional CSS classes for the controls container */
  className?: string;
  /** Callback with user coordinates when located */
  onLocate?: (coords: { longitude: number; latitude: number }) => void;
};

const positionClasses = {
  "top-left": "top-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-10 right-2",
};

const desktopPositionClasses = {
  "top-left": "md:top-2 md:bottom-auto md:left-2 md:right-auto",
  "top-right": "md:top-2 md:bottom-auto md:right-2 md:left-auto",
  "bottom-left": "md:bottom-2 md:top-auto md:left-2 md:right-auto",
  "bottom-right": "md:bottom-10 md:top-auto md:right-2 md:left-auto",
};

const mobilePanelAwarePositionClasses = {
  "bottom-left": "max-md:bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-legend-panel-visible-height,0px)+var(--map-timeline-height,0px)+var(--map-safe-bottom-offset,0px)+2.5rem)]",
  "bottom-right": "max-md:bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-legend-panel-visible-height,0px)+var(--map-timeline-height,0px)+var(--map-safe-bottom-offset,0px)+2.5rem)]",
};

function ControlGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden [&>button:not(:last-child)]:border-b [&>button:not(:last-child)]:border-border">
      {children}
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  children,
  disabled = false,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      type="button"
      className={cn(
        "flex size-11 items-center justify-center transition-colors hover:bg-accent dark:hover:bg-accent/40 md:size-8",
        disabled && "opacity-50 pointer-events-none cursor-not-allowed"
      )}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function MapControls({
  position = "bottom-right",
  mobilePosition,
  showZoom = true,
  showCompass = false,
  showLocate = false,
  showFullscreen = false,
  className,
  onLocate,
}: MapControlsProps) {
  const { map, isLoaded } = useMap();
  const [waitingForLocation, setWaitingForLocation] = useState(false);

  const handleZoomIn = useCallback(() => {
    map?.zoomTo(map.getZoom() + 1, { duration: 300 });
  }, [map]);

  const handleZoomOut = useCallback(() => {
    map?.zoomTo(map.getZoom() - 1, { duration: 300 });
  }, [map]);

  const handleResetBearing = useCallback(() => {
    map?.resetNorthPitch({ duration: 300 });
  }, [map]);

  const handleLocate = useCallback(() => {
    setWaitingForLocation(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            longitude: pos.coords.longitude,
            latitude: pos.coords.latitude,
          };
          map?.flyTo({
            center: [coords.longitude, coords.latitude],
            zoom: 14,
            duration: 1500,
          });
          onLocate?.(coords);
          setWaitingForLocation(false);
        },
        () => {
          setWaitingForLocation(false);
        }
      );
    }
  }, [map, onLocate]);

  const handleFullscreen = useCallback(() => {
    const container = map?.getContainer();
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, [map]);

  if (!isLoaded) return null;

  return (
    <div
      className={cn(
        "absolute flex flex-col gap-1.5",
        MAP_OVERLAY_Z.controls,
        positionClasses[mobilePosition ?? position],
        mobilePosition ? desktopPositionClasses[position] : null,
        (mobilePosition ?? position) in mobilePanelAwarePositionClasses
          ? mobilePanelAwarePositionClasses[(mobilePosition ?? position) as keyof typeof mobilePanelAwarePositionClasses]
          : null,
        className
      )}
    >
      {showZoom && (
        <ControlGroup>
          <ControlButton onClick={handleZoomIn} label="Zoom in">
            <Plus className="size-4" />
          </ControlButton>
          <ControlButton onClick={handleZoomOut} label="Zoom out">
            <Minus className="size-4" />
          </ControlButton>
        </ControlGroup>
      )}
      {showCompass && (
        <ControlGroup>
          <CompassButton onClick={handleResetBearing} />
        </ControlGroup>
      )}
      {showLocate && (
        <ControlGroup>
          <ControlButton
            onClick={handleLocate}
            label="Find my location"
            disabled={waitingForLocation}
          >
            {waitingForLocation ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Locate className="size-4" />
            )}
          </ControlButton>
        </ControlGroup>
      )}
      {showFullscreen && (
        <ControlGroup>
          <ControlButton onClick={handleFullscreen} label="Toggle fullscreen">
            <Maximize className="size-4" />
          </ControlButton>
        </ControlGroup>
      )}
    </div>
  );
}

function CompassButton({ onClick }: { onClick: () => void }) {
  const { isLoaded, map } = useMap();
  const compassRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!isLoaded || !map || !compassRef.current) return;

    const compass = compassRef.current;

    const updateRotation = () => {
      const bearing = map.getBearing();
      const pitch = map.getPitch();
      compass.style.transform = `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`;
    };

    map.on("rotate", updateRotation);
    map.on("pitch", updateRotation);
    updateRotation();

    return () => {
      map.off("rotate", updateRotation);
      map.off("pitch", updateRotation);
    };
  }, [isLoaded, map]);

  return (
    <ControlButton onClick={onClick} label="Reset bearing to north">
      <svg
        ref={compassRef}
        viewBox="0 0 24 24"
        className="size-5 transition-transform duration-200 md:size-4"
        style={{ transformStyle: "preserve-3d" }}
      >
        <path d="M12 2L16 12H12V2Z" className="fill-red-500" />
        <path d="M12 2L8 12H12V2Z" className="fill-red-300" />
        <path d="M12 22L16 12H12V22Z" className="fill-muted-foreground/60" />
        <path d="M12 22L8 12H12V22Z" className="fill-muted-foreground/30" />
      </svg>
    </ControlButton>
  );
}

/**
 * The control set the PG map sections settled on: top-right on desktop, moved
 * clear of the mobile sheet, with zoom and compass. `Map` and `SharedMap`
 * render this when their `controls` prop is omitted, so a section only spells
 * controls out when it wants something else.
 */
export const DEFAULT_MAP_CONTROLS = (
  <MapControls position="top-right" mobilePosition="bottom-right" showZoom showCompass />
);

type MapScaleBarProps = {
  /** Corner to sit in; bottom corners clear the phone sheet like the controls do. */
  position?: "bottom-left" | "bottom-right";
  /** Longest the bar may be, in pixels (default 100). */
  maxWidth?: number;
  /** Hide when the map is pitched past this, where one scale no longer holds (default 60°). */
  hideAbovePitch?: number;
  className?: string;
};

/**
 * A metric scale bar measured across the map's vertical middle, great-circle,
 * as MapLibre's own control is, but drawn in the app's theme. Hidden on a
 * steeply pitched map (an eye-level view), where the scale runs from
 * centimetres at the bottom to kilometres at the horizon.
 */
function MapScaleBar({ position = "bottom-left", maxWidth = 100, hideAbovePitch = 60, className }: MapScaleBarProps) {
  const { map, isLoaded } = useMap();
  const [bar, setBar] = useState<ScaleBar | null>(null);

  useEffect(() => {
    if (!isLoaded || !map) return;
    const update = () => {
      if (map.getPitch() > hideAbovePitch) {
        setBar(null);
        return;
      }
      const y = map.getContainer().clientHeight / 2;
      const left = map.unproject([0, y]);
      const right = map.unproject([maxWidth, y]);
      setBar(scaleBarFor(greatCircleMeters(left, right) / maxWidth, maxWidth));
    };
    update();
    map.on("move", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [isLoaded, map, maxWidth, hideAbovePitch]);

  if (!bar) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute rounded bg-background/80 px-1.5 pb-1 pt-0.5 text-[10px] leading-3 text-foreground shadow-sm",
        MAP_OVERLAY_Z.controls,
        positionClasses[position],
        position === "bottom-right" ? "bottom-8 md:bottom-8" : null,
        mobilePanelAwarePositionClasses[position],
        className
      )}
      role="img"
      aria-label={`Scale: ${bar.label}`}
      data-map-scale={bar.meters}
    >
      <span className="block tabular-nums">{bar.label}</span>
      <span
        className="mt-0.5 block h-1.5 border-x-2 border-b-2 border-foreground"
        style={{ width: `${bar.pixels}px` }}
      />
    </div>
  );
}

export { MapControls, MapScaleBar };
