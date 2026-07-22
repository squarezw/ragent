import type { NextApiRequest, NextApiResponse } from 'next';
import axios from '@/lib/axios';

const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL;

/**
 * 公开的反馈API - 不需要认证，作为 proxy 调用 Python 后端
 * POST /api/public/feedback
 * Body: { t, a, content?: string }
 * 
 * t 由后端生成，包含加密的 detail_id 和 user_id
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!EXTERNAL_API_BASE_URL) {
    return res.status(500).json({ error: 'External API not configured' });
  }

  const { t, a, content } = req.body;

  if (!t) {
    return res.status(400).json({ error: 'Missing t' });
  }

  if (!a || (a !== 'good' && a !== 'bad')) {
    return res.status(400).json({ error: 'Invalid a' });
  }

  try {
    // 调用 Python 后端的公开反馈接口
    const response = await axios.post(
      `${EXTERNAL_API_BASE_URL}/api/v1/feedback/submit-public`,
      {
        t,
        a,
        content
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(200).json(response.data);
  } catch (e: any) {
    console.error('[Public Feedback] External API error:', e);
    const statusCode = e?.response?.status || 500;
    res.status(statusCode).json({ 
      error: 'Feedback submission failed', 
      details: e?.response?.data?.detail || e?.message || e 
    });
  }
}

