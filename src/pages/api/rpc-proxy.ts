import type { NextApiRequest, NextApiResponse } from 'next';
import { CURRENT_RPC_URL } from '@/types';

/**
 * API route to proxy RPC requests to avoid CORS issues
 * This allows the frontend to make RPC calls through our Next.js server
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate request body
  if (!req.body) {
    return res.status(400).json({ error: 'Request body is required' });
  }

  try {
    // Forward the request to the RPC endpoint
    const response = await fetch(CURRENT_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    
    if (!response) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: 'No response from RPC endpoint'
        }
      });
    }

    // Get the response data first (even if status is not ok, might be JSON-RPC error)
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      const errorText = await response.text();
      return res.status(200).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: response.status === 503 ? -32000 : -32603,
          message: response.status === 503 
            ? 'RPC service temporarily unavailable' 
            : 'Internal error',
          data: errorText.substring(0, 200)
        }
      });
    }

    if (!response.ok) {
      if (data && data.jsonrpc === '2.0' && data.error) {
        return res.status(200).json(data); // Return 200 with JSON-RPC error
      }
      
      // Otherwise, wrap it in JSON-RPC error format
      return res.status(200).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: response.status === 503 ? -32000 : -32603,
          message: response.status === 503 
            ? 'RPC service temporarily unavailable' 
            : 'RPC request failed',
          data: typeof data === 'string' ? data : JSON.stringify(data)
        }
      });
    }

    res.status(200).json(data);
  } catch (error: any) {
    // Return proper JSON-RPC error format
    res.status(200).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Failed to proxy RPC request',
        data: error.message || String(error)
      }
    });
  }
}
