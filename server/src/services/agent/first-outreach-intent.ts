/** Only an explicit user command enters this workflow; CRM/model content is never parsed here. */
export function isAnalysisOnlyRequest(text:string){return /(?:只做|仅做|仅作)(?:客户)?分析|(?:只|仅)分析[，。；,;：:]|(?:暂不|不)(?:写|生成|起草|准备).{0,8}(?:信|邮件|草稿)|\banalysis only\b|\b(?:do not|don't) (?:write|draft|prepare)\b/i.test(text);}
export function isFirstOutreachCommand(content: string): boolean {
  const text = content.trim();if(isAnalysisOnlyRequest(text))return false;
  if (/怎么|如何/.test(text) || /^(为什么|是否|可以吗|解释|介绍)|^能不能(?!帮我)/.test(text)) return false;
  if (/(不要|(?<!分)别|不用|不需要)(?!发送)[^，。；\n]{0,8}(写|生成|起草|准备)/.test(text)) return false;
  return /^(请|帮我|给我|给|为我|你帮我|麻烦|现在|先|找到|查找|搜索|定位|能不能帮我|可以帮我|写|生成|起草|准备)/.test(text)
    && /(写|生成|起草|准备).{0,40}(第一封|首封).{0,12}(开发信|开发邮件)/.test(text);
}
