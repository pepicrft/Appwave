import { ChildProcess } from 'child_process';

/**
 * Process manager to track all spawned child processes
 * and ensure they are properly cleaned up when the app exits
 */

const activeProcesses = new Set<ChildProcess>();

/**
 * Register a child process for tracking
 * The process will be automatically removed when it exits
 */
export function registerProcess(proc: ChildProcess): void {
  activeProcesses.add(proc);

  const cleanup = () => {
    activeProcesses.delete(proc);
  };

  proc.on('close', cleanup);
  proc.on('exit', cleanup);
  proc.on('error', cleanup);
}

/**
 * Kill all tracked processes
 * Called during app shutdown to prevent orphaned processes
 */
export function killAllProcesses(): void {
  console.log(`[process-manager] Killing ${activeProcesses.size} active processes...`);

  for (const proc of activeProcesses) {
    try {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // Give it a moment, then force kill if still running
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 1000);
      }
    } catch (err) {
      console.error(`[process-manager] Error killing process:`, err);
    }
  }

  activeProcesses.clear();
}

/**
 * Get the count of active processes
 */
export function getActiveProcessCount(): number {
  return activeProcesses.size;
}
