/**
 * JSON-RPC client for Aleo. Single source of truth for RPC access.
 * Uses API proxy route in browser to avoid CORS; direct URL in SSR.
 */
import { JSONRPCClient } from 'json-rpc-2.0';
import { CURRENT_RPC_URL } from '@/types';

export function getClient(apiUrl: string): JSONRPCClient {
  const isBrowser = typeof window !== 'undefined';
  const proxyUrl = isBrowser ? '/api/rpc-proxy' : apiUrl;

  const client: JSONRPCClient = new JSONRPCClient((jsonRPCRequest: { method: string }) => {
    return fetch(proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(jsonRPCRequest),
    }).then(async (response) => {
      // Ensure response exists
      if (!response) {
        throw new Error('No response received from RPC proxy');
      }

      // Try to parse JSON first (even if status is not ok, might be JSON-RPC error)
      let jsonRPCResponse: any;
      try {
        jsonRPCResponse = await response.json();
      } catch (parseError) {
        // If JSON parsing fails, get text response
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(`Failed to parse RPC response (${response.status}): ${text}`);
      }

      // Check if the response has an error field (JSON-RPC error)
      if (jsonRPCResponse && jsonRPCResponse.error) {
        const errorMessage = jsonRPCResponse.error.message || jsonRPCResponse.error.data || 'Unknown RPC error';
        const errorCode = jsonRPCResponse.error.code || -32000;
        
        // For missing mappings, return a more specific error that can be caught
        if (errorMessage.includes('not found') || 
            errorMessage.includes('does not exist') || 
            errorMessage.includes('No value found') ||
            errorCode === -32001) {
          throw new Error(`Mapping not found: ${errorMessage}`);
        }
        
        throw new Error(`RPC error (${errorCode}): ${errorMessage}`);
      }
      
      // Only call receive if we have a valid JSON-RPC response
      if (!jsonRPCResponse || jsonRPCResponse.jsonrpc !== '2.0') {
        throw new Error(`Invalid JSON-RPC response format: ${JSON.stringify(jsonRPCResponse)}`);
      }
      
      // For JSONRPCClient with custom transport, we need to call receive to process the response
      // However, receive might fail with certain response formats, so we'll try it and fall back
      try {
        return await client.receive(jsonRPCResponse);
      } catch (receiveError: any) {
        const errorMsg = receiveError?.message || String(receiveError);
        if (jsonRPCResponse.result !== undefined) return jsonRPCResponse.result;
        
        // If no result and it's not an error response, something is wrong
        throw new Error(`JSON-RPC response has no result and receive() failed: ${errorMsg}`);
      }
    }).catch((error) => {
      throw error;
    });
  });
  return client;
}

export const client = getClient(CURRENT_RPC_URL);
