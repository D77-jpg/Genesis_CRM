import type * as React from 'react';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjectStore } from '@/store/project.store';

export function ProjectSwitcher(): React.JSX.Element {
  const items = useProjectStore((state) => state.items).filter((item) => item.status === 'active');
  const active = useProjectStore((state) => state.activeProject);
  const switchProject = useProjectStore((state) => state.switchProject);

  if (!active) return <></>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-[11rem] gap-2 sm:max-w-[15rem]" aria-label={`切换项目，当前为 ${active.name}`}>
          <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>当前项目工作空间</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => switchProject(project.id)} className="min-h-11">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary" aria-hidden>
              {project.code.slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{project.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{project.industry || project.companyName}</span>
            </span>
            {project.id === active.id ? <Check className="h-4 w-4 text-primary" aria-label="当前项目" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
