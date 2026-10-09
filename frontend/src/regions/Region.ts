import { isCancel, messageOf } from "../errors";
import { actions } from "../store";
import { reportFailure, type ReportContext } from "./report";

interface Hooks {
  /** Show the failure. Default: store.regionErrors[key]. */
  onFail?: (err: unknown) => void;
  /** Hide it again (Retry / reset). Default: clears store.regionErrors[key]. */
  onClear?: () => void;
}

/**
 * A failure boundary that works for every kind of code, not just rendering.
 *
 *   fail(err)      show the error in this region and report it once
 *   run / wrap     sync code: handlers, timers, message callbacks
 *   track          async results: ignored if the region moved on or is gone
 *   reset          Retry, or the user moved on: next failure is a new report
 *   dispose        the region is gone: late results and errors do nothing
 *
 * Error boundaries only catch render errors; everything else goes through here.
 */
export class Region {
  private gen = 0;
  private alive = true;
  private failed = false;

  constructor(
    readonly key: string,
    private readonly context: () => ReportContext,
    private readonly hooks: Hooks = {},
  ) { }

  get isFailed() {
    return this.failed;
  }

  get isAlive() {
    return this.alive;
  }

  fail(err: unknown): void {
    // Gone, cancelled because the user moved on, or already showing an error.
    if (!this.alive || this.failed || isCancel(err)) return;
    this.failed = true;
    reportFailure(err, this.context());
    try {
      if (this.hooks.onFail) this.hooks.onFail(err);
      else actions.setRegionError(this.key, messageOf(err));
    } catch (e) {
      console.error(`[region ${this.key}] failed while showing its error`, e);
    }
  }

  run<T>(fn: () => T): T | undefined {
    if (!this.alive) return undefined;
    try {
      return fn();
    } catch (err) {
      this.fail(err);
      return undefined;
    }
  }

  wrap<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
    return (...args: A) => this.run(() => fn(...args));
  }

  /** Apply `onValue` only if this region is still on the same generation when the promise settles. */
  track<T>(promise: Promise<T>, onValue: (value: T) => void): void {
    const gen = this.gen;
    promise.then(
      (value) => {
        if (this.alive && gen === this.gen) this.run(() => onValue(value));
      },
      (err) => {
        if (this.alive && gen === this.gen) this.fail(err);
      },
    );
  }

  /** Is a result from generation `gen` still wanted? */
  token(): () => boolean {
    const gen = this.gen;
    return () => this.alive && gen === this.gen;
  }

  reset(): void {
    this.gen++;
    const wasFailed = this.failed;
    this.failed = false;
    if (!wasFailed) return;
    if (this.hooks.onClear) this.hooks.onClear();
    else actions.setRegionError(this.key, null);
  }

  dispose(): void {
    this.alive = false;
    this.gen++;
  }
}
