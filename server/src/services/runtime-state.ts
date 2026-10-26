/**
 * Process-local lifecycle state for probes.
 * It is deliberately not persisted: a restart creates a fresh process and a
 * fresh readiness state; Mongo/tasks remain the durable authority.
 */
let draining = false;

export function beginShutdown(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

/** Test helper only; production never resets a draining process. */
export function resetLifecycleForTests(): void {
  draining = false;
}
