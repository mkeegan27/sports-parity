/**
 * The slices of the Workers runtime this Worker uses, typed here rather than via the full
 * workers-types package so the code (and its tests) stay plain TypeScript.
 */
export interface KvStore {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** The static-assets binding: serves the built site, including the baseline data files. */
export interface AssetFetcher {
  fetch(request: Request | string): Promise<Response>;
}

export interface Env {
  ASSETS: AssetFetcher;
  /** Absent on Worker Previews (bindings aren't inherited there): previews serve the baseline. */
  LIVE?: KvStore;
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/** Downloads text; injected so tests never touch the network. */
export type FetchText = (url: string) => Promise<string>;
