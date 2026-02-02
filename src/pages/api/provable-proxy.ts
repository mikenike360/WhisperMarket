import type { NextApiRequest, NextApiResponse } from 'next';
import { PROVABLE_API_BASE_URL } from '@/types';

/**
 * API route to proxy Provable API requests to avoid CORS issues
 * This allows the frontend to make Provable API calls through our Next.js server
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const path = req.query.path as string;

    if (!path) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const decodedPath = decodeURIComponent(path);
    const url = `${PROVABLE_API_BASE_URL}${decodedPath}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response) return res.status(500).json({ error: 'No response from Provable API' });

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
      error: 'Failed to proxy Provable API request',
      message: error.message,
    });
  }
}
