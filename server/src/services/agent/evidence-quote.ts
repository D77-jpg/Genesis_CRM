import type {EvidenceQuote} from './fact-verifier';

// Locate model excerpts without trusting model offset arithmetic. Layout,
// letter case, punctuation and width variants may differ; words and digits must
// still match exactly (no paraphrase). The returned quote is always the ORIGINAL
// source substring in Unicode points.
export function resolveEvidenceQuote(quote:EvidenceQuote,source:string):EvidenceQuote|undefined{
 if(!quote.quote.trim())return undefined;
 const points=Array.from(source);
 if(points.slice(quote.start,quote.end).join('')===quote.quote)return {...quote};
 const exact=source.indexOf(quote.quote);
 if(exact>=0){
  if(source.indexOf(quote.quote,exact+1)>=0)return undefined;
  const start=Array.from(source.slice(0,exact)).length;
  return {...quote,start,end:start+Array.from(quote.quote).length};
 }
 // Fold whitespace, case, punctuation and full-width forms. Every folded char keeps
 // its own code-point index, so a match still maps back to an exact source span.
 function folded(value:string){
  const chars:string[]=[],starts:number[]=[],ends:number[]=[];
  Array.from(value).forEach((char,i)=>{
   const normalized=char.normalize('NFKC').toLowerCase();
   if(normalized.length!==1||!/[\p{L}\p{N}]/u.test(normalized))return;
   chars.push(normalized);starts.push(i);ends.push(i+1);
  });
  return {chars,starts,ends};
 }
 const hay=folded(source),needle=folded(quote.quote).chars;
 if(!needle.length)return undefined;
 const hayText=hay.chars.join(''),needleText=needle.join('');
 const position=hayText.indexOf(needleText);
 if(position<0||hayText.indexOf(needleText,position+1)>=0)return undefined;
 const start=hay.starts[position],end=hay.ends[position+needle.length-1];
 return {...quote,quote:points.slice(start,end).join(''),start,end};
}
