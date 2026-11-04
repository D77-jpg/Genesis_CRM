import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, BookOpen, Clock3, LifeBuoy, Search } from 'lucide-react';
import { PublicLayout } from '@/components/public/public-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { HELP_ARTICLES, HELP_CATEGORIES } from '@/content/help';
import { useI18n } from '@/i18n';

const COPY = {
  zh: {
    title: '帮助中心',
    subtitle: '从导入客户到发出第一封开发信，再到报价和团队管理，按步骤找到答案。',
    search: '搜索帮助文章…',
    noResults: '没有匹配的文章，试试更短的关键词。',
    all: '全部',
    minutes: '分钟阅读',
    contact: '没有找到答案？',
    contactDesc: '发邮件给支持团队，我们会在一个工作日内回复。',
    contactButton: '联系支持',
    back: '返回帮助中心',
    notFound: '文章不存在',
    notFoundDesc: '链接可能已更新，请回到帮助中心重新选择。',
    related: '相关文章',
    toc: '本页目录',
    read: '阅读文章',
  },
  en: {
    title: 'Help center',
    subtitle: 'Step-by-step answers from importing customers through your first outreach, quotes and team setup.',
    search: 'Search help articles…',
    noResults: 'No matching articles. Try a shorter keyword.',
    all: 'All',
    minutes: 'min read',
    contact: 'Still need help?',
    contactDesc: 'Email the support team and we will reply within one business day.',
    contactButton: 'Contact support',
    back: 'Back to help center',
    notFound: 'Article not found',
    notFoundDesc: 'The link may have changed. Please choose an article from the help center.',
    related: 'Related articles',
    toc: 'On this page',
    read: 'Read article',
  },
} as const;

function Markdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="text-[15px] leading-7 text-foreground/90 [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_li]:my-1.5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_strong]:font-semibold [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function HelpPage(): React.JSX.Element {
  const { language } = useI18n();
  const copy = COPY[language];
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<string>('all');
  const normalized = query.trim().toLowerCase();
  const filtered = HELP_ARTICLES.filter((article) => {
    if (category !== 'all' && article.category !== category) return false;
    if (!normalized) return true;
    return `${article.title.zh} ${article.title.en} ${article.summary.zh} ${article.summary.en}`.toLowerCase().includes(normalized);
  });

  return (
    <PublicLayout title={copy.title} description={copy.subtitle}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} className="pl-9" aria-label={copy.search} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={category === 'all' ? 'default' : 'outline'} onClick={() => setCategory('all')}>{copy.all}</Button>
          {HELP_CATEGORIES.map((item) => (
            <Button key={item.id} type="button" size="sm" variant={category === item.id ? 'default' : 'outline'} onClick={() => setCategory(item.id)}>{item.label[language]}</Button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((article) => (
          <Link key={article.slug} to={`/help/${article.slug}`} className="group rounded-xl border bg-card p-5 transition hover:border-primary/50 hover:shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary">{HELP_CATEGORIES.find((item) => item.id === article.category)?.label[language]}</Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{article.minutes} {copy.minutes}</span>
            </div>
            <h2 className="mt-4 font-semibold leading-6 group-hover:text-primary">{article.title[language]}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{article.summary[language]}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">{copy.read}<ArrowRight className="h-3.5 w-3.5" /></span>
          </Link>
        ))}
      </div>
      {!filtered.length ? <p className="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{copy.noResults}</p> : null}

      <Card className="mt-10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><LifeBuoy className="h-4 w-4" />{copy.contact}</CardTitle>
          <CardDescription>{copy.contactDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline"><a href="mailto:support@genesisgroup.cn">{copy.contactButton}</a></Button>
        </CardContent>
      </Card>
    </PublicLayout>
  );
}

export function HelpArticlePage(): React.JSX.Element {
  const { language } = useI18n();
  const copy = COPY[language];
  const { slug } = useParams<{ slug: string }>();
  const article = HELP_ARTICLES.find((item) => item.slug === slug);
  const related = article ? HELP_ARTICLES.filter((item) => item.category === article.category && item.slug !== article.slug).slice(0, 3) : [];

  if (!article) {
    return (
      <PublicLayout title={copy.notFound} description={copy.notFoundDesc} showBack>
        <Button asChild><Link to="/help">{copy.back}</Link></Button>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title={article.title[language]} description={article.summary[language]} showBack>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
        <article>
          <div className="mb-6 flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary">{HELP_CATEGORIES.find((item) => item.id === article.category)?.label[language]}</Badge>
            <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{article.minutes} {copy.minutes}</span>
          </div>
          <Markdown>{article.body[language]}</Markdown>
        </article>
        <aside className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><BookOpen className="h-4 w-4" />{copy.related}</p>
            <div className="mt-3 space-y-2">
              {related.length ? related.map((item) => <Link key={item.slug} className="block text-sm leading-5 text-muted-foreground hover:text-foreground" to={`/help/${item.slug}`}>{item.title[language]}</Link>) : <p className="text-sm text-muted-foreground">—</p>}
            </div>
          </div>
          <Button asChild variant="outline" className="w-full"><Link to="/help">{copy.back}</Link></Button>
        </aside>
      </div>
    </PublicLayout>
  );
}

export default HelpPage;
