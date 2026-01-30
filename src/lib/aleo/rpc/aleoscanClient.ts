/**
 * AleoScan REST API client for reading mappings
 * More reliable than JSON-RPC for mapping operations
 * 
 * API Format: GET /v1/mapping/get_value/{program_id}/{mapping_name}/{key}
 * Returns: Plain string value (e.g., "1" or "5876945607271027451885340988094905867884195093098210518443342717670717944265field")
 * 
 * Note: Uses proxy route in browser to avoid CORS issues, direct URL in SSR
 */

import { ALEOSCAN_API_URL } from '@/types';

function getAleoScanUrl(): string {
  const isBrowser = typeof window !== 'undefined';
  // Use proxy route in browser to avoid CORS, direct URL in SSR
  return isBrowser ? '/api/aleoscan-proxy' : ALEOSCAN_API_URL;
}

function buildProxyPath(programId: string, mappingName: string, key: string): string {
  const encodedProgramId = encodeURIComponent(programId);
  const encodedMappingName = encodeURIComponent(mappingName);
  const encodedKey = encodeURIComponent(key);
  return `/v1/mapping/get_value/${encodedProgramId}/${encodedMappingName}/${encodedKey}`;
}

/**
 * Get mapping value from AleoScan API
 * 
 * @param programId - Program ID (e.g., "whisper_market.aleo")
 * @param mappingName - Mapping name (e.g., "total_markets")
 * @param key - Key value (e.g., "0u64" or "5876945607271027451885340988094905867884195093098210518443342717670717944265field")
 * @returns Mapping value as string, or null if not found
 */
export async function getMappingValueFromAleoScan(
  programId: string,
  mappingName: string,
  key: string
): Promise<string | null> {
  try {
    const isBrowser = typeof window !== 'undefined';
    const baseUrl = getAleoScanUrl();
    
    let url: string;
    if (isBrowser) {
      // In browser, use proxy with path as query parameter
      const path = buildProxyPath(programId, mappingName, key);
      url = `${baseUrl}?path=${encodeURIComponent(path)}`;
    } else {
      // In SSR, use direct URL
      const encodedProgramId = encodeURIComponent(programId);
      const encodedMappingName = encodeURIComponent(mappingName);
      const encodedKey = encodeURIComponent(key);
      url = `${baseUrl}/v1/mapping/get_value/${encodedProgramId}/${encodedMappingName}/${encodedKey}`;
    }
    
    // Add timeout to prevent hanging requests (10 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });
    
    // Handle 404 - mapping/key doesn't exist
    if (response.status === 404) return null;
    
    // Handle other error statuses
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`AleoScan API error (${response.status}): ${errorText}`);
    }
    
    // AleoScan returns the value as a plain string (not JSON)
    const value = await response.text();
    return value || null;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('404') || errorMessage.includes('not found')) return null;
    if (error.name === 'AbortError' || errorMessage.includes('timeout') || errorMessage.includes('aborted')) return null;
    if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('Failed to fetch')) return null;
    throw error;
  }
}

/**
 * Check if AleoScan API is available
 * Useful for fallback logic
 */
export async function isAleoScanAvailable(): Promise<boolean> {
  try {
    // Try a simple request to check if API is reachable
    const response = await fetch(`${ALEOSCAN_API_URL}/v1/mapping/get_value/credits.aleo/account/test`, {
      method: 'GET',
    });
    // Even if the mapping doesn't exist, if we get a response (not network error), API is available
    return response.status === 404 || response.ok;
  } catch {
    return false;
  }
}
