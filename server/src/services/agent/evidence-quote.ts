import type {EvidenceQuote} from './fact-verifier';

// Locate model excerpts without trusting model offset arithmetic. Only whitespace
// layout may differ; words, punctuation, digits and case must match exactly.
// The returned quote is always the ORIGINAL source substring in Unicode points.
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
 function folded(value:string){
  const chars:string[]=[],starts:number[]=[],ends:number[]=[];
  Array.from(value).forEach((char,i)=>{
   if(/\s/u.test(char)){
    if(chars.at(-1)===' '){ends[ends.length-1]=i+1;return;}
    char=' ';
   }
   chars.push(char);starts.push(i);ends.push(i+1);
  });
  return {chars,starts,ends};
 }
 const hay=folded(source),needle=folded(quote.quote.trim()).chars;
 if(!needle.length)return undefined;
 const hayText=hay.chars.join(''),needleText=needle.join('');
 const position=hayText.indexOf(needleText);
 if(position<0||hayText.indexOf(needleText,position+1)>=0)return undefined;
 const first=Array.from(hayText.slice(0,position)).length;
 const start=hay.starts[first],end=hay.ends[first+needle.length-1];
 return {...quote,quote:points.slice(start,end).join(''),start,end};
}
