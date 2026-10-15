/** Business-facing descriptions; internal codes remain available only in expanded support details. */
export function agentFailureLabel(code: string): string {
 if (/TIMEOUT|ABORT/.test(code)) return 'AI 响应超时，请稍后重试。';
 if (/NOT_CONFIGURED/.test(code)) return 'AI 服务尚未启用，请联系管理员完成配置。';
 if (/INVALID|INCOMPLETE|UNVERIFIED/.test(code)) return 'AI 返回的内容不完整，请核对后重试。';
 if (/RATE_LIMIT|QUOTA|BUDGET/.test(code)) return '已达到本次或今日的使用上限，请稍后再试。';
 if (/UNAUTH|FORBIDDEN|NOT_FOUND/.test(code)) return '相关资料或访问权限已变化，请重新打开后重试。';
 if (/MARKETING_BLOCKED/.test(code)) return '客户已要求停止联系，后续营销任务已停止。';
 if (/AUTOMATION_REVOKED/.test(code)) return '自动准备规则或客户资料已变化，请重新确认任务。';
 return '本次处理未完成，请稍后重试或联系管理员。';
}
export function agentRunLabel(kind:string):string {
 return ({chat:'业务对话',scratchpad:'随手记整理',customer_analysis:'客户分析',mail_analysis:'邮件分析',evaluation:'功能检查'} as Record<string,string>)[kind] ?? '业务处理';
}
