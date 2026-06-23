"use client";

import type MapLibreGL from "maplibre-gl";
import { useEffect, useId, useRef } from "react";

import { dispatchMobileMapFeatureClick, useMap } from "./map-context";

type MapPaintColor = string | MapLibreGL.ExpressionSpecification;

type MapRouteProps = {
  /** Optional unique identifier for the route layer */
  id?: string;
  /** Array of [longitude, latitude] coordinate pairs defining the route */
  coordinates: [number, number][];
  /** Line color as CSS color value (default: "#4285F4") */
  color?: string;
  /** Line width in pixels (default: 3) */
  width?: number;
  /** Line opacity from 0 to 1 (default: 0.8) */
  opacity?: number;
  /** Dash pattern [dash length, gap length] for dashed lines */
  dashArray?: [number, number];
  /** Callback when the route line is clicked */
  onClick?: () => void;
  /** Callback when mouse enters the route line */
  onMouseEnter?: () => void;
  /** Callback when mouse leaves the route line */
  onMouseLeave?: () => void;
  /** Whether the route is interactive - shows pointer cursor on hover (default: true) */
  interactive?: boolean;
};

function MapRoute({
  id: propId,
  coordinates,
  color = "#4285F4",
  width = 3,
  opacity = 0.8,
  dashArray,
  onClick,
  onMouseEnter,
  onMouseLeave,
  interactive = true,
}: MapRouteProps) {
  const { map, isLoaded } = useMap();
  const autoId = useId();
  const id = propId ?? autoId;
  const sourceId = `route-source-${id}`;
  const layerId = `route-layer-${id}`;

  // Add source and layer on mount
  useEffect(() => {
    if (!isLoaded || !map) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [] },
      },
    });

    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color,
        "line-width": width,
        "line-opacity": opacity,
        ...(dashArray && { "line-dasharray": dashArray }),
      },
    });

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  // When coordinates change, update the source data
  useEffect(() => {
    if (!isLoaded || !map || coordinates.length < 2) return;

    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
    if (source) {
      source.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      });
    }
  }, [isLoaded, map, coordinates, sourceId]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return;

    map.setPaintProperty(layerId, "line-color", color);
    map.setPaintProperty(layerId, "line-width", width);
    map.setPaintProperty(layerId, "line-opacity", opacity);
    if (dashArray) {
      map.setPaintProperty(layerId, "line-dasharray", dashArray);
    }
  }, [isLoaded, map, layerId, color, width, opacity, dashArray]);

  // Handle click and hover events
  useEffect(() => {
    if (!isLoaded || !map || !interactive) return;

    const handleClick = () => {
      dispatchMobileMapFeatureClick();
      onClick?.();
    };
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
      onMouseEnter?.();
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      onMouseLeave?.();
    };

    map.on("click", layerId, handleClick);
    map.on("mouseenter", layerId, handleMouseEnter);
    map.on("mouseleave", layerId, handleMouseLeave);

    return () => {
      map.off("click", layerId, handleClick);
      map.off("mouseenter", layerId, handleMouseEnter);
      map.off("mouseleave", layerId, handleMouseLeave);
    };
  }, [
    isLoaded,
    map,
    layerId,
    onClick,
    onMouseEnter,
    onMouseLeave,
    interactive,
  ]);

  return null;
}

type MapClusterLayerProps<
  P extends GeoJSON.GeoJsonProperties = GeoJSON.GeoJsonProperties
> = {
  /** GeoJSON FeatureCollection data or URL to fetch GeoJSON from */
  data: string | GeoJSON.FeatureCollection<GeoJSON.Point, P>;
  /** Maximum zoom level to cluster points on (default: 14) */
  clusterMaxZoom?: number;
  /** Radius of each cluster when clustering points in pixels (default: 50) */
  clusterRadius?: number;
  /** Colors for cluster circles: [small, medium, large] based on point count (default: ["#51bbd6", "#f1f075", "#f28cb1"]) */
  clusterColors?: [string, string, string];
  /** Point count thresholds for color/size steps: [medium, large] (default: [100, 750]) */
  clusterThresholds?: [number, number];
  /** Cluster circle radii in pixels for the three count steps (default: [20, 30, 40]) */
  clusterSizes?: [number, number, number];
  /** Opacity for cluster and point circles (default: 1) */
  circleOpacity?: number;
  /** Stroke width in pixels around cluster and point circles (default: 0) */
  circleStrokeWidth?: number;
  /** Color for unclustered individual points, or a MapLibre paint expression (default: "#3b82f6") */
  pointColor?: MapPaintColor;
  /** Callback when an unclustered point is clicked */
  onPointClick?: (
    feature: GeoJSON.Feature<GeoJSON.Point, P>,
    coordinates: [number, number]
  ) => void;
  /** Callback when a cluster is clicked. If not provided, zooms into the cluster */
  onClusterClick?: (
    clusterId: number,
    coordinates: [number, number],
    pointCount: number
  ) => void;
};

function MapClusterLayer<
  P extends GeoJSON.GeoJsonProperties = GeoJSON.GeoJsonProperties
>({
  data,
  clusterMaxZoom = 14,
  clusterRadius = 50,
  clusterColors = ["#51bbd6", "#f1f075", "#f28cb1"],
  clusterThresholds = [100, 750],
  clusterSizes = [20, 30, 40],
  circleOpacity = 1,
  circleStrokeWidth = 0,
  pointColor = "#3b82f6",
  onPointClick,
  onClusterClick,
}: MapClusterLayerProps<P>) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const sourceId = `cluster-source-${id}`;
  const clusterLayerId = `clusters-${id}`;
  const clusterCountLayerId = `cluster-count-${id}`;
  const unclusteredLayerId = `unclustered-point-${id}`;

  const stylePropsRef = useRef({
    clusterColors,
    clusterThresholds,
    clusterSizes,
    circleOpacity,
    circleStrokeWidth,
    pointColor,
  });

  // Add source and layers on mount
  useEffect(() => {
    if (!isLoaded || !map) return;

    // Add clustered GeoJSON source
    map.addSource(sourceId, {
      type: "geojson",
      data,
      cluster: true,
      clusterMaxZoom,
      clusterRadius,
    });

    // Add cluster circles layer
    map.addLayer({
      id: clusterLayerId,
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          clusterColors[0],
          clusterThresholds[0],
          clusterColors[1],
          clusterThresholds[1],
          clusterColors[2],
        ],
        "circle-radius": [
          "step",
          ["get", "point_count"],
          clusterSizes[0],
          clusterThresholds[0],
          clusterSizes[1],
          clusterThresholds[1],
          clusterSizes[2],
        ],
        "circle-opacity": circleOpacity,
        "circle-stroke-width": circleStrokeWidth,
        "circle-stroke-color": "#ffffff",
      },
    });

    // Add cluster count text layer
    map.addLayer({
      id: clusterCountLayerId,
      type: "symbol",
      source: sourceId,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-size": 12,
      },
      paint: {
        "text-color": "#fff",
      },
    });

    // Add unclustered point layer
    map.addLayer({
      id: unclusteredLayerId,
      type: "circle",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": pointColor,
        "circle-radius": 6,
        "circle-opacity": circleOpacity,
        "circle-stroke-width": circleStrokeWidth,
        "circle-stroke-color": "#ffffff",
      },
    });

    return () => {
      try {
        if (map.getLayer(clusterCountLayerId))
          map.removeLayer(clusterCountLayerId);
        if (map.getLayer(unclusteredLayerId))
          map.removeLayer(unclusteredLayerId);
        if (map.getLayer(clusterLayerId)) map.removeLayer(clusterLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, sourceId]);

  // Update source data when data prop changes (only for non-URL data)
  useEffect(() => {
    if (!isLoaded || !map || typeof data === "string") return;

    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
    if (source) {
      source.setData(data);
    }
  }, [isLoaded, map, data, sourceId]);

  // Update layer styles when props change
  useEffect(() => {
    if (!isLoaded || !map) return;

    const prev = stylePropsRef.current;
    const colorsChanged =
      prev.clusterColors !== clusterColors ||
      prev.clusterThresholds !== clusterThresholds ||
      prev.clusterSizes !== clusterSizes;

    // Update cluster layer colors and sizes
    if (map.getLayer(clusterLayerId) && colorsChanged) {
      map.setPaintProperty(clusterLayerId, "circle-color", [
        "step",
        ["get", "point_count"],
        clusterColors[0],
        clusterThresholds[0],
        clusterColors[1],
        clusterThresholds[1],
        clusterColors[2],
      ]);
      map.setPaintProperty(clusterLayerId, "circle-radius", [
        "step",
        ["get", "point_count"],
        clusterSizes[0],
        clusterThresholds[0],
        clusterSizes[1],
        clusterThresholds[1],
        clusterSizes[2],
      ]);
    }

    const circleStyleChanged =
      prev.circleOpacity !== circleOpacity || prev.circleStrokeWidth !== circleStrokeWidth;
    if (circleStyleChanged) {
      for (const layerId of [clusterLayerId, unclusteredLayerId]) {
        if (!map.getLayer(layerId)) continue;
        map.setPaintProperty(layerId, "circle-opacity", circleOpacity);
        map.setPaintProperty(layerId, "circle-stroke-width", circleStrokeWidth);
      }
    }

    // Update unclustered point layer color
    if (map.getLayer(unclusteredLayerId) && prev.pointColor !== pointColor) {
      map.setPaintProperty(unclusteredLayerId, "circle-color", pointColor);
    }

    stylePropsRef.current = {
      clusterColors,
      clusterThresholds,
      clusterSizes,
      circleOpacity,
      circleStrokeWidth,
      pointColor,
    };
  }, [
    isLoaded,
    map,
    clusterLayerId,
    unclusteredLayerId,
    clusterColors,
    clusterThresholds,
    clusterSizes,
    circleOpacity,
    circleStrokeWidth,
    pointColor,
  ]);

  // Handle click events
  useEffect(() => {
    if (!isLoaded || !map) return;

    // Cluster click handler - zoom into cluster
    const handleClusterClick = async (
      e: MapLibreGL.MapMouseEvent & {
        features?: MapLibreGL.MapGeoJSONFeature[];
        preventDefault?: () => void;
      }
    ) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [clusterLayerId],
      });
      if (!features.length) return;
      e.preventDefault?.();
      e.originalEvent.preventDefault();
      dispatchMobileMapFeatureClick();

      const feature = features[0];
      const clusterId = feature.properties?.cluster_id as number;
      const pointCount = feature.properties?.point_count as number;
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [
        number,
        number
      ];

      if (onClusterClick) {
        onClusterClick(clusterId, coordinates, pointCount);
      } else {
        // Default behavior: zoom to cluster expansion zoom
        const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: coordinates,
          zoom,
        });
      }
    };

    // Unclustered point click handler
    const handlePointClick = (
      e: MapLibreGL.MapMouseEvent & {
        features?: MapLibreGL.MapGeoJSONFeature[];
        preventDefault?: () => void;
      }
    ) => {
      if (!onPointClick || !e.features?.length) return;
      e.preventDefault?.();
      e.originalEvent.preventDefault();
      dispatchMobileMapFeatureClick();

      const feature = e.features[0];
      const coordinates = (
        feature.geometry as GeoJSON.Point
      ).coordinates.slice() as [number, number];

      // Handle world copies
      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      onPointClick(
        feature as unknown as GeoJSON.Feature<GeoJSON.Point, P>,
        coordinates
      );
    };

    // Cursor style handlers
    const handleMouseEnterCluster = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMouseLeaveCluster = () => {
      map.getCanvas().style.cursor = "";
    };
    const handleMouseEnterPoint = () => {
      if (onPointClick) {
        map.getCanvas().style.cursor = "pointer";
      }
    };
    const handleMouseLeavePoint = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", clusterLayerId, handleClusterClick);
    map.on("click", unclusteredLayerId, handlePointClick);
    map.on("mouseenter", clusterLayerId, handleMouseEnterCluster);
    map.on("mouseleave", clusterLayerId, handleMouseLeaveCluster);
    map.on("mouseenter", unclusteredLayerId, handleMouseEnterPoint);
    map.on("mouseleave", unclusteredLayerId, handleMouseLeavePoint);

    return () => {
      map.off("click", clusterLayerId, handleClusterClick);
      map.off("click", unclusteredLayerId, handlePointClick);
      map.off("mouseenter", clusterLayerId, handleMouseEnterCluster);
      map.off("mouseleave", clusterLayerId, handleMouseLeaveCluster);
      map.off("mouseenter", unclusteredLayerId, handleMouseEnterPoint);
      map.off("mouseleave", unclusteredLayerId, handleMouseLeavePoint);
    };
  }, [
    isLoaded,
    map,
    clusterLayerId,
    unclusteredLayerId,
    sourceId,
    onClusterClick,
    onPointClick,
  ]);

  return null;
}

export { MapRoute, MapClusterLayer };
