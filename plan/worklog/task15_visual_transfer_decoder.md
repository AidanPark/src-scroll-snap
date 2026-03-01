# [6.4] 파일 수신 (Visual Transfer) 디코더 구현

## 작업 개요
- **작업 대상**: index.html — Visual Transfer 디코더 파이프라인 + 파일 수신 UI 전체 구현
- **작업 시작**: 2026-03-01 09:24 KST
- **작업 종료**: 2026-03-01 09:30 KST

## 작업 내용

### 1. VisualDecoder 모듈 추가 (CaptureEngine 이후)
- 4색 팔레트 (Black=00, Blue=01, Red=10, White=11)
- 격자 파라미터: 96×54 셀, 헤더 32셀, 데이터 5152셀, 프레임당 1288바이트
- `nearestColor()` — 유클리드 거리 기반 최근접 색상 매핑
- `sampleCell()` — 셀 중앙 10×10 픽셀 평균 RGB 추출
- `decodeFrame()` — ImageData → 헤더 + 데이터 바이트 복원 (MSB-first)
- `isValidHeader()` — 매직넘버 0x53,0x43 + 범위 검증
- `kmeansCalibrate()` — K-means K=4 적응형 캘리브레이션 (최소 클러스터 거리 검증 포함)
- `reconstructFile()` — 수집된 프레임 맵 → 파일 바이트 배열 복원
- `computeHashPrefix()` — SHA-256 첫 2바이트 (Web Crypto API)

### 2. INIT_STATE.fileReceive 확장
- 기존: `{ phase, scriptVersion }` 2개 필드
- 추가: totalFrames, collectedCount, framesMap, loopCount, elapsedSec, validRate, speedKBs, calibrationStep, palette, fileData, fileHash, fileSizeKB, consecutiveMagic, totalProcessed, totalValid, lastFrameNum, errorMsg, sha256Full, hashMatch (18개 필드)

### 3. FileReceiveMain 전면 재작성
- **SETUP**: 소스 PC 안내 — 3종 스크립트 (전체/최소/WinForms) 코드 블록, 줄번호, 글자 수 표시
- **STANDBY**: 비디오 프리뷰 + "픽셀 격자 신호 대기 중" 오버레이 + 매직 감지 카운터
- **CALIBRATE**: 비디오 + 격자 오버레이 + 단계 인디케이터 (격자 감지 / 색상 학습)
- **RECEIVING**: 비디오(40%) + 프레임 맵(60%) — 수집/미수집/현재 셀 색상 구분, 범례
- **COMPLETE**: 체크 아이콘 + 파일 크기 + SHA-256 해시 + 무결성 배지 + 불일치 경고

### 4. FileReceiveSidebar 전면 재작성
- **SETUP**: 스크립트 버전 선택 (SegCtrl) + 버전 설명 + 장치 선택 + 수신 시작 버튼
- **STANDBY**: 실행 명령어 안내 + 전체 화면 안내 + 소스 PC 안내/수신 중단 버튼
- **CALIBRATE**: 2단계 인디케이터 (✓/◌) + 학습된 팔레트 4색 스와치 (실측 RGB + 경고 테두리)
- **RECEIVING**: 파일 정보 + 진행률 바 (90%+ 초록) + 실시간 통계 (통과율/속도/경과시간/남은시간) + 저품질 경고 배너
- **COMPLETE**: 파일 정보 + SHA-256 + 무결성 배지 + 전송 통계 + 다운로드/새 수신 버튼

### 5. 수신 파이프라인 (App 컴포넌트)
- `receiveRef` — mutable 수신 상태 (useRef)
- `processReceiveFrame()` — STANDBY/CALIBRATE/RECEIVING 3단계 분기 처리
  - STANDBY: 매직 바이트 스캔, 3연속 감지 시 CALIBRATE 전이
  - CALIBRATE: 10프레임 RGB 수집 → K-means → 학습 완료 시 RECEIVING 전이
  - RECEIVING: 프레임 디코딩 → 헤더 검증 → 중복 제거 → 속도 추적 → 완료 감지
- `completeReceive()` — 파일 복원 + SHA-256 검증 (Web Crypto API)
- `startReceive()` — 상태 초기화 + 비디오 연결 + 4fps 샘플링 인터벌
- `stopReceive()` — 인터벌 정리 + SETUP 복귀
- `downloadReceivedFile()` — Blob 생성 → 자동 다운로드 (transfer_YYYYMMDD_HHmmss.bin)
- `newReceive()` — 상태 완전 초기화

### 6. StatusBar 업데이트
- RECEIVING: "수신 중 (56/78)" + 속도 + 루프 횟수 + 남은 시간
- COMPLETE: "전송 완료 | 98.0 KB | 01:52 | SHA-256 검증 완료"

### 7. 키보드 단축키
- Escape (파일 수신 모드): STANDBY/CALIBRATE/RECEIVING에서 수신 중단

### 8. 라우팅 업데이트
- MainContent: FileReceiveMain에 stream/resolution/fps/dispatch 전달
- SidebarSwitch: FileReceiveSidebar에 onStartReceive/onStopReceive/onDownloadFile/onNewReceive 전달

## 검증 결과
- Node.js --check: 구문 오류 없음 ✅
- Playwright 로드: 0 JS 에러 ✅
- 파일 수신 탭 클릭: SETUP 화면 정상 렌더링 ✅
- 스크립트 버전 전환 (전체/최소/WinForms): 코드 블록 + 실행 명령어 정상 갱신 ✅
- VisualDecoder 모듈 검증: 격자/팔레트/매직/bytesPerFrame 정확 ✅
- nearestColor 검증: 4색 매핑 정확 ✅
- 기존 스크롤 캡처 탭: 정상 작동 ✅

## 파일 변경
- `index.html`: 1734줄 → 2702줄 (+968줄)
