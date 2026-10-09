import { API_ORIGIN } from "../config";
import { BadDataError, HttpError } from "../errors";
import type { Details, Screen } from "../store";

// A failed request is a 5xx or a 200 with a malformed body; both are errors.
// 404 is returned as null (it is an answer, not a failure). AbortError passes
// through untouched so regions can tell "user moved on" from "failed".

async function getJson(path: string, signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(API_ORIGIN + path, { signal });
  if (res.status === 404) return null;
  const label = `GET ${path.split("?")[0]}`;
  if (!res.ok) throw new HttpError(`${label} → ${res.status}`, res.status);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new BadDataError(`${label} → malformed body`);
  }
}

const isStr = (v: unknown) => typeof v === "string";

export async function fetchScreens(signal: AbortSignal, query = ""): Promise<Screen[]> {
  const data = await getJson(`/screens${query}`, signal);
  if (!Array.isArray(data) || !data.every((s) => s && isStr(s.id) && isStr(s.name) && isStr(s.url))) {
    throw new BadDataError("GET /screens → unexpected data");
  }
  return data.map((s) => ({ id: s.id, name: s.name, url: s.url }));
}

export async function fetchDetails(key: string, signal: AbortSignal, query = ""): Promise<Details | null> {
  const data = (await getJson(`/elements/${encodeURIComponent(key)}${query}`, signal)) as Record<string, unknown> | null;
  if (data === null) return null;
  if (!data || !["component", "description", "status", "owner"].every((f) => isStr(data[f]))) {
    throw new BadDataError(`GET /elements/${key} → unexpected data`);
  }
  return {
    component: data.component as string,
    description: data.description as string,
    status: data.status as string,
    owner: data.owner as string,
  };
}
