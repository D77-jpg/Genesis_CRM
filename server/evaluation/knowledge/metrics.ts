export interface Observation {id:string;split:string;language:string;crossLanguage:boolean;category:string;expected:string;observed:string;required:string[];rankedEvidence:string[][];durationMs:number;forbiddenHits:string[];error?:string;rawStatus?:string;issueCodes?:string[]}
export function retrievalScore(required:string[],ranked:string[][],k=10){
 if(!required.length)return null;
 const expected=new Set(required),found=new Set(ranked.slice(0,k).flat().filter(id=>expected.has(id)));
 const first=ranked.slice(0,k).findIndex(ids=>ids.some(id=>expected.has(id)));
 return {recall:found.size/expected.size,reciprocalRank:first<0?0:1/(first+1)};
}
export function summarize(rows:Observation[]){
 const ranked=rows.flatMap(row=>{const score=retrievalScore(row.required,row.rankedEvidence);return score?[score]:[];});
 const negatives=rows.filter(row=>row.expected!=='answerable');
 const durations=rows.map(row=>row.durationMs).sort((a,b)=>a-b);
 const mean=(numbers:number[])=>numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:null;
 return {cases:rows.length,answerable:ranked.length,negative:negatives.length,recallAt10:mean(ranked.map(x=>x.recall)),mrrAt10:mean(ranked.map(x=>x.reciprocalRank)),
  classificationAccuracy:mean(rows.map(row=>Number(row.expected===row.observed))),negativeStateAccuracy:mean(negatives.map(row=>Number(row.expected===row.observed))),forbiddenHits:rows.reduce((n,r)=>n+r.forbiddenHits.length,0),
  latencyMs:{p50:durations.length?durations[Math.ceil(durations.length*.5)-1]:null,p95:durations.length?durations[Math.ceil(durations.length*.95)-1]:null,max:durations.at(-1)??null},unexpectedErrors:rows.filter(r=>r.error&&!['forbidden','retrieval_failed'].includes(r.expected)).map(r=>r.id)};
}
export function grouped(rows:Observation[],key:(row:Observation)=>string){return Object.fromEntries([...new Set(rows.map(key))].sort().map(group=>[group,summarize(rows.filter(row=>key(row)===group))]));}
