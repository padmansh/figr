import { PAGES_ORIGIN, REQUEST_TIMEOUT_MS } from "../config";
import { CancelError, TimeoutError } from "../errors";
import type { Commands, EventName, Events, Method, Requests } from "../protocol";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Handlers {
  hello(docId: string, data: Events["hello"], navigated: boolean): void;
  bye(): void;
  event<N extends EventName>(name: N, data: Events[N], docId: string): void;
}

/**
 * One iframe's link to its page bridge. Owns request ids, timeouts and the
 * current docId. A hello with a new docId means a new document (navigation or
 * reload): everything pending for the old one is cancelled, not failed.
 */
export class PreviewConnection {
  docId: string | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private disposed = false;

  constructor(
    readonly sid: string,
    readonly win: Window,
    private readonly handlers: Handlers,
  ) {}

  receive(msg: { type: string; docId: string; id?: number; name?: string; data?: unknown; result?: unknown; error?: string }) {
    if (this.disposed) return;

    if (msg.type === "event" && msg.name === "hello") {
      if (msg.docId === this.docId) return;
      const navigated = this.docId !== null;
      this.cancelAll("The page navigated");
      this.docId = msg.docId;
      this.handlers.hello(msg.docId, msg.data as Events["hello"], navigated);
      return;
    }

    if (msg.docId !== this.docId) return; // from a document we've moved on from

    if (msg.type === "event" && msg.name === "bye") {
      this.cancelAll("The page is navigating");
      this.handlers.bye();
      return;
    }

    if (msg.type === "response" && typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return; // timed out already, or cancelled
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`Page bridge: ${msg.error}`));
      else p.resolve(msg.result);
      return;
    }

    if (msg.type === "event" && msg.name) this.handlers.event(msg.name as EventName, msg.data as never, msg.docId);
  }

  call<M extends Method>(method: M, params: Requests[M][0], timeoutMs = REQUEST_TIMEOUT_MS): Promise<Requests[M][1]> {
    return new Promise((resolve, reject) => {
      if (this.disposed || !this.docId) {
        reject(new CancelError("Preview is not connected"));
        return;
      }
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`${method} got no answer from the page in ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.post({ type: "request", id, method, params, docId: this.docId });
    });
  }

  command<C extends keyof Commands>(method: C, params: Commands[C]) {
    if (this.disposed || !this.docId) return;
    this.post({ type: "command", method, params });
  }

  dispose() {
    if (this.disposed) return;
    this.cancelAll("The preview was closed");
    this.disposed = true;
  }

  private cancelAll(reason: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new CancelError(reason));
    }
    this.pending.clear();
  }

  private post(msg: object) {
    try {
      this.win.postMessage({ __figr: 1, ...msg }, PAGES_ORIGIN);
    } catch {
      // the frame is gone; the request's timeout will report it if it matters
    }
  }
}
