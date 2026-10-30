import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { appendFileSync } from 'node:fs';
import { profile, profiles } from './profiles-08';
import { buildField } from '../../src/server/engine/field';
import { rankNeighborhoods } from '../../src/server/engine/neighborhoods';
import { clearQlooCache } from '../../src/server/qloo/client';
import { clearEvidenceCache } from '../../src/server/engine/evidence';
import { clearGeocodeCache } from '../../src/server/geo/geocode';
import { findHome } from '../../src/server/engine/home';
import { checkSpot } from '../../src/server/engine/spot';
import { whatDecides } from '../../src/server/engine/decides';
import { solvePlan } from '../../src/server/engine/plan';
import { runAgent } from '../../src/server/agent/runner';
import { searchTastePlaces } from '../../src/server/engine/places';
import { compareCities } from '../../src/server/engine/cities';
import { searchEntities } from '../../src/server/qloo/search';
import type { AgentEvent } from '../../src/shared/contracts';
loadEnvFile('.env.local');
const report = 'C:/Users/user/Desktop/qloo/tasks/08-engine.out.md';
function log(s: string) { console.log(s); if(process.argv.includes('--report')) appendFileSync(report,s+'\n'); }
async function measured<T>(name:string, run:()=>Promise<T>, summary:(x:T)=>unknown) {
 clearQlooCache();clearEvidenceCache();clearGeocodeCache();
 for(const temperature of ['cold','warm']) {
  const start=performance.now();
  const value=await run();log(`${name} ${temperature}: ${((performance.now()-start)/1000).toFixed(2)}s`);
  if(temperature==='cold') log(JSON.stringify(summary(value)));
 }
}
const state=await profile('Lisbon',profiles[5].tastes);
log('\n## Feature checks and cold/warm timings\n');
if(!process.argv.includes('--agent-only')) {
 if(process.argv.includes('--include-only')) {
  const ns=await rankNeighborhoods(state);
  const chosen=(await searchEntities('Pastéis de Belém','place')).find(p=>/Belém/.test(p.name));
  assert(chosen,'Must include venue resolves');
  const plan=await solvePlan({...state,days:1},[ns[0].id],{include:[chosen.id],excludeTags:['museum']});
  log(JSON.stringify({mustInclude:chosen.name,days:plan.days.map(d=>({stops:d.stops.map(s=>s.place.name),missing:d.missing,note:d.note}))}));
  assert(plan.days.flatMap(d=>d.stops).some(s=>s.place.id===chosen.id),'Must include venue should be scheduled');
  process.exit(0);
 }
 await measured('field',()=>buildField(state),x=>({cells:x.cells.length,sparse:x.sparse}));
 await measured('neighborhoods',()=>rankNeighborhoods(state),x=>x.slice(0,3).map(n=>({name:n.name,score:n.score,lift:n.lift,crowd:n.crowd})));
 await measured('home',()=>findHome({state:{...state,city:'Reykjavik'},source:{city:'Berlin',neighborhood:'Kreuzberg'},blend:0}),x=>{
  assert(x.matches.every(m=>m.similarity<80),'Kreuzberg to Reykjavik must allow a low match');
  assert(x.matches.every(m=>m.twins.every(t=>t.source.tags.some(s=>t.target.tags.includes(s)))),'Twin has a meaningful shared tag');
  return {source:x.source.tags,matches:x.matches.map(m=>({...m,name:x.neighborhoods.find(n=>n.id===m.neighborhoodId)?.name}))};
 });
 await measured('spot',()=>checkSpot({state,query:'Rua da Rosa 120'}),x=>({label:x.label,percentile:x.percentile,resolutionM:x.resolutionM,walkIsApproximate:x.walkIsApproximate,verdict:x.verdict}));
 await measured('decides',()=>whatDecides(state),x=>x);
 const neighborhoods=await rankNeighborhoods(state);
 await measured('plan',()=>solvePlan({...state,days:2},neighborhoods.slice(0,2).map(n=>n.id),{excludeTags:['museum']}),x=>{
  assert(x.days.every(d=>d.stops.length||d.note),'No empty day without note');
  assert(x.days.flatMap(d=>d.stops).every(s=>!s.place.tags?.some(t=>/museum/i.test(t.name))),'No museums');
  return x.days.map(d=>({neighborhood:d.neighborhood,note:d.note,missing:d.missing,stops:d.stops.map(s=>({time:s.time,name:s.place.name,walk:s.walkMin,reasons:s.reasonCodes}))}));
 });
 for(const city of ['x','ab','Eiffel Tower']) {
  await assert.rejects(()=>compareCities(state,[city]),e=>(e as {error?:{code:string}}).error?.code==='not_found');log(`Rejected city ${city}: not_found`);
 }
 const techno=await profile('Berlin',profiles[0].tastes);
 const dance=await searchTastePlaces(techno,'dance');assert(dance.length,'Live dance search must find clubs');
 assert(dance.every(p=>!p.tags?.some(t=>/hotel/i.test(t.name))),'No hotel bars');log(`Dance: ${dance.slice(0,5).map(p=>`${p.name} (${p.affinity.toFixed(3)})`).join(' | ')}`);
}
await measured('agent chain',async()=>{
 const events:AgentEvent[]=[];
 await runAgent({state,message:'I used to live in Kreuzberg; find me the closest area here, check Rua da Rosa 120 there and plan two days without museums',history:[]},e=>events.push(e));
 if(!events.some(e=>e.type==='card'&&e.card.kind==='plan')) log(`INCOMPLETE agent evidence: ${JSON.stringify(events)}`);
 assert(events.some(e=>e.type==='card'&&e.card.kind==='plan'),'Agent must build a plan');
 const tools=events.flatMap(e=>e.type==='trace'?[e.tool]:[]);
 for(const name of ['find_home','select_home_match','check_address','plan_trip']) assert(tools.includes(name),`Missing chain step ${name}`);
 return events;
},events=>events.filter(e=>e.type==='trace'||e.type==='delta'||e.type==='error').concat(events.flatMap(e=>e.type==='card'?[{type:'trace' as const,tool:`card:${e.card.kind}`,summary:'returned'}]:[])));
