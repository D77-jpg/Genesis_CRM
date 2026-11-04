import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/popover';
import { useI18n } from '@/i18n';

/** Compact EN/中 switch; preference is persisted locally and never needs a reload. */
export function LanguageToggle(): React.JSX.Element {
  const { language, setLanguage, t } = useI18n();
  const label = t('header.language');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-[11px] font-medium"
          onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          aria-label={label}
        >
          <Languages className="h-3.5 w-3.5" aria-hidden />
          <span>{language === 'zh' ? 'EN' : '中'}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
