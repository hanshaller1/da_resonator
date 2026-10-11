import type { Unsubscribe } from '../core/types';

export type FrameTask = (now: number, dtMs: number) => void;

/**
 * One shared requestAnimationFrame loop for every animated UI element
 * (meters, modulation indicators, spectrum). Runs only while tasks exist and
 * the document is visible.
 */
class FrameLoop {
  private tasks = new Set<FrameTask>();
  private raf = 0;
  private last = 0;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop();
        else this.kick();
      });
    }
  }

  add(task: FrameTask): Unsubscribe {
    this.tasks.add(task);
    this.kick();
    return () => {
      this.tasks.delete(task);
      if (!this.tasks.size) this.stop();
    };
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  private kick(): void {
    if (this.raf || !this.tasks.size || document.hidden) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    const dt = this.last ? Math.min(100, now - this.last) : 16.7;
    this.last = now;
    for (const t of this.tasks) {
      try {
        t(now, dt);
      } catch (err) {
        console.error('[ui] frame task failed', err);
      }
    }
    this.kick();
  };
}

export const frameLoop = new FrameLoop();
