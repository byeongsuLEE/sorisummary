# 🎙️ SoriSummary (소리요약)

> **비용 0원, 저전력, 100% 온디바이스 저장 기반의 프리미엄 회의 녹음 & AI 화자 구분 요약기 PWA**

SoriSummary는 서버 유지비가 전혀 없는(0원) 안전하고 개인정보를 보호하는 회의록 작성 웹 애플리케이션입니다. 브라우저와 Google Gemini 1.5 Flash 무료 API를 활용하여 3시간 이상의 긴 회의도 안전하게 텍스트화하고 요약해 줍니다.

👉 **배포 주소:** [https://byeongsuLEE.github.io/sorisummary/](https://byeongsuLEE.github.io/sorisummary/)

---

## ✨ 핵심 기능 (Features)

1. **무제한 3시간 회의 돌파 (자동 오디오 로테이션)**
   - Gemini API 무료 티어의 분당 입력 제한(약 64분 오디오 분량)을 극복하기 위해, 녹음 중 **50분마다 오디오 파트를 자동 분할(Rotation)**하여 순차 처리합니다.
   - 무거운 오디오 슬라이싱 연산을 서버나 기기의 CPU/Memory 부담 없이 매끄럽게 처리합니다.

2. **완벽한 로컬 보안 & 비용 0원 (IndexedDB)**
   - 녹음된 오디오와 변환 텍스트는 외부 서버에 저장되지 않고, 브라우저 내부 데이터베이스인 **IndexedDB**에 안전하게 보관됩니다.
   - 서버 호스팅 및 DB 비용이 영원히 0원이며, 기밀 회의 내용 유출 우려가 전혀 없습니다.

3. **실시간 음성 시각화 (Neon Frequency Visualizer)**
   - Web Audio API의 주파수 분석 노드를 연동하여, 말할 때마다 반응하는 빛나는 **그라데이션 네온 웨이브 이퀄라이저** 시각 효과를 제공합니다.

4. **양방향 인터랙티브 에디터**
   - **화자 이름 일괄 변경**: `화자 A`를 터치하여 `김 대리`로 변경하면 전체 대화록에서 일괄 변경됩니다.
   - **대화록 본문 직접 편집**: 오타가 있거나 AI가 잘못 인식한 부분을 터치해 바로 편집하고 백그라운드로 자동 저장합니다.
   - **AI 요약 재수행**: 수정된 대화록을 기반으로 요약본을 즉시 다시 생성할 수 있습니다.

---

## 🛠️ 기술 스택 (Tech Stack)

- **Frontend**: Vanilla JS, HTML5
- **Styling**: Premium Neon Dark Glassmorphism CSS
- **Database**: IndexedDB (Local Storage wrapper)
- **API**: Google AI Studio Gemini 1.5 Flash REST API
- **Build & Dev Tool**: Vite

---

## 🚀 시작하기 (Local Setup)

```bash
# 의존성 설치
npm install

# 로컬 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
```

---

## ⚙️ GitHub Pages 배포 설정 방법

GitHub Actions를 통해 자동으로 배포하기 위해 리포지토리의 Pages 설정을 변경해야 합니다.

1. 리포지토리 설정 페이지 **`Settings`** 탭으로 이동합니다.
2. 좌측 메뉴에서 **`Pages`**를 클릭합니다.
3. **Build and deployment** 섹션의 **`Source`** 설정을 **`Deploy from a branch`**에서 **`GitHub Actions`**로 변경합니다.
4. 소스코드를 변경하여 `main` 브랜치에 푸시하면 자동으로 배포 빌드가 완료되어 서비스가 라이브됩니다!
