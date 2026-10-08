import { useTheme } from "next-themes";
import { MapLoader as ToolkitMapLoader, type MapLoaderProps } from "@pgmaps/geo-toolkit/map/map-loader";
export * from "@pgmaps/geo-toolkit/map/map-loader";
export function MapLoader(props: MapLoaderProps) {
  const { resolvedTheme } = useTheme();
  return <ToolkitMapLoader {...props} theme={props.theme ?? (resolvedTheme === "dark" ? "dark" : "light")} />;
}
