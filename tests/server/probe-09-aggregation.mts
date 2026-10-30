import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { weightedSignals, scorePerson } from "../../src/server/engine/09/ranking";
import { median, mean, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
loadEnvFile(".env.local");
const capture = installPrivateCapture(true);
const profiles = JSON.parse(readFileSync(join(capture.directory,"profiles.json"),"utf8")) as {name:string;loves:ResolvedLove[]}[];
// Predeclared alternatives: retain magnitudes, rank area means once per love,
// and separate data support from taste; all retain the same 650 m geometry.
const methods=["log-ratio", "mean-ratio", "area-borda", "reliable-area-borda"];
const report=[];
for(const city of ["Berlin","Lisbon"]){
 const {value:manifest}=await withQlooBudget(96,()=>cityManifest(city));
 for(const profile of profiles){
  const signals=await withQlooBudget(24,()=>weightedSignals(manifest,ExploreState.parse({city,loves:profile.loves}).loves));
  const variants=Object.fromEntries(methods.map(method=>{
   const bySignal=signals.map(signal=>{
    const prior=Math.max(.02,median(signal.cells.map(c=>c.popularity)));
    const typical=median(signal.cells.map(c=>(c.affinity+prior)/(c.popularity+prior)));
    const values=new Map(signal.cells.map(c=>[c.h,method==="log-ratio" ? Math.log((c.affinity+prior)/(c.popularity+prior)/typical) : method==="mean-ratio" ? (c.affinity+prior)/(c.popularity+prior)/typical-1 : signal.ranks.get(c.h)!]));
    const scores=manifest.areas.map(area=>{
     const local=area.cells.filter(c=>values.has(c.h));
     const total=local.reduce((s,c)=>s+c.areaM2,0), blocks=new Set(local.map(c=>c.block)).size;
     const center=method.includes("borda")?.5:0;
     const value=total?local.reduce((s,c)=>s+c.areaM2*values.get(c.h)!,0)/total:center;
     const reliability=blocks/(blocks+3);
     return method==="area-borda"?value:center+reliability*(value-center);
    });
    return method.includes("borda")?percentileRanks(scores):scores;
   });
   return [method,manifest.areas.map((area,i)=>({name:area.identity.name,score:mean(bySignal.map(s=>s[i])),support:scorePerson(area,signals).support.quality})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))];
  }));
  report.push({city,profile:profile.name,variants});
  console.log(JSON.stringify({city,profile:profile.name,top3:Object.fromEntries(Object.entries(variants).map(([m,r])=>[m,r.slice(0,3)]))}));
 }
}
writeFileSync(join(capture.directory,"d003-aggregation-probe.json"),JSON.stringify({report,capture:capture.counts()},null,2));
capture.restore();
