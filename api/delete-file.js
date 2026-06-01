/**
 * Vercel Serverless Function: /api/delete-file
 * 구글 AI 스튜디오 클라우드에 임시 업로드되어 있던 오디오 파일을 즉시 삭제합니다.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(455).json({ error: 'Method Not Allowed' });
  }

  const { fileName } = req.body || {};

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
      method: 'DELETE',
      headers: {
        'x-goog-api-key': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'Failed to delete file from Gemini API',
        details: errorText
      });
    }

    return res.status(200).json({ success: true, message: `File ${fileName} deleted successfully` });

  } catch (error) {
    console.error('delete-file handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
