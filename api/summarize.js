/**
 * Vercel Serverless Function: /api/summarize
 * 구글 Gemini 1.5 Flash API를 활용하여 대화록 전체를 분석하고 요약 리포트를 마크다운으로 생성합니다.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(455).json({ error: 'Method Not Allowed' });
  }

  const { transcript } = req.body || {};

  if (!transcript) {
    return res.status(400).json({ error: 'Missing required parameter: transcript' });
  }

  // API 키 결정
  const userApiKey = req.headers['x-user-api-key'];
  const serverApiKey = process.env.GEMINI_API_KEY;
  const apiKey = userApiKey || serverApiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'Google AI Studio API Key가 설정되어 있지 않습니다.' });
  }

  const prompt = `
당신은 기업 회의록 분석 전문가이자 요약 마스터입니다. 제공된 회의 대화록(속기본)을 정독하고, 회의에 참여하지 않은 사람도 핵심 내용을 즉시 파악할 수 있도록 완성도 높은 요약본을 한글로 작성해 주세요.

반드시 마크다운(Markdown) 형식을 사용해야 하며, 다음 구조를 정확히 지켜 주십시오:

# 📌 [회의 제목]
*(여기에 대화 내용을 바탕으로 회의 성격에 맞는 직관적인 제목을 지어 작성하세요)*

## 🔍 회의 개요
- **일시**: (대화록 및 정황상 알 수 있으면 작성, 모르면 '기록되지 않음'으로 표기)
- **주요 참석자**: (대화록에 나타난 화자들의 이름이나 직책 나열)
- **회의 목적**: (회의를 진행한 핵심 이유 요약)

## 📝 논의 및 합의 사항
- **[주제/안건 1]**: (무엇에 대해 논의했고 각 화자들이 어떤 태도를 보였는지, 최종 합의된 사항은 무엇인지 구체적으로 요약)
- **[주제/안건 2]**: (추가 안건이 있다면 동일하게 작성)

## 💡 의사 결정 및 후속 작업 (Action Items)
- [ ] **[담당자 이름/미정]**: (수행해야 할 구체적인 태스크 및 마감 일정)
- [ ] **[담당자 이름/미정]**: (수행해야 할 다른 태스크)

## 🎯 최종 한 줄 요약
- *(회의의 전체 결론이나 핵심 성과를 임팩트 있는 한 문장으로 정리)*

---
[규칙]
1. 존댓말(하십시오체 또는 해요체)을 사용해 정중하고 격식 있게 작성하세요.
2. 대화록에 없는 사실을 임의로 상상하여 채워 넣지 말고, 대화 내용에만 기반하여 객관적으로 요약하세요.
3. 마크다운 기호(#, ##, -, *, [ ], [x])를 정확히 사용하여 가독성을 최대로 높여주세요.
4. 의사 결정 및 후속 작업은 체크박스 양식(\`- [ ]\`)을 사용하여 작성해 주세요.
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: `회의 대화록:\n${transcript}` },
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
        error: 'Gemini Summarization failed',
        details: errorText
      });
    }

    const data = await response.json();
    
    // 결과 텍스트 추출
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return res.status(200).json({ summary });

  } catch (error) {
    console.error('summarize handler failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
