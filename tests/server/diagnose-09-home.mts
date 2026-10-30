import { loadEnvFile } from "node:process";
import { installPrivateCapture } from "../qloo/private-capture-09";
import { areaSignature, signatureReference, signatureSimilarity } from "../../src/server/engine/09/signatures";
import { resolveSourceSignature } from "../../src/server/engine/09/home-api";
loadEnvFile(".env.local");
const capture = installPrivateCapture(true);
const reference = await signatureReference();
for (const sourceArea of [{ city: "Lisbon", neighborhood: "Alfama" }, { city: "Berlin", neighborhood: "Kreuzberg" }]) {
  const source = await resolveSourceSignature(sourceArea);
  console.log(JSON.stringify({ source: sourceArea, support: source.quality, categories: source.categoryCounts, places: source.places.map(p => ({ name: p.name, genre: p.primaryGenre })), center: source.area.identity.center }));
  if (sourceArea.city === "Lisbon") for (let offset = 0; offset < 5; offset++) {
    const kept = source.places.filter((_, i) => i % 5 !== offset);
    const variant = await areaSignature({ ...source.manifest, version: `${source.manifest.version}:holdout:${offset}`, catalog: kept }, { ...source.area, venueIds: kept.map(p => p.id) }, { enrich: false });
    console.log(JSON.stringify({ offset, quality: variant.quality, categories: variant.categoryCounts, full: signatureSimilarity(variant, source, reference, "style_music_v1"), style: signatureSimilarity(variant, source, reference, "style_only_v1") }));
  }
}
capture.restore();
