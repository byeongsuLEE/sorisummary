/**
 * Gemini API 연동 모듈 (사용자 키 입력 시 다이렉트 통신, 미입력 시 Vercel 서버리스 프록시 작동)
 * 429 Rate Limit 및 503 High Demand에 대응하는 자동 재시도(Exponential Backoff) 내장
 */

export class GeminiService {
  constructor(apiKey) {
    this.apiKey = apiKey || ''; // 사용자 로컬 키가 있으면 저장, 없으면 빈 값
    this.baseUrl = 'https://generativelanguage.googleapis.com';
    this.modelName = 'gemini-2.5-flash';
  }

  // 지수 백오프 및 RetryInfo 파싱이 내장된 견고한 Fetch 헬퍼
  async fetchWithRetry(url, options, maxRetries = 3) {
    let delay = 3000;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) return response;

        const isRateLimit = response.status === 429;
        const isUnavailable = response.status === 503;

        if ((isRateLimit || isUnavailable) && i < maxRetries - 1) {
          let waitTime = delay;
          
          try {
            const errClone = response.clone();
            const errJson = await errClone.json();
            const retryInfo = errJson?.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
            if (retryInfo && retryInfo.retryDelay) {
              const seconds = parseFloat(retryInfo.retryDelay);
              if (!isNaN(seconds)) {
                waitTime = (seconds + 1.5) * 1000;
              }
            }
          } catch (e) {
            console.warn('RetryInfo 분석 실패, 기본 지수 대기 시간 적용');
          }

          console.warn(`Gemini API ${response.status} 발생. ${waitTime / 1000}초 후 재시도합니다... (시도 ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          delay *= 2;
          continue;
        }

        return response;
      } catch (err) {
        if (i < maxRetries - 1) {
          console.warn(`네트워크 에러로 인해 ${delay / 1000}초 후 재시도합니다...`, err);
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
    if (onProgress) onProgress('준비 중...');
    
    let uploadUrl = '';

    if (this.apiKey) {
      // A. 사용자 개별 API 키가 있는 경우: 구글 서버 직접 통신
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

      uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
    } else {
      // B. 사용자 API 키가 없는 경우: Vercel 서버리스 프록시를 통해 업로드 전용 URL 발급
      if (onProgress) onProgress('업로드 세션 개시 중...');
      const response = await this.fetchWithRetry('/api/init-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileSize: fileBlob.size,
          mimeType: fileBlob.type,
          displayName: displayName
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(`서버리스 세션 개시 실패: ${errJson.error || '알 수 없는 오류'}`);
      }

      const data = await response.json();
      uploadUrl = data.uploadUrl;
    }

    if (!uploadUrl) throw new Error('Upload URL을 받지 못했습니다.');

    // C. 실제 음성 바이너리 전송 (구글 서버로 100% 직접 전송하여 4.5MB 제한을 우회함, API Key 불필요)
    if (onProgress) onProgress('음성 업로드 중...');
    const uploadResponse = await this.fetchWithRetry(uploadUrl, {
      method: 'POST', // 구글 API 스펙상 POST 또는 PUT 지원
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
    const maxAttempts = 30;

    if (onProgress) onProgress('음성 인코딩 분석 중...');

    // fileUri 예: "https://generativelanguage.googleapis.com/v1beta/files/abc-123"
    // file name 추출: "files/abc-123"
    const fileName = fileUri.substring(fileUri.indexOf('files/'));

    while (state === 'PROCESSING' && attempts < maxAttempts) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      let checkResponse;
      if (this.apiKey) {
        // A. 사용자 개별 API 키가 있는 경우
        checkResponse = await this.fetchWithRetry(`${fileUri}?key=${this.apiKey}`, { method: 'GET' });
      } else {
        // B. 사용자 API 키가 없는 경우: Vercel 서버리스 프록시를 통해 상태 조회
        checkResponse = await this.fetchWithRetry(`/api/file-status?fileName=${fileName}`, { method: 'GET' });
      }

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

    if (this.apiKey) {
      // A. 사용자 개별 API 키가 있는 경우: 구글 직접 통신
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

    } else {
      // B. 사용자 API 키가 없는 경우: Vercel 서버리스 프록시 호출
      const response = await this.fetchWithRetry('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fileUri, mimeType })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(`서버리스 대화록 변환 실패: ${errJson.error || '알 수 없는 오류'}`);
      }

      const data = await response.json();
      return data.text;
    }
  }

  // 4. 임시 업로드 파일 삭제
  async deleteFile(fileName) {
    try {
      if (this.apiKey) {
        // A. 사용자 개별 API 키가 있는 경우
        const deleteUrl = `${this.baseUrl}/v1beta/${fileName}?key=${this.apiKey}`;
        await this.fetchWithRetry(deleteUrl, { method: 'DELETE' });
      } else {
        // B. 사용자 API 키가 없는 경우: Vercel 서버리스 프록시 호출
        await this.fetchWithRetry('/api/delete-file', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fileName })
        });
      }
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

    if (this.apiKey) {
      // A. 사용자 개별 API 키가 있는 경우: 구글 직접 통신
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

    } else {
      // B. 사용자 API 키가 없는 경우: Vercel 서버리스 프록시 호출
      const response = await this.fetchWithRetry('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transcript: fullTranscript })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(`서버리스 요약 생성 실패: ${errJson.error || '알 수 없는 오류'}`);
      }

      const data = await response.json();
      return data.summary;
    }
  }
}
