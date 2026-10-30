import { loadEnvFile } from 'node:process';
import { writeFileSync, appendFileSync } from 'node:fs';
import { profiles, profile } from './profiles-08';
import { cityPlaces, popularityNeighborhoods } from '../../src/server/engine/evidence';
import { normalizedAreaName, rankNeighborhoods } from '../../src/server/engine/neighborhoods';
import { chat } from '../../src/server/agent/llm';
import type { ExploreState } from '../../src/shared/contracts';

loadEnvFile('.env.local');
const output='C:/Users/user/Desktop/qloo/tasks/08-evidence.md';
writeFileSync(output,`# Homing: five predeclared comparisons\n\nRun: ${new Date().toISOString()}. Model: ${process.env.LLM_MODEL || 'google/gemini-3.8-flash'} (same configuration as the agent). These are technical comparisons, not human preference validation or proof of superiority. All five cases are retained.\n\nPopularity baseline: unsignalled Qloo place insights within the same city radius, grouped by returned neighborhood, at least three distinct places; order by mean venue popularity (no taste, no count bonus). Homing: full weighted taste engine with default crowd dial. LLM: the same fixed question, without Qloo, tools, or supplied neighborhoods.\n`);
const cases=[
 {name:'Techno fan → Berlin',city:'Berlin',p:0},
 {name:'Indie/outdoors → Lisbon',city:'Lisbon',p:5},
 {name:'Metal/sport → Lisbon',city:'Lisbon',p:4},
 {name:'Reader → Tokyo',city:'Tokyo',p:1},
 {name:'Different-taste couple → Berlin',city:'Berlin',p:0,partner:3},
];
function append(s:string){appendFileSync(output,s+'\n');}
async function popularity(state:ExploreState){
 const rows=await cityPlaces({...state,loves:[],refinements:[],companion:null});
 return popularityNeighborhoods(rows,state.city);
}
for(const c of cases){
 const state=await profile(c.city,profiles[c.p].tastes);
 if(c.partner!==undefined) state.companion={loves:(await profile(c.city,profiles[c.partner].tastes)).loves};
 const loves=state.loves.map(l=>l.chosen!.name).join(', ');
 const partner=state.companion?` My partner loves ${state.companion.loves.map(l=>l.chosen!.name).join(', ')}; account for both of us.`:'';
 const prompt=`I love ${loves} and I'm moving to ${c.city}. Which 3 neighborhoods should I live in and why?${partner}`;
 const started=performance.now();
 const [llm,baseline,homing]=await Promise.all([
  chat({messages:[{role:'system',content:'Answer in three numbered items, no more than 200 words total. Give one short reason for each neighborhood.'},{role:'user',content:prompt}],max_tokens:2500})
    .then(r=>r.content).catch((error: unknown)=>{ console.log(`LLM failure for ${c.name}: ${error instanceof Error ? error.message : 'request failed'}`); return 'The LLM request failed; no substitute answer was generated.'; }),
  popularity(state),rankNeighborhoods(state),
 ]);
 const evidence=homing.slice(0,3).map(n=>`${n.rank}. **${n.name}** — ordering score ${n.score.toFixed(4)}; measured taste lift ${((n.lift??0)*100).toFixed(1)}%. Drivers: ${n.drivers.slice(0,3).map(d=>`${d.love} ${(d.share*100).toFixed(0)}%`).join(', ') || 'none'}. Shared place tags: ${n.matchedTags.join(', ')||'none'}.`).join('\n');
 const overlap=homing.slice(0,3).filter(n=>baseline.some(b=>normalizedAreaName(b.name)===normalizedAreaName(n.name))).map(n=>n.name);
 const llmNames=[...llm.matchAll(/\*\*([^*]+)\*\*/g)].slice(0,3).map(m=>m[1].replace(/:\s*$/, ''));
 append(`\n### ${c.name}: side-by-side top three\n\n| LLM only | Popularity only | Homing |\n| --- | --- | --- |\n${Array.from({length:3},(_,i)=>`| ${llmNames[i]??'See answer below'} | ${baseline[i]?.name??'—'} | ${homing[i]?.name??'—'} |`).join('\n')}\n`);
 append(`\n## ${c.name}\n\nPrompt: ${prompt}\n\n### A. LLM only\n\n${llm}\n\n### B. Qloo popularity only\n\n${baseline.map((n,i)=>`${i+1}. ${n.name} — mean popularity ${n.score.toFixed(4)}`).join('\n')}\n\n### C. Homing\n\n${evidence}\n\nExact-name top-three overlap with popularity: ${overlap.length}/3${overlap.length?` (${overlap.join(', ')})`:''}. This measures difference, not correctness. Elapsed for the parallel comparison: ${((performance.now()-started)/1000).toFixed(2)}s.\n`);
 console.log(`${c.name}: popularity=${baseline.map(n=>n.name).join(', ')}; Homing=${homing.slice(0,3).map(n=>n.name).join(', ')}`);
}
append('\n## Interpretation limits\n\nThe five outputs above are the complete predeclared set. Neighborhood aliases may make exact-name overlap undercount agreement. The LLM offers broad cultural knowledge and can be more plausible than a statistically unusual Qloo result; no automatic correctness score is assigned. Homing adds reproducible individual weights, explicit population correction, per-love drivers and queryable places. Those features make its reasoning inspectable; these five cases alone do not establish that people would prefer its recommendations. Sparse Qloo coverage, proxy neighborhood centers and small lift differences remain material limitations.\n');
console.log(`Wrote ${output}`);
