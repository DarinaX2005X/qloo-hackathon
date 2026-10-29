import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

const BASE = "https://tiles.openfreemap.org/styles/positron";

// Atlas palette in sRGB (map layers do not take OKLCH everywhere).
const C = {
  paper: "#f6f1e9",
  land: "#f3ede3",
  residential: "#efe8dc",
  water: "#d6e2e8",
  waterLabel: "#7f97a3",
  park: "#e3e9d6",
  building: "#ebe3d6",
  road: "#fffdf9",
  roadCase: "#e2d9cb",
  roadMajor: "#fffefb",
  rail: "#ddd4c6",
  label: "#8c7f73",
  labelStrong: "#5c4f45",
  halo: "#f6f1e9",
};

const DROP = /aeroway|airport|shield|boundary_disputed|ice_shelf|glacier|highway-name-path|label_country|label_state|ne2/;

let cache: Promise<StyleSpecification> | null = null;

/** OpenFreeMap Positron restyled as a quiet paper atlas: no POIs, warm land, soft water. */
export function loadAtlasStyle(): Promise<StyleSpecification> {
  cache ??= fetch(BASE)
    .then((r) => r.json() as Promise<StyleSpecification>)
    .then((style) => {
      const layers: LayerSpecification[] = [];
      for (const raw of style.layers) {
        if (DROP.test(raw.id)) continue;
        const l = structuredClone(raw) as LayerSpecification & { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
        const id = l.id;
        const paint = (l.paint ??= {});
        if (l.type === "background") paint["background-color"] = C.land;
        else if (id === "park" || id === "landcover_wood") Object.assign(paint, { "fill-color": C.park, "fill-opacity": 0.9 });
        else if (id === "water") paint["fill-color"] = C.water;
        else if (id === "waterway") paint["line-color"] = C.water;
        else if (id === "landuse_residential") Object.assign(paint, { "fill-color": C.residential, "fill-opacity": 0.6 });
        else if (id === "building") Object.assign(paint, { "fill-color": C.building, "fill-opacity": 0.55 });
        else if (/casing/.test(id)) paint["line-color"] = C.roadCase;
        else if (/highway_motorway|highway_major/.test(id)) paint["line-color"] = C.roadMajor;
        else if (/highway|road/.test(id) && l.type === "line") paint["line-color"] = C.road;
        else if (/railway/.test(id)) paint["line-color"] = C.rail;
        else if (l.type === "symbol") {
          Object.assign(paint, {
            "text-color": /water/.test(id) ? C.waterLabel : /city/.test(id) ? C.labelStrong : C.label,
            "text-halo-color": C.halo,
            "text-halo-width": 1.4,
          });
          if (/label_village|label_other/.test(id)) (l as { minzoom?: number }).minzoom = 13;
        }
        layers.push(l);
      }
      return { ...style, layers } as StyleSpecification;
    })
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** First symbol layer: terrain goes under labels so street and district names stay readable. */
export function firstLabelLayer(style: StyleSpecification) {
  return style.layers.find((l) => l.type === "symbol")?.id;
}
