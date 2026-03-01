# Task 21: 사이드바 왼쪽 이동 + 설정값 브라우저 저장

## 작업 시간
- 시작: 2026-03-01 15:14 KST
- 종료: 2026-03-01 15:21 KST

## 작업 내용

### 1. 사이드바 왼쪽 이동
- `S.sidebar` CSS: `border-l` → `border-r` (왼쪽에 위치하므로 오른쪽 테두리)
- App 렌더 순서: `SidebarSwitch` → `MainContent` (flex row에서 왼쪽에 배치)

### 2. 사이드바 설정값 localStorage 저장/복원
기존에는 설정 탭의 API 키 등만 `scrollsnap_settings` 키로 저장하고 있었음. 사이드바에서 선택하는 운영 설정값도 별도 키(`scrollsnap_sidebar_prefs`)로 저장하도록 추가.

**저장되는 값:**
- `mode`: 현재 활성 탭
- `scrollCapture.direction`: 스크롤 방향 (세로/가로)
- `scrollCapture.ocrMethod`: OCR 엔진 (tesseract/cloud-vision/llm-vision)
- `scrollCapture.ocrTarget`: OCR 대상 영역 (auto/manual)
- `scrollCapture.cropRect`: 수동 크롭 영역 좌표 ({x, y, w, h} %)
- `blockText.ocrMethod`: 블록 텍스트 OCR 엔진
- `blockText.stabilityThreshold`: 블록 텍스트 안정도 임계값

**구현:**
- Effect 5 (마운트 시): `localStorage.getItem('scrollsnap_sidebar_prefs')` → `SET_MODE`, `SC_UPDATE`, `BT_UPDATE` dispatch
- Effect 6 (변경 시): 관련 state 변경 감지 → `localStorage.setItem` 저장
- dependency array로 필요한 state 필드만 감시하여 불필요한 저장 방지

## 검증
- ✅ 문법 검사 통과
- ✅ Playwright: 페이지 로드 정상 (0 JS 에러)
- ✅ 사이드바 왼쪽 배치 스크린샷 확인
- ✅ OCR 방법을 Cloud Vision으로, OCR 타겟을 수동으로 변경 후 새로고침 → 설정 유지 확인
- ✅ cropRect 좌표 (10, 10, 80, 80) 유지 확인

## 변경 파일
- `index.html`: S.sidebar border 변경, 렌더 순서 변경, Effect 5/6 추가
