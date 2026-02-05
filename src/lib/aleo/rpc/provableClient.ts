/**
 * Provable API v2 client for reading program mappings
 * Replaces AleoScan for mapping operations
 *
 * API: GET /program/:programID/mapping/:mappingName/:key
 * Base: https://api.provable.com/v2/{network}
 *
 * Uses proxy route in browser to avoid CORS issues, direct URL in SSR
 * Rate limited to 4 req/sec to stay under Provable's 5 req/sec limit.
 */

import { PROVABLE_API_BASE_URL } from '@/types';

const TICK_MS = 250; // Min delay between starting new requests = 4/sec
const MAX_CONCURRENT = 4; // Stay under Provable's 5 req/sec limit

type QueuedTask<T> = {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const queue: QueuedTask<unknown>[] = [];
let activeCount = 0;

function runTask(task: QueuedTask<unknown>): void {
  activeCount++;
  task
    .execute()
    .then((v) => task.resolve(v))
    .catch((e) => task.reject(e))
    .finally(() => {
      activeCount--;
      if (queue.length > 0) {
        setTimeout(processQueue, TICK_MS);
      }
    });
}

function processQueue(): void {
  if (activeCount >= MAX_CONCURRENT || queue.length === 0) return;
  const task = queue.shift() as QueuedTask<unknown>;
  if (!task) return;
  runTask(task);
}

function enqueue<T>(execute: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ execute, resolve, reject } as QueuedTask<unknown>);
    if (activeCount < MAX_CONCURRENT) {
      processQueue();
    }
  });
}

function getProvableUrl(): string {
  const isBrowser = typeof window !== 'undefined';
  return isBrowser ? '/api/provable-proxy' : PROVABLE_API_BASE_URL;
}

function buildProvablePath(programId: string, mappingName: string, key: string): string {
  const encodedProgramId = encodeURIComponent(programId);
  const encodedMappingName = encodeURIComponent(mappingName);
  const encodedKey = encodeURIComponent(key);
  return `/program/${encodedProgramId}/mapping/${encodedMappingName}/${encodedKey}`;
}

async function fetchMappingValueUnthrottled(
  programId: string,
  mappingName: string,
  key: string
): Promise<string | null> {
  const isBrowser = typeof window !== 'undefined';
  const baseUrl = getProvableUrl();

  let url: string;
  if (isBrowser) {
    const path = buildProvablePath(programId, mappingName, key);
    url = `${baseUrl}?path=${encodeURIComponent(path)}`;
  } else {
    const path = buildProvablePath(programId, mappingName, key);
    url = `${PROVABLE_API_BASE_URL}${path}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
    },
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Provable API error (${response.status}): ${errorText}`);
  }

  const value = await response.text();
  return value || null;
}

/** In-flight requests keyed by programId:mappingName:key to coalesce duplicate calls */
const inFlightMap = new Map<string, Promise<string | null>>();

/**
 * Get mapping value from Provable API (rate limited to 4 req/sec)
 * Coalesces duplicate requests for the same mapping key.
 *
 * @param programId - Program ID (e.g., "whisper_market.aleo")
 * @param mappingName - Mapping name (e.g., "total_markets")
 * @param key - Key value (e.g., "0u64" or "5876945607271027451885340988094905867884195093098210518443342717670717944265field")
 * @returns Mapping value as string, or null if not found
 */
export async function getMappingValueFromProvable(
  programId: string,
  mappingName: string,
  key: string
): Promise<string | null> {
  const cacheKey = `${programId}:${mappingName}:${key}`;
  const existing = inFlightMap.get(cacheKey);
  if (existing) return existing;

  const promise = enqueue(() => fetchMappingValueUnthrottled(programId, mappingName, key)).catch(
    (error: any) => {
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('404') || errorMessage.includes('not found')) return null;
      if (
        error.name === 'AbortError' ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('aborted')
      )
        return null;
      if (
        errorMessage.includes('fetch') ||
        errorMessage.includes('network') ||
        errorMessage.includes('Failed to fetch')
      )
        return null;
      throw error;
    }
  )
    .finally(() => {
      inFlightMap.delete(cacheKey);
    });
  inFlightMap.set(cacheKey, promise);
  return promise;
}
