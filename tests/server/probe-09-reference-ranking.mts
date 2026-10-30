import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { nativeCells, weightedSignals, scorePerson } from "../../src/server/engine/09/ranking";
import { qlooRead, resultRows, string } from "../../src/server/qloo/client";
import { mean, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
loadEnvFile(".env.local");
const capture=installPrivateCapture(true),profiles=JSON.parse(readFileSync(join(capture.directory,"profiles.json"),"utf8")) as {name:string;loves:ResolvedLove[]}[];
// Fixed cross-genre reference, equal weights, no coefficients fitted to cities or profiles.
const names=["pop","rock","electronic","jazz","classical","hip hop"];
const tags=await withQlooBudget(16,()=>Promise.all(names.map(async name=>{
 const rows=resultRows((await qlooRead("/v2/tags",{"filter.query":name,"filter.tag.types":"urn:tag:genre:music",take:10})).value,"tags");
 const row=rows.find(row=>(string(row.tag_id)||string(row.id))===`urn:tag:genre:music:${name.replace(/ /g,"_")}`)||rows.find(row=>string(row.name)?.toLowerCase()===name)||rows.find(row=>string(row.name)?.toLowerCase().replace(/-/g," ")===name);
 if(!row)throw new Error(`Missing exact reference tag ${name}`);return {name,id:string(row.id)||string(row.tag_id)};
})));
console.log(JSON.stringify({tags}));const report=[];
for(const city of ["Berlin","Lisbon"]){
 const {value:manifest}=await withQlooBudget(96,()=>cityManifest(city));
 const refs=await withQlooBudget(16,()=>Promise.all(tags.map(async tag=>{
  const rows=resultRows((await qlooRead("/v2/insights",{"filter.type":"urn:heatmap","filter.location":`POINT(${manifest.center[0]} ${manifest.center[1]})`,"filter.location.radius":manifest.radiusM,"signal.interests.tags":tag.id,take:50})).value,"heatmap");
  const cells=nativeCells(rows,manifest.center,manifest.radiusM);return cells;
 })));
 const references=Object.fromEntries(["native","heuristic"].map(mode=>{
  const maps=refs.map(cells=>{const ranks=percentileRanks(cells.map(c=>mode==="native"?c.value:(c.affinity+.5)/(c.popularity+.5)));return new Map(cells.map((c,i)=>[c.h,ranks[i]]));});
  const ids=[...new Set(refs.flat().map(c=>c.h))];return [mode,new Map(ids.flatMap(h=>{const v=maps.flatMap(m=>m.has(h)?[m.get(h)!]:[]);return v.length>=3?[[h,mean(v)] as const]:[];}))];
 }));
 for(const profile of profiles){
  const signals=await withQlooBudget(24,()=>weightedSignals(manifest,ExploreState.parse({city,loves:profile.loves}).loves));
  const variants=Object.fromEntries(["native","heuristic"].map(mode=>{
   const adjusted=signals.map(signal=>{
    const u=mode==="native"?percentileRanks(signal.cells.map(c=>c.value)):signal.cells.map(c=>signal.ranks.get(c.h)!);
    const cells=signal.cells.flatMap((c,i)=>references[mode].has(c.h)?[{...c,residual:u[i]-references[mode].get(c.h)!}]:[]);
    const ranks=percentileRanks(cells.map(c=>c.residual));return {...signal,cells,ranks:new Map(cells.map((c,i)=>[c.h,ranks[i]]))};
   });
   return [mode,manifest.areas.map(area=>({name:area.identity.name,...scorePerson(area,adjusted)})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))];
  }));
  report.push({city,profile:profile.name,variants});console.log(JSON.stringify({city,profile:profile.name,top3:Object.fromEntries(Object.entries(variants).map(([m,r])=>[m,r.slice(0,3).map(a=>({name:a.name,score:a.score}))]))}));
 }
}
writeFileSync(join(capture.directory,"d003-reference-ranking-probe.json"),JSON.stringify({tags,report,capture:capture.counts()},null,2));capture.restore();
