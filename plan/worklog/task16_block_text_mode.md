# 작업 [6.7] 블록 텍스트 모드 구현

## 작업 정보
- **작업 대상**: `/index.html` — 블록 텍스트 모드 전체 구현
- **시작 시각**: 2026-03-01 10:05 KST
- **종료 시각**: 2026-03-01 10:30 KST

## 작업 내용

### 6.7.1 INIT_STATE 확장
- `blockText` 상태에 `detectStatus`, `stabilityPct`, `roiRect`, `history`, `processingText`, `ocrMethod`, `ocrProgress`, `ocrChunks`, `ocrCurrentChunk`, `errorMsg` 필드 추가
- `stabilityThreshold`를 시간 기반(1.5초)으로 변경 (기존 퍼센트 85 → 1.5초)

### 6.7.2 BlockTextMain 컴포넌트 (메인 영역)
- **SETUP (미연결)**: "캡처카드를 연결해 주세요" 플레이스홀더 + 장치 감지 중 스피너
- **SETUP (연결됨)**: 블록 텍스트 사용 안내 (드래그 → 하이라이트 → 자동 OCR 설명)
- **MONITORING**: 라이브 비디오 프리뷰 + 감지 오버레이(cyan 보더) + 원형 안정화 인디케이터(SVG) + OCR 배지
- **PROCESSING**: OCR 처리 중 스피너 + 프로그레스 바 + 청크 진행 표시

### 6.7.3 BlockTextSidebar 컴포넌트 (사이드바)
- **SETUP**: 장치 선택 / 안정성 임계치 슬라이더(1.0s~3.0s) / OCR 방법 세그먼트 컨트롤 / OCR 배지 / 감지 시작 버튼
- **MONITORING/PROCESSING**: 감지 상태 배지(대기/감지됨/안정화 중/OCR 처리 중) / OCR 배지 / 안정성 슬라이더 / 전송 이력(최대 20건, 클릭 시 클립보드 복사) / 이력 지우기 / 감지 중단 버튼

### 6.7.4 블록 텍스트 파이프라인 (App 컴포넌트)
- `btRef`: 감지 상태 관리용 useRef (canvas, ctx, refFrame, stabilityStart, lastRoi, detectTimerId 등)
- `btCaptureAndDetect()`: 5fps 주기로 프레임 캡처 → 참조 프레임과 픽셀 차이 비교 → ROI 바운딩 박스 추출 → ROI 안정성 추적 → 임계치 도달 시 OCR 트리거
- `btExtractAndOcr(roi, vw, vh)`: ROI 캔버스 추출 → OcrEngine.performOcr() 호출 → 성공 시 클립보드 자동 복사 + 이력 추가 (중복 시 타임스탬프만 갱신) → MONITORING 복귀
- `startBlockText()`: 참조 프레임 초기화 → MONITORING 상태 전환 → 200ms 간격 감지 루프 시작
- `stopBlockText()`: 감지 루프 정지 → SETUP 복귀
- `btClearHistory()`: 이력 초기화

### 6.7.5 콜백 연결
- `MainContent`: BlockTextMain에 stream, resolution, fps, deviceConnected, videoRef 전달
- `SidebarSwitch`: BlockTextSidebar에 onStartBlockText, onStopBlockText, onClearHistory 전달
- App render: SidebarSwitch에 startBlockText, stopBlockText, btClearHistory 함수 전달

### 6.7.6 키보드 단축키
- Space: SETUP(연결됨) → 감지 시작, MONITORING → 감지 중단
- Escape: MONITORING/PROCESSING → 감지 중단

### 6.7.7 StatusBar 업데이트
- MONITORING: "감지 중" + 안정화 퍼센트 표시
- PROCESSING: "OCR 처리 중" + 진행률 표시
- OCR 표시: blockText.ocrMethod 사용

## 검증 결과
- ✅ `node --check` 문법 검증 통과
- ✅ Playwright: 페이지 로드 성공, JS 에러 0건
- ✅ 블록 텍스트 탭: SETUP 상태 정상 렌더링
- ✅ OCR 방법 전환 (Tesseract ↔ LLM Vision ↔ Cloud Vision) 정상 동작
- ✅ 안정성 임계치 슬라이더 정상 표시 (1.5s)
- ✅ StatusBar OCR 표시 정상 (모드별 ocrMethod 분기)
- ✅ 기존 모든 탭(스크롤 캡처, 파일 수신, 텍스트 캡처, 설정) 정상 동작 확인

## 감지 알고리즘 요약
1. 모니터링 시작 시 참조 프레임 저장
2. 200ms 간격으로 현재 프레임과 참조 프레임 픽셀 차이 비교 (step=4 다운샘플링)
3. 변경 영역 바운딩 박스 추출 (변경 픽셀 0.5% 이상일 때)
4. ROI 안정성 추적 (위치/크기 변화 2-3% 이내 시 안정)
5. 임계치 시간(기본 1.5초) 동안 안정 유지 시 ROI 추출 → OCR 실행
6. OCR 성공 시 자동 클립보드 복사 + 이력 추가 (최대 20건)
7. MONITORING 상태로 복귀하여 다음 선택 대기
