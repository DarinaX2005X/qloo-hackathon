import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { encodeGeohash, geohashBounds } from "../../src/server/engine/09/geometry";
import { loadLoveMaps, baselineSeries } from "../../src/server/engine/field";
import { cityCenter } from "../../src/server/engine/city";
import { haversine, mean } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";

loadEnvFile(".env.local");
const capture = installPrivateCapture(true);
const profiles = JSON.parse(readFileSync(join(capture.directory, "profiles.json"), "utf8")) as { name: string; loves: ResolvedLove[] }[];
const reports: unknown[] = [];
for (const city of ["Berlin", "Lisbon"]) {
  const [{ value: manifest }, oldCenter] = await withQlooBudget(96, () => Promise.all([cityManifest(city), cityCenter(city)]));
  console.log(JSON.stringify({ city, manifestCenter: manifest.center, legacyCenter: oldCenter, areas: manifest.areas.map(a=>({name:a.identity.name,center:a.identity.center})) }));
  const outputs: { variants: Record<string, { name: string; score: number }[]> }[] = [];
  for (const profile of profiles) {
    const maps = await withQlooBudget(24, () => loadLoveMaps(city, ExploreState.parse({ city, loves: profile.loves }).loves));
    const combined = [...new Map(maps.flatMap(m=>m.cells).map(c=>[c.h,c])).values()].map(c=>{
      const b=geohashBounds(c.h)!, points=process.argv.includes("--neutral-centroids")?manifest.catalog.filter(p=>encodeGeohash([p.lon,p.lat],6)===c.h):[];
      return {...c,lon:points.length?mean(points.map(p=>p.lon)):(b[0]+b[2])/2,lat:points.length?mean(points.map(p=>p.lat)):(b[1]+b[3])/2};
    }).filter(c=>haversine(manifest.center,[c.lon,c.lat])<=manifest.radiusM);
    const retained = new Set(combined.map(c=>c.h));
    const series = maps.map(m=>({ ...m, values:baselineSeries(m.cells,retained).ranks }));
    const coarse = combined.map(c=>({ ...c,
      ...(process.argv.includes("--symmetric")?{popularity:mean(maps.flatMap(m=>m.cells.filter(v=>v.h===c.h).map(v=>v.popularity)))}:{}),
      score:mean(series.map(s=>s.values.get(c.h)??0)) }));
    const variants = Object.fromEntries(["circle-native-intersection","circle-coarse-centers","fixed-nearest-1600"].map(method=>{
      const nearest = new Map(coarse.map(c=>[c.h,manifest.areas.map(a=>({id:a.identity.id,d:haversine(a.identity.center,[c.lon,c.lat])})).filter(a=>a.d<=1600).sort((a,b)=>a.d-b.d||a.id.localeCompare(b.id))[0]?.id]));
      return [method, manifest.areas.map(area=>{
        const local = coarse.flatMap(c=>{
          const weight = method === "circle-native-intersection" ? area.cells.filter(a=>a.h.startsWith(c.h)).reduce((s,a)=>s+a.areaM2,0) : method === "circle-coarse-centers" ? Number(haversine(area.identity.center,[c.lon,c.lat])<=650) : Number(nearest.get(c.h)===area.identity.id);
          return weight ? [{...c,weight}]:[];
        });
        const n=local.length, total=local.reduce((s,c)=>s+c.weight,0), reliability=n/(n+3);
        const score=total ? local.reduce((s,c)=>s+c.weight*(reliability*c.score+(1-reliability)*.5)*(1-.7*.35*c.popularity),0)/total:0;
        return {name:area.identity.name,score,n};
      }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))];
    }));
    const result = {city,profile:profile.name,variants}; outputs.push(result); reports.push(result);
    console.log(JSON.stringify({city,profile:profile.name,top3:Object.fromEntries(Object.entries(variants).map(([method,rows])=>[method,rows.slice(0,3)]))}));
  }
  console.log(JSON.stringify({city,winners:Object.fromEntries(Object.keys(outputs[0].variants).map(method=>[method,outputs.reduce((counts,row)=>{const name=row.variants[method][0].name;counts[name]=(counts[name]??0)+1;return counts;},{} as Record<string,number>)]))}));
}
writeFileSync(join(capture.directory,process.argv.includes("--symmetric")?"d003-symmetric-context-probe.json":process.argv.includes("--neutral-centroids")?"d003-neutral-centroid-probe.json":"d003-fixed-centroid-probe.json"),JSON.stringify({at:new Date().toISOString(),reports,capture:capture.counts()},null,2));
console.log(JSON.stringify({capture:capture.counts()}));
capture.restore();
