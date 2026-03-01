# 작업 [6.8] 통합 폴리싱

## 작업 정보
- **작업 대상**: `/index.html` — Toast 알림 시스템, ARIA 접근성, StatusBar 개선
- **시작 시각**: 2026-03-01 10:30 KST
- **종료 시각**: 2026-03-01 10:50 KST

## 작업 내용

### 6.8.1 Toast 알림 시스템

#### 아이콘 추가
- `ICheck` (체크 아이콘) — 성공 토스트
- `IAlertTriangle` (경고 삼각형) — 경고 토스트
- `IXCircle` (X 원형) — 에러 토스트
- `IInfo` (정보 원형) — 정보 토스트

#### TOAST_STYLES 객체
- 4가지 변형별 border 색상, 아이콘, 아이콘 색상 정의
- success: `border-emerald-500`, warning: `border-amber-500`, error: `border-red-500`, info: `border-sky-500`

#### ToastContainer 컴포넌트
- `fixed bottom-10 right-4 z-50` 위치
- 최대 3개 토스트 스택 (아래→위)
- 우측 slide-in 애니메이션 (CSS `@keyframes slide-in`, 300ms)
- 에러 토스트: `role="alert"` + `aria-live="assertive"`
- 기타 토스트: `role="status"` + `aria-live="polite"`
- 닫기 버튼 (✕) 포함

#### App 토스트 상태 관리
- `useState`로 토스트 배열 관리 (useReducer와 분리)
- `addToast(type, message, title)`: 토스트 추가 + 자동 소멸 (설정의 `btNotifDuration` 사용)
- `dismissToast(id)`: 수동 닫기

### 6.8.2 Toast ↔ 블록 텍스트 연동

| 이벤트 | 토스트 타입 | 메시지 |
|--------|-----------|--------|
| OCR 성공 + 클립보드 복사 | success | "클립보드에 복사되었습니다" + 50자 미리보기 |
| OCR 결과 없음 | warning | "OCR 결과가 비어 있습니다..." |
| ROI 추출 실패 | error | "ROI 추출에 실패했습니다." |
| OCR 에러 | error | "OCR 오류: {에러 메시지}" |

### 6.8.3 ARIA 접근성

| 요소 | 적용 내용 |
|------|----------|
| TopBar | `<nav>` + `aria-label="모드 탐색"` |
| 탭 컨테이너 | `role="tablist"` + `aria-label="모드 선택"` |
| 각 탭 | `role="tab"` + `aria-selected` |
| StatusBar | `<footer>` + `role="status"` + `aria-live="polite"` |
| VideoPreview | `aria-label="캡처카드 실시간 미리보기"` |
| 토스트(에러) | `role="alert"` + `aria-live="assertive"` |
| 토스트(기타) | `role="status"` + `aria-live="polite"` |

### 6.8.4 CSS 추가
- `@keyframes slide-in`: 우측에서 좌측으로 슬라이드 인 (300ms, ease-out)
- `.animate-slide-in` 클래스

## 검증 결과
- ✅ `node --check` 문법 검증 통과
- ✅ Playwright: 페이지 로드 성공, JS 에러 0건
- ✅ 모든 탭 정상 렌더링 (스크롤 캡처, 파일 수신, 텍스트 캡처, 블록 텍스트, 설정)
- ✅ ARIA: TopBar → `navigation`, 탭 → `tablist`+`tab`+`aria-selected`, StatusBar → `status`
- ✅ 블록 텍스트 탭: OCR 방법 전환, 안정성 슬라이더 정상 동작
- ✅ Toast 컴포넌트 렌더링 준비 완료 (블록 텍스트 OCR 성공/실패 시 트리거)
