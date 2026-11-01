import type * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
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
import { ProjectLogo } from '@/components/projects/project-logo';

export function ProjectSwitcher(): React.JSX.Element {
  const items = useProjectStore((state) => state.items).filter((item) => item.status === 'active');
  const active = useProjectStore((state) => state.activeProject);
  const switchProject = useProjectStore((state) => state.switchProject);

  if (!active) return <></>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="workspace-project-switcher h-8 min-w-0 max-w-[10rem] gap-2 px-2 text-xs font-medium sm:max-w-[14rem]" aria-label={`切换项目，当前为 ${active.name}`}>
          <ProjectLogo project={active} size="xs" />
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(24rem,70vh)] w-64 overflow-y-auto">
        <DropdownMenuLabel>切换项目</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => switchProject(project.id)} className="min-h-10">
            <ProjectLogo project={project} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{project.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{project.industry || project.companyName}</span>
            </span>
            {project.id === active.id ? <Check className="h-4 w-4 text-primary" aria-label="当前项目" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
