# [6.1] 앱 셸 구현

- 작업 시작 시각: 2026-03-01 03:45:00 +0900
- 작업 종료 시각: 2026-03-01 04:15:00 +0900

---

## 작업 대상

`/Users/aidan/projects/src-scroll-snap/index.html`

## 작업 내용

### 구현 항목

1. **HTML 구조**: React 18 (CDN) + Tailwind CSS (CDN) 단일 HTML 파일
2. **디자인 토큰 (S 객체)**: UI/UX 기획서의 Tailwind 클래스 상수 정의
3. **아이콘 시스템**: SVG 아이콘 팩토리 (Camera, Download, Type, Clipboard, Gear, Monitor, Loader, Grid)
4. **상태 관리**: `useReducer` 기반 전역 상태 (mode, device, 모드별 phase)
5. **TopBar**: 로고(ScrollSnap) + 5개 모드 탭 (스크롤 캡처/파일 수신/텍스트 캡처/블록 텍스트/설정)
6. **StatusBar**: 상태 텍스트 | 장치 | 해상도 | FPS(또는 OCR 엔진)
7. **2컬럼 레이아웃**: MainContent (flex-1) + Sidebar (w-[340px])
8. **ViewportGuard**: 1024px 미만 시 경고 메시지 표시

### 모드별 초기 상태 UI

| 모드 | 초기 상태 | 메인 영역 | 사이드바 |
|------|-----------|-----------|---------|
| 스크롤 캡처 | IDLE | 캡처카드 연결 안내 + 감지 스피너 | 장치(비활성)/방향(비활성)/시작(비활성) |
| 파일 수신 | SETUP | 소스 PC 준비 안내 (3단계 가이드) | 스크립트 버전 선택/장치/수신 시작 |
| 텍스트 캡처 | SETUP | 캡처카드 연결 안내 | 장치/방향/OCR타겟/OCR방법/OCR배지/시작 |
| 블록 텍스트 | SETUP | 사용 안내 + 역방향 스크롤 경고 | 장치/OCR제공자/안정성 슬라이더/감지 시작 |
| 설정 | SETTINGS | 3개 설정 카드 (Cloud OCR/캡처/블록텍스트) | 바로가기 + 정보 |

### 헬퍼 컴포넌트

- `SegCtrl`: 세그먼트 컨트롤 (방향, OCR 방법, 스크립트 버전 등)
- `SbSection`: 사이드바 섹션 (구분선 + 제목 + 내용)
- `OcrBadge`: OCR 엔진 배지 (사이드바 + 상태바 연동)
- `Placeholder`: 모드별 초기 화면 플레이스홀더

### OCR 엔진 표시

- 사이드바 배지: `OCR: Tesseract.js v5 (eng+kor)` / `Cloud Vision (DOCUMENT_TEXT_DETECTION)` / `GPT-4o`
- 상태바: 텍스트 관련 모드에서 FPS 대신 OCR 엔진 표시
- OCR 방법 변경 시 배지 + 상태바 실시간 갱신 확인됨

## 검증 결과

- Playwright 브라우저 테스트 (1440x900):
  - ✅ 5개 탭 전환 정상 동작
  - ✅ 각 모드별 초기 상태 UI 정상 렌더링
  - ✅ 세그먼트 컨트롤 상호작용 정상
  - ✅ OCR 방법 변경 시 배지+상태바 연동 확인
  - ✅ 상태바 모드별 텍스트 변경 확인
  - ✅ 콘솔 에러 없음 (favicon.ico 404 제외)

## 결과

- 파일: `/Users/aidan/projects/src-scroll-snap/index.html` (769줄)
- 기술 스택: React 18 (createElement) + Tailwind CSS (CDN)
- JSX 미사용, 외부 파일 없음, 서버 불필요
