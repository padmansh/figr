/** The user moved on (newer request, navigation, unmount). Never shown, never reported. */
export class CancelError extends Error {
  name = "CancelError";
}

export class TimeoutError extends Error {
  name = "TimeoutError";
}

/** The page never connected (no hello) — "Couldn't connect to this preview". */
export class ConnectError extends Error {
  name = "ConnectError";
}

export class HttpError extends Error {
  name = "HttpError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class BadDataError extends Error {
  name = "BadDataError";
}

export function isCancel(err: unknown): boolean {
  return err instanceof CancelError || (err instanceof DOMException && err.name === "AbortError");
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
