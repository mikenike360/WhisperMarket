import type { NextApiRequest, NextApiResponse } from 'next';
import { ALEOSCAN_API_URL } from '@/types';

/**
 * API route to proxy AleoScan API requests to avoid CORS issues
 * This allows the frontend to make AleoScan API calls through our Next.js server
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract path from query parameter
    // Expected format: /v1/mapping/get_value/{program_id}/{mapping_name}/{key}
    const path = req.query.path as string;
    
    if (!path) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    // Decode the path (it's URL encoded from the client)
    const decodedPath = decodeURIComponent(path);
    
    // Construct the full URL
    const url = `${ALEOSCAN_API_URL}${decodedPath}`;
    
    // Forward the request to AleoScan API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
      },
    });
    
    if (!response) return res.status(500).json({ error: 'No response from AleoScan API' });

    // Handle 404 - mapping not found
    if (response.status === 404) return res.status(404).send('');

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return res.status(response.status).json({ error: errorText });
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(text);
  } catch (error: any) {
    res.status(500).json({ 
      error: 'Failed to proxy AleoScan API request',
      message: error.message,
    });
  }
}
