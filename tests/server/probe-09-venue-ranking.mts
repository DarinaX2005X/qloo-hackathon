import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, activeLoves, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { pointInArea } from "../../src/server/engine/09/geometry";
import { signatureFamily } from "../../src/server/engine/09/signatures";
import { qlooRead, record, string, resultRows } from "../../src/server/qloo/client";
import { mean, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
loadEnvFile(".env.local");
const capture=installPrivateCapture(true),profiles=JSON.parse(readFileSync(join(capture.directory,"profiles.json"),"utf8")) as {name:string;loves:ResolvedLove[]}[];
const report=[];
for(const city of ["Berlin","Lisbon"]){
 const {value:manifest}=await withQlooBudget(96,()=>cityManifest(city));
 const selected=manifest.areas.map(area=>["coffee","food","nightlife","culture"].flatMap(f=>manifest.catalog.filter(p=>signatureFamily(p)===f&&pointInArea([p.lon,p.lat],area.identity)).sort((a,b)=>b.popularity-a.popularity||a.id.localeCompare(b.id)).slice(0,2)));
 const ids=[...new Set(selected.flat().map(p=>p.id))].sort(),cache=new Map<string,Map<string,number>>();
 for(const profile of profiles){
  const signals=await withQlooBudget(48,()=>Promise.all(activeLoves(ExploreState.parse({city,loves:profile.loves}).loves).map(async love=>{
   let values=cache.get(love.chosen.id);
   if(!values){
    const batches=[];for(let i=0;i<ids.length;i+=50)batches.push(ids.slice(i,i+50));
    const rows=(await Promise.all(batches.map(async batch=>resultRows((await qlooRead("/v2/insights",{"filter.type":"urn:entity:place","filter.results.entities":batch.join(","),"signal.interests.entities":love.chosen.id,take:50})).value,"entities")))).flat();
    values=new Map(rows.flatMap(row=>{const id=string(row.entity_id),v=record(row.query).affinity;return id&&typeof v==="number"?[[id,v] as const]:[];}));cache.set(love.chosen.id,values);
   }
   return {love,values};
  })));
  const variants=Object.fromEntries(["affinity","rank"].map(method=>{
   const scores=signals.map(signal=>{const raw=ids.map(id=>signal.values.get(id)??0),ranks=percentileRanks(raw),values=new Map(ids.map((id,i)=>[id,method==="rank"?ranks[i]:raw[i]]));return selected.map(places=>mean(["coffee","food","nightlife","culture"].flatMap(f=>{const local=places.filter(p=>signatureFamily(p)===f&&signal.values.has(p.id));return local.length?[mean(local.map(p=>values.get(p.id)!))]:[];})));});
   return [method,manifest.areas.map((area,i)=>({name:area.identity.name,score:mean(scores.map(s=>s[i])),places:selected[i].length})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))];
  }));
  report.push({city,profile:profile.name,variants});console.log(JSON.stringify({city,profile:profile.name,top3:Object.fromEntries(Object.entries(variants).map(([m,r])=>[m,r.slice(0,3)]))}));
 }
}
writeFileSync(join(capture.directory,"d003-venue-ranking-probe.json"),JSON.stringify({report,capture:capture.counts()},null,2));capture.restore();
