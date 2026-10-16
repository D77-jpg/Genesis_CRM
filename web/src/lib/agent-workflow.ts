import type { AgentTask } from '@/components/agent/agent-tasks';

export type TaskBucket = 'review' | 'active' | 'attention' | 'history';
export type TaskFilter = 'pending' | TaskBucket | 'all';

export function taskBucket(task: Pick<AgentTask, 'status'>): TaskBucket {
  if (task.status === 'awaiting_review') return 'review';
  if (task.status === 'queued' || task.status === 'running') return 'active';
  if (task.status === 'completed' || task.status === 'cancelled') return 'history';
  return 'attention';
}

export function taskCounts(tasks: AgentTask[]): Record<TaskBucket, number> {
  return tasks.reduce((counts, task) => {
    counts[taskBucket(task)] += 1;
    return counts;
  }, { review: 0, active: 0, attention: 0, history: 0 });
}

export function visibleTasks(tasks: AgentTask[], filter: TaskFilter, focusId?: string | null): AgentTask[] {
  const priority: Record<TaskBucket, number> = { review: 0, attention: 1, active: 2, history: 3 };
  return tasks.filter(task => task.id === focusId || filter === 'all'
    || (filter === 'pending' ? taskBucket(task) !== 'history' : taskBucket(task) === filter))
    .sort((a, b) => {
      if (a.id === focusId) return -1;
      if (b.id === focusId) return 1;
      return priority[taskBucket(a)] - priority[taskBucket(b)];
    });
}
