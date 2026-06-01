/**
 * Gemini API 연동 모듈 (서버 없이 순수 클라이언트 100% 동작)
 * 429 Rate Limit 및 503 High Demand에 대응하는 자동 재시도(Exponential Backoff) 내장
 */

export class GeminiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com';
    // 구글 무료 티어에서 가장 용량이 크고 안정적인 최신 공식 생산용 모델 에일리어스 적용
    this.modelName = 'gemini-2.5-flash'; 
  }

  // 지수 백오프 및 RetryInfo 파싱이 내장된 견고한 Fetch 헬퍼
  async fetchWithRetry(url, options, maxRetries = 3) {
    let delay = 3000; // 기본 대기 시간 3초
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) return response;

        // 429 (레이트 리밋) 혹은 503 (서버 혼잡)인 경우 자동 재시도
        const isRateLimit = response.status === 429;
        const isUnavailable = response.status === 503;

        if ((isRateLimit || isUnavailable) && i < maxRetries - 1) {
          let waitTime = delay;
          
          try {
            // 구글 API가 에러 메시지 객체에 넘겨준 구체적인 대기 시간(RetryInfo)을 추출
            const errClone = response.clone();
            const errJson = await errClone.json();
            const retryInfo = errJson?.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
            if (retryInfo && retryInfo.retryDelay) {
              const seconds = parseFloat(retryInfo.retryDelay);
              if (!isNaN(seconds)) {
                // 구글 권장 대기 시간 + 1초 버퍼
                waitTime = (seconds + 1.5) * 1000;
              }
            }
          } catch (e) {
            console.warn('구글 RetryInfo 대기 시간 분석 실패, 기본 지수 대기 시간 적용');
          }

          console.warn(`Gemini API ${response.status} 발생. ${waitTime / 1000}초 후 재시도합니다... (시도 ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          delay *= 2; // 지수 백오프 적용
          continue;
        }

        return response; // 404 등 재시도 불가능한 에러는 호출자에게 전달
      } catch (err) {
        if (i < maxRetries - 1) {
          console.warn(`네트워크 통신 에러로 인해 ${delay / 1000}초 후 재시도합니다...`, err);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw err;
      }
    }
  }

  // 1. Gemini File API를 이용한 음성 파일 업로드 (Resumable Upload 프로토콜)
  async uploadAudio(fileBlob, displayName, onProgress) {
    if (!this.apiKey) throw new Error('API Key가 입력되지 않았습니다.');

    if (onProgress) onProgress('준비 중...');
    
    const startUrl = `${this.baseUrl}/upload/v1beta/files?key=${this.apiKey}`;
    const startResponse = await this.fetchWithRetry(startUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileBlob.size,
        'X-Goog-Upload-Header-Content-Type': fileBlob.type,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: { displayName: displayName }
      })
    });

    if (!startResponse.ok) {
      const errText = await startResponse.text();
      throw new Error(`Gemini File Upload Init 실패: ${errText}`);
    }

    const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error('Upload URL을 받지 못했습니다.');

    if (onProgress) onProgress('음성 업로드 중...');
    const uploadResponse = await this.fetchWithRetry(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: fileBlob
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`Gemini File Upload 실패: ${errText}`);
    }

    const fileData = await uploadResponse.json();
    return fileData.file;
  }

  // 2. 업로드된 파일이 분석 가능한 상태(ACTIVE)가 될 때까지 대기 (폴링)
  async waitForFileActive(fileUri, onProgress) {
    let state = 'PROCESSING';
    let fileMetadata = null;
    let attempts = 0;
    const maxAttempts = 30; // 최대 1분 대기

    if (onProgress) onProgress('음성 인코딩 분석 중...');

    while (state === 'PROCESSING' && attempts < maxAttempts) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      const checkResponse = await this.fetchWithRetry(`${fileUri}?key=${this.apiKey}`, { method: 'GET' });
      if (!checkResponse.ok) continue;

      fileMetadata = await checkResponse.json();
      state = fileMetadata.state;
      console.log(`File state polling attempt ${attempts}: ${state}`);
    }

    if (state !== 'ACTIVE') {
      throw new Error('음성 파일 처리 대기 시간이 초과되었습니다.');
    }

    return fileMetadata;
  }

  // 3. 음성 대화록 추출 (화자 구분)
  async transcribeAudio(fileUri, mimeType, onProgress) {
    if (onProgress) onProgress('화자 구분 텍스트 변환 중...');

    const transcribeUrl = `${this.baseUrl}/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    
    const prompt = `
      이 오디오 파일을 읽고, 대화에 참여하는 사람들의 음색과 특징에 따라 화자(화자 1, 화자 2 등)를 명확히 구분하여 타임라인과 함께 정교한 대화 스크립트를 작성해줘.
      
      [출력 규칙]
      1. 화자 구분을 최우선으로 해주세요. 목소리가 겹치더라도 귀 기울여 분리해 적어줍니다.
      2. 포맷은 반드시 아래 예시를 준수하세요:
         [00:15] 화자 1: 오늘 회의는 마케팅 일정에 대한 것입니다.
         [00:32] 화자 2: 네, 디자인 시안이 다 나와서 일정대로 가능할 것 같아요.
      3. 대화 내용 외에 분석 설명이나 서론, 결론, 부가 설명은 일체 작성하지 마십시오.
    `;

    const response = await this.fetchWithRetry(transcribeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { fileData: { fileUri: fileUri, mimeType: mimeType } },
            { text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`대화록 변환 실패: ${errText}`);
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) throw new Error('변환된 대화록 내용이 비어있습니다.');
    
    return resultText;
  }

  // 4. 업로드된 파일 삭제 (개인정보 보호 및 정리)
  async deleteFile(fileName) {
    const deleteUrl = `${this.baseUrl}/v1beta/${fileName}?key=${this.apiKey}`;
    try {
      await this.fetchWithRetry(deleteUrl, { method: 'DELETE' });
      console.log('Gemini 임시 저장 파일 삭제 성공:', fileName);
    } catch (err) {
      console.warn('임시 파일 삭제 실패 (무시 가능):', err);
    }
  }

  // 5. 복수 음성 청크 순차 변환 및 병합 파이프라인
  async processAudioChunks(audioChunks, mimeType, onStatusChange) {
    const transcripts = [];

    for (let i = 0; i < audioChunks.length; i++) {
      const chunk = audioChunks[i];
      const displayName = `Meeting_Chunk_${i + 1}`;
      
      const updateStatus = (msg) => {
        if (onStatusChange) {
          onStatusChange(`[파트 ${i + 1}/${audioChunks.length}] ${msg}`);
        }
      };

      let uploadedFile = null;
      try {
        uploadedFile = await this.uploadAudio(chunk, displayName, updateStatus);
        await this.waitForFileActive(uploadedFile.uri, updateStatus);
        const transcript = await this.transcribeAudio(uploadedFile.uri, mimeType, updateStatus);
        transcripts.push(transcript);
        
      } catch (error) {
        console.error(`파트 ${i + 1} 처리 에러:`, error);
        throw error;
      } finally {
        if (uploadedFile && uploadedFile.name) {
          await this.deleteFile(uploadedFile.name);
        }
      }
    }

    return transcripts.join('\n\n--- [다음 파트] ---\n\n');
  }

  // 6. 대화록 기반 최종 회의 요약
  async summarizeTranscript(fullTranscript, onProgress) {
    if (onProgress) onProgress('핵심 요약본 생성 중...');

    const summaryUrl = `${this.baseUrl}/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const prompt = `
      다음은 한 회의의 대화 스크립트입니다.
      이 내용을 꼼꼼히 읽고 분석하여, 회의에 참석하지 않은 사람도 완벽하게 회의 흐름과 결론을 파악할 수 있도록 다음 포맷에 맞춰 격식 있고 깔끔하게 정리해줘.
      
      [작성 양식]
      # 📌 1. 회의 주요 개요
      - 회의 성격 및 핵심 아젠다
      
      # 🔍 2. 상세 핵심 논의 사항
      - 대화 내용에서 가장 중요하게 오간 핵심 발언과 주제들을 구분하여 가독성 좋은 리스트로 정리
      
      # 📝 3. 결정된 최종 사항 및 Action Item
      - 명확히 정해진 결정 사항 기재
      - **누가(화자)**, **어떤 일(Task)**을, **언제(Deadline)**까지 해야 하는지 추출하여 표 또는 세부 리스트로 정렬
      
      ---
      [대화 스크립트]
      ${fullTranscript}
    `;

    const response = await this.fetchWithRetry(summaryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`요약본 생성 실패: ${errText}`);
    }

    const data = await response.json();
    const summaryText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summaryText) throw new Error('생성된 요약본이 비어있습니다.');

    return summaryText;
  }
}
