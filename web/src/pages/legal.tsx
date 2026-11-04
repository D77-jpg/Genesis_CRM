import * as React from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, ShieldCheck } from 'lucide-react';
import { PublicLayout } from '@/components/public/public-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LEGAL_DOCUMENTS, type LegalDocId } from '@/content/legal';
import { useI18n } from '@/i18n';

const COPY = {
  zh: {
    updated: '生效日期',
    version: '版本 1.0',
    summary: '本文本适用于 Genesis CRM 上市准备，正式签约前需经法务复核。',
    related: '其他法律文件',
    back: '返回首页',
  },
  en: {
    updated: 'Effective',
    version: 'Version 1.0',
    summary: 'Launch-readiness text for Genesis CRM. Counsel review is required before execution.',
    related: 'Other legal documents',
    back: 'Back to home',
  },
} as const;

const ORDER: LegalDocId[] = ['terms', 'privacy', 'dpa', 'sla'];

export function LegalPage({ doc }: { doc: LegalDocId }): React.JSX.Element {
  const { language } = useI18n();
  const copy = COPY[language];
  const document = LEGAL_DOCUMENTS[doc];
  return (
    <PublicLayout title={document.title[language]} description={document.summary[language]}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
        <article>
          <div className="mb-6 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary" className="gap-1.5"><FileText className="h-3.5 w-3.5" />{copy.version}</Badge>
            <span>{copy.updated}: {document.updated}</span>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            <span className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{copy.summary}</span>
          </div>
          <div className="mt-6 text-[15px] leading-7 text-foreground/90 [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:my-1.5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_strong]:font-semibold [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.body[language]}</ReactMarkdown>
          </div>
        </article>
        <aside className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">{copy.related}</p>
            <div className="mt-3 space-y-2">
              {ORDER.filter((id) => id !== doc).map((id) => (
                <Link key={id} className="block text-sm leading-5 text-muted-foreground hover:text-foreground" to={`/legal/${id}`}>{LEGAL_DOCUMENTS[id].title[language]}</Link>
              ))}
            </div>
          </div>
          <Button asChild variant="outline" className="w-full"><Link to="/">{copy.back}</Link></Button>
        </aside>
      </div>
    </PublicLayout>
  );
}

export default LegalPage;
