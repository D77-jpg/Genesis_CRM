/**
 * 国旗小图标
 * ------------------------------------------------------------------
 * 用本地静态图片（web/public/flags/<iso2>.png）而不是 emoji：
 * Windows 的 Segoe UI Emoji 不渲染国旗 emoji，会退化成「GB」「US」两个字母，
 * 本地图片在任何系统上都是同一面旗子，也不依赖外网。
 */
import * as React from 'react';
import { countryCode } from '@/lib/country';
import { cn } from '@/lib/utils';

export function CountryFlag({
  value,
  className,
}: {
  /** 任意国家写法：英国 / UK / United Kingdom 都能认出 */
  value?: string | null;
  className?: string;
}): React.JSX.Element | null {
  const code = countryCode(value);
  if (!code) return null;
  return (
    <img
      src={`/flags/${code}.png`}
      alt=""
      aria-hidden
      loading="lazy"
      width={18}
      height={12}
      className={cn('inline-block h-3 w-[1.125rem] shrink-0 rounded-[2px] object-cover ring-1 ring-black/5', className)}
    />
  );
}
