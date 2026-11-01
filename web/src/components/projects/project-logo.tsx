import type * as React from 'react';
import type { Project } from '@/types';
import { cn } from '@/lib/utils';

const BUILTIN_LOGOS: Record<string, string> = {
  GENESIS: '/api/brand/genesis-logo.png',
  IRONHUE: '/api/brand/ironhue-logo.png',
};

const BUILTIN_ICONS: Record<string, string> = {
  GENESIS: '/project-icons/genesis.png',
  IRONHUE: '/project-icons/ironhue.png',
  VELATURO: '/project-icons/velaturo.png',
};

const FRAME: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'h-6 max-w-[4.5rem] text-[10px]',
  sm: 'h-7 max-w-[6rem] text-xs',
  md: 'h-10 max-w-[8rem] text-sm',
  lg: 'h-12 max-w-[10rem] text-base',
};

const FALLBACK: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-6', sm: 'w-7', md: 'w-10', lg: 'w-12',
};

/** Stored wordmark wins on full-size surfaces; compact surfaces may use a built-in icon. */
export function projectLogoSrc(project: Pick<Project, 'code' | 'logoImage'>): string | undefined {
  const custom = project.logoImage?.trim();
  if (custom) return custom;
  return BUILTIN_LOGOS[project.code.trim().toUpperCase()];
}

export function ProjectLogo({ project, size = 'md', compact = false, className }: { project: Project; size?: keyof typeof FRAME; compact?: boolean; className?: string }): React.JSX.Element {
  const src = projectLogoSrc(project);
  // Compact surfaces (sidebar rail, avatar-sized switchers) need a square
  // symbol. Stored project logos are usually wordmarks, so known projects
  // prefer their dedicated icon; unknown projects still use their own logo.
  const compactSrc = BUILTIN_ICONS[project.code.trim().toUpperCase()] ?? src;
  if (compactSrc && compact) {
    const compactFrame = size === 'xs' ? 'h-6 w-6' : size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
    return <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white', compactFrame, className)} title={`${project.name} Logo`}>
      <img src={compactSrc} alt={`${project.name} Logo`} className="h-full w-full object-contain p-0.5" loading="lazy" />
    </span>;
  }
  if (src) {
    return <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden', FRAME[size], className)} title={`${project.name} Logo`}>
      <img src={src} alt={`${project.name} Logo`} className="max-h-full max-w-full object-contain" loading="lazy" />
    </span>;
  }
  return <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary', FRAME[size], FALLBACK[size], className)}>
    {project.code.slice(0, 2).toUpperCase()}
  </span>;
}
