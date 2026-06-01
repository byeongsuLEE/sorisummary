/**
 * Vercel Serverless Function: /api/transcribe
 * 구글 Gemini 1.5 Flash API를 활용하여 업로드된 오디오 파일을 화자 구분 대화록으로 받아씁니다.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(455).json({ error: 'Method Not Allowed' });
  }

  const { fileUri, mimeType } = req.body || {};

  if (!fileUri || !mimeType) {
    return res.status(400).json({ error: 'Missing required parameters: fileUri, mimeType' });
  }

  // API 키 결정
  const userApiKey = req.headers['x-user-api-key'];
  const serverApiKey = process.env.GEMINI_API_KEY;
  const apiKey = userApiKey || serverApiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'Google AI Studio API Key가 설정되어 있지 않습니다.' });
  }

  const prompt = `
당신은 최고의 회의 속기사입니다. 주어진 회의 음성 파일을 한 단어도 놓치지 말고 타임스탬프와 함께 화자 구분을 하여 한글 텍스트 대화록으로 받아적어 주세요.
반드시 아래의 양식을 엄격히 준수하여 출력해야 하며, 양식 외에 어떠한 서론, 결론, 혹은 부가 설명도 절대 포함하지 마십시오.

[양식]
[시작시간] 화자이름: 대화내용

[예시]
[00:05] 화자 1: 안녕하십니까, 오늘 회의를 시작하겠습니다.
[00:12] 화자 2: 예, 안녕하십니까. 오늘 안건은 무엇인가요?
[00:20] 화자 1: 네, 오늘은 신규 PWA 앱 개발 일정에 대해 논의하겠습니다.

[규칙]
1. 오디오에서 구분되는 목소리마다 고유한 화자 이름(예: 화자 1, 화자 2, 화자 3...)을 할당하세요.
2. 타임스탬프는 대화가 시작되는 시점을 [분:초] 또는 [시간:분:초] 형식으로 적어주세요.
3. 소리가 겹치거나 명확하지 않더라도 최대한 전후 문맥을 고려해 온전한 한글 문장으로 복원해 주세요.
4. 오직 위 [양식]에 맞춰 한 줄씩 출력하고, 설명글은 단 한 글자도 적지 마십시오.
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { fileData: { fileUri, mimeType } },
          { text: prompt }
        ]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: 'Gemini Transcription failed',
        details: errorText
      });
    }

    const data = await response.json();
    
    // 결과 텍스트 추출
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return res.status(200).json({ text });

  } catch (error) {
    console.error('transcribe handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
