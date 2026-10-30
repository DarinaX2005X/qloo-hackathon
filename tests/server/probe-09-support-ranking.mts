import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { weightedSignals } from "../../src/server/engine/09/ranking";
import { mean, median, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
loadEnvFile(".env.local");
const capture=installPrivateCapture(true),profiles=JSON.parse(readFileSync(join(capture.directory,"profiles.json"),"utf8")) as {name:string;loves:ResolvedLove[]}[];
const report=[];
// Diagnose the other stage-08 difference: missing weight was zero evidence,
// rather than a neutral rank. This is a heuristic, never an affinity probability.
for(const city of ["Berlin","Lisbon"]){
 const {value:manifest}=await withQlooBudget(96,()=>cityManifest(city));
 for(const profile of profiles){
  const signals=await withQlooBudget(24,()=>weightedSignals(manifest,ExploreState.parse({city,loves:profile.loves}).loves));
  const variants=Object.fromEntries(["native-union","coarse-union","native-surveyed","coarse-surveyed"].map(method=>{
   const adjusted=signals.map(signal=>{
    if(!method.startsWith("coarse"))return signal.ranks;
    const groups=new Map<string,typeof signal.cells>();for(const c of signal.cells){const key=c.h.slice(0,6),g=groups.get(key)??[];g.push(c);groups.set(key,g);}
    const coarse=[...groups].map(([h,c])=>({h,a:mean(c.map(x=>x.affinity)),p:mean(c.map(x=>x.popularity))}));
    const prior=Math.max(.02,median(coarse.map(c=>c.p))),ranks=percentileRanks(coarse.map(c=>(c.a+prior)/(c.p+prior)));
    return new Map(coarse.map((c,i)=>[c.h,ranks[i]]));
   });
   const union=new Set(adjusted.flatMap(m=>[...m.keys()]));
   return [method,manifest.areas.map(area=>{
    const cells=area.cells.map(c=>({...c,key:method.startsWith("coarse")?c.h.slice(0,6):c.h})).filter(c=>method.endsWith("surveyed")||union.has(c.key));
    const total=cells.reduce((s,c)=>s+c.areaM2,0);
    const score=total?cells.reduce((sum,c)=>sum+c.areaM2*mean(adjusted.map(s=>s.get(c.key)??0)),0)/total:0;
    return {name:area.identity.name,score};
   }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))];
  }));
  report.push({city,profile:profile.name,variants});console.log(JSON.stringify({city,profile:profile.name,top3:Object.fromEntries(Object.entries(variants).map(([m,r])=>[m,r.slice(0,3).map(a=>a.name)]))}));
 }
}
writeFileSync(join(capture.directory,"d003-support-ranking-probe.json"),JSON.stringify({report,capture:capture.counts()},null,2));capture.restore();
