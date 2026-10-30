import { loadEnvFile } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExploreState, activeLoves, type ResolvedLove } from "../../src/shared/contracts";
import { cityManifest } from "../../src/server/engine/09/manifest";
import { cityCenter } from "../../src/server/engine/city";
import { nativeCells, scorePerson, rankingSignalValues } from "../../src/server/engine/09/ranking";
import { qlooRead, resultRows } from "../../src/server/qloo/client";
import { median, mean, percentileRanks } from "../../src/server/engine/geo";
import { withQlooBudget } from "../../src/server/qloo/budget";
import { installPrivateCapture } from "../qloo/private-capture-09";
loadEnvFile(".env.local");
const capture=installPrivateCapture(true),profiles=JSON.parse(readFileSync(join(capture.directory,"profiles.json"),"utf8")) as {name:string;loves:ResolvedLove[]}[];
const report=[];
for(const city of ["Berlin","Lisbon"]){
 const {value:manifest}=await withQlooBudget(96,()=>cityManifest(city)),center=await cityCenter(city);
 for(const profile of profiles){
  const signals=await withQlooBudget(32,()=>Promise.all(activeLoves(ExploreState.parse({city,loves:profile.loves}).loves).map(async love=>{
   const read=await qlooRead("/v2/insights",{"filter.type":"urn:heatmap","filter.location":`POINT(${center[0]} ${center[1]})`,"filter.location.radius":15000,"signal.interests.entities":love.chosen.id,take:50});
   const cells=nativeCells(resultRows(read.value,"heatmap"),manifest.center,manifest.radiusM),values=rankingSignalValues(cells);
   return {cells,ranks:new Map(cells.map((c,i)=>[c.h,values[i]])),entityId:love.chosen.id,status:"ok" as const,evidence:[],query:love.query,domain:love.chosen.domain,weight:love.weight};
  })));
  const variants=Object.fromEntries(["native-full", "native-block", "native-discovery", "coarse-full", "coarse-block"].map(method=>{
   const adjusted=signals.map(signal=>{
    if(!method.startsWith("coarse"))return signal;
    const groups=new Map<string,typeof signal.cells>();for(const c of signal.cells){const group=groups.get(c.h.slice(0,6))??[];group.push(c);groups.set(c.h.slice(0,6),group);}
    const coarse=[...groups].map(([h,cells])=>({h,a:mean(cells.map(c=>c.affinity)),p:mean(cells.map(c=>c.popularity))}));
    const prior=Math.max(.02,median(coarse.map(c=>c.p))),ranks=percentileRanks(coarse.map(c=>(c.a+prior)/(c.p+prior)));
    const map=new Map(coarse.map((c,i)=>[c.h,ranks[i]]));return {...signal,ranks:new Map(signal.cells.map(c=>[c.h,map.get(c.h.slice(0,6))!]))};
   });
   return [method,manifest.areas.map(area=>{
    const support=scorePerson(area,adjusted).support;
    if(method.endsWith("full"))return {name:area.identity.name,score:scorePerson(area,adjusted).score,support:support.quality};
    const value=mean(adjusted.map(signal=>{const local=area.cells.filter(c=>signal.ranks.has(c.h)),total=local.reduce((s,c)=>s+c.areaM2,0),blocks=new Set(local.map(c=>c.block)).size,reliability=blocks/(blocks+3);const popular=new Map(signal.cells.map(c=>[c.h,c.popularity]));return total?local.reduce((s,c)=>s+c.areaM2*(.5+reliability*(signal.ranks.get(c.h)!-.5))*(method.includes("discovery")?1-.7*.35*popular.get(c.h)!:1),0)/total:.5;}));
    return {name:area.identity.name,score:value,support:support.quality};
   }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))];
  }));
  report.push({city,profile:profile.name,variants});console.log(JSON.stringify({city,profile:profile.name,top3:Object.fromEntries(Object.entries(variants).map(([m,r])=>[m,r.slice(0,3).map(a=>a.name)]))}));
 }
}
writeFileSync(join(capture.directory,"d003-window-probe.json"),JSON.stringify({report,capture:capture.counts()},null,2));capture.restore();
