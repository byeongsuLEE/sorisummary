/**
 * Vercel Serverless Function: /api/init-upload
 * 구글 Gemini File API에 대용량 오디오 전송을 위한 Resumable Upload 세션을 개시합니다.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(455).json({ error: 'Method Not Allowed' });
  }

  const { fileSize, mimeType, displayName } = req.body || {};

  if (!fileSize || !mimeType) {
    return res.status(400).json({ error: 'Missing required parameters: fileSize, mimeType' });
  }

  // 1. API 키 결정 (사용자 헤더 키 우선 -> 서버 내장 환경 변수 키)
  const userApiKey = req.headers['x-user-api-key'];
  const serverApiKey = process.env.GEMINI_API_KEY;
  const apiKey = userApiKey || serverApiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'Google AI Studio API Key가 서버에 설정되어 있지 않습니다.' });
  }

  try {
    const url = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
    
    // 2. 구글 Gemini File API에 세션 개시 요청
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileSize),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: {
          display_name: displayName || `audio_${Date.now()}`
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'Gemini API upload session initialization failed',
        details: errorText
      });
    }

    // 3. 업로드 전용 Resumable URL 추출
    const uploadUrl = response.headers.get('X-Goog-Upload-URL') || response.headers.get('x-goog-upload-url');

    if (!uploadUrl) {
      return res.status(502).json({ error: 'Failed to retrieve X-Goog-Upload-URL from Gemini response headers' });
    }

    // 4. 업로드 URL 반환 (이 URL에는 API Key가 포함되지 않아 안전합니다)
    return res.status(200).json({ uploadUrl });

  } catch (error) {
    console.error('init-upload handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
