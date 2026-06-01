/**
 * Vercel Serverless Function: /api/file-status
 * 업로드된 오디오 파일의 구글 AI 처리 상태(PROCESSING, ACTIVE, FAILED)를 조회합니다.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(455).json({ error: 'Method Not Allowed' });
  }

  const { fileName } = req.query || {};

  if (!fileName) {
    return res.status(400).json({ error: 'Missing required parameter: fileName' });
  }

  // API 키 결정
  const userApiKey = req.headers['x-user-api-key'];
  const serverApiKey = process.env.GEMINI_API_KEY;
  const apiKey = userApiKey || serverApiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'Google AI Studio API Key가 설정되어 있지 않습니다.' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/files/${fileName}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'Failed to retrieve file info from Gemini API',
        details: errorText
      });
    }

    const data = await response.json();
    
    // 파일의 현재 상태(state) 반환
    return res.status(200).json({
      name: data.name,
      state: data.state, // 'PROCESSING', 'ACTIVE', 'FAILED'
      error: data.error
    });

  } catch (error) {
    console.error('file-status handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
