# Task 14: [6.3] 스크롤 캡처 + 스티칭 코어 + 메모리 관리

## 작업 시간
- 시작: 2026-03-01 03:05 KST
- 종료: 2026-03-01 03:20 KST

## 작업 대상
- `/index.html` — 984줄 → 1734줄 (+750줄)

## 작업 내용

### 1. CaptureEngine 모듈 (~220줄)

#### 1.1 NCC 프레임 매칭 (`nccMatch`)
- 입력: 이전/현재 프레임의 그레이스케일 축소 이미지
- 중앙 40% 너비 스트립에서 NCC(Normalized Cross-Correlation) 계산
- 2픽셀 간격 샘플링으로 성능 최적화
- 최대 50% 높이까지 shift 검색 (기존 70%에서 축소 — 불필요한 원거리 탐색 제거)
- 최소 shift 2 (전체 스케일 4px) — 노이즈성 미세 이동 무시
- **Anti-periodic 로직**: 전역 최대 NCC를 찾은 후, 그 NCC의 95% 이상인 shift 중 가장 작은 것을 채택. 표/반복 패턴에서 주기적으로 높은 NCC가 나오는 문제를 방지
- 신뢰도 임계치 0.5 미만이면 매칭 실패 처리 (기존 0.3에서 상향)
- 반환: `{ deltaY, confidence }` (전체 스케일 픽셀)

#### 1.2 그레이스케일 축소 (`toGrayHalf`)
- ImageData를 50% 축소 + 그레이스케일 변환
- 메모리 절약 + NCC 연산 속도 향상

#### 1.3 스트립 추출 (`extractStrip`)
- deltaY에 기반해 현재 프레임 하단에서 새 콘텐츠 크롭
- 세로/가로 방향 모두 지원

#### 1.4 Blob 오프로딩 (`mergeStripsToBlob`)
- 스트립 100장마다 canvas에 합성 → `toBlob()` → Blob URL 저장
- 원본 ImageData는 즉시 해제

#### 1.5 최종 조립 (`assembleFinal`)
- chunk Blob URL들을 Image로 로드
- 남은 스트립도 마지막 chunk로 합성
- 캔버스 최대 높이 16,000px 제한 적용
- 진행률 콜백 지원

#### 1.6 메모리 추정 (`estimateMemory`)
- 스트립: width × height × 4 (RGBA)
- Chunk: width × height × 0.5 (압축 보정)

### 2. 상태 확장

#### INIT_STATE.scrollCapture 확장 필드:
- `elapsedSec`, `frameCount`, `matchQuality`, `consecutiveFails`
- `memoryMB`, `assembleProgress`, `chainLength`, `excludedFrames`
- `resultCanvas`, `resultWidth`, `resultHeight`
- `pngSizeKB`, `jpegSizeKB`

### 3. CAPTURING 상태 UI

#### 메인 영역:
- 실시간 비디오에 빨간 테두리(`border-2 border-red-500`)
- REC 표시 (좌상단, 빨간 원 깜빡임 + "REC" + 경과 시간)
- 해상도/FPS 오버레이 (좌하단)

#### 사이드바:
- "캡처 중" 헤더 (빨간 원 애니메이션)
- 경과 시간 (`text-2xl font-bold font-mono`)
- 캡처 프레임 수 (`text-2xl font-bold font-mono`)
- 매칭 품질 게이지 (프로그레스 바 + 수치 + 라벨)
  - 0.90+ emerald (우수), 0.85+ sky (양호), 0.70+ amber (주의), 0.70- red (위험)
- 연속 실패 경고 (5회 이상)
- 프레임 상한 경고 (1800 이상)
- 메모리 경고 (500MB+, 1GB+)
- "캡처 종료" 버튼 (Esc 단축키)

### 4. ASSEMBLING 상태 UI

#### 메인 영역:
- "이미지 조립 중..." 제목
- 프로그레스 바 (60% 너비, 파란색)
- 퍼센트 표시 + 처리 현황
- 체인 길이 표시

#### 사이드바:
- 캡처 정보 (총 프레임, 캡처 시간, 스크롤 방향)
- 조립 정보 (유효 체인, 제외 프레임)
- 취소 버튼

### 5. RESULT 상태 UI

#### 메인 영역 (`ResultViewer` 컴포넌트):
- 줌 툴바 (-, 퍼센트, +, 맞춤, 원본)
- 이미지 뷰어 (스크롤 가능, 줌 지원)
- 맞춤 모드: `object-fit: contain`
- 줌 모드: 10-400% 범위, 10% 단위

#### 사이드바:
- 결과 헤더
- 이미지 정보 (크기, 사용 프레임, PNG/JPEG 예상 크기)
- 체인 단절 경고 (제외 프레임 > 0인 경우)
- PNG 다운로드 버튼 (Primary)
- JPEG 다운로드 버튼 (Secondary)
- 새 캡처 시작 버튼

### 6. 캡처 파이프라인 (App 내)

- `captureRef` — 캡처 상태를 useRef로 관리 (React 렌더 외부)
- `startCapture()` — 초기화, 100ms 간격 프레임 샘플링(~10fps), 1초 타이머
- `captureFrame()` — 비디오 프레임 → **크롭 영역 적용** → NCC 매칭 → 스트립 추출 → Blob 오프로딩 → 메모리 체크
  - **크롭은 캡처 시점에 적용**: cropRect의 X/Y/W/H 네 값을 모두 적용하여, 브라우저 크롬(주소창, 북마크바, 독)이 매 프레임에서 제외됨
  - 스트립 추출도 크롭된 영역 기준으로 수행 (다운로드 시 별도 크롭 불필요)
  - 신뢰도 0.5 미만 또는 deltaY ≤ 0이면 매칭 실패 처리 (프레임 스킵)
- `stopCapture()` — 인터벌 정리, ASSEMBLING 전환, 최종 조립 시작
- `cancelAssemble()` — ASSEMBLING 취소 → READY 복귀

### 7. 키보드 단축키
- `Space` — 캡처 시작/종료 토글 (스크롤 캡처 모드에서)
- `Escape` — 캡처 종료 / 조립 취소

### 8. 상태바 개선
- CAPTURING: "캡처 중 (N 프레임)" (빨간색)
- ASSEMBLING: "조립 중 (N%)"
- RESULT: "완료"

### 9. 다운로드 헬퍼 (`downloadCanvas`)
- canvas → Blob → URL → `<a>` download trick
- PNG/JPEG 선택 가능
- 파일명: `scroll_capture_YYYYMMDD_HHmmss.{png|jpg}`

## 검증 결과 (Playwright)

| 항목 | 결과 |
|------|------|
| 페이지 로드 | ✅ JS 에러 없음 |
| 스크롤 캡처 탭 (IDLE) | ✅ 장치 연결 안내 표시, 장치 감지 |
| 파일 수신 탭 | ✅ 정상 |
| 텍스트 캡처 탭 | ✅ OCR 배지 정상 |
| 블록 텍스트 탭 | ✅ 역방향 경고 정상 |
| 설정 탭 | ✅ 정상 |
| 상태바 | ✅ 모드별 동적 라벨 |

## 비고
- CAPTURING/ASSEMBLING/RESULT UI는 물리 캡처카드 없이는 실제 동작 테스트 불가
- Playwright 환경에서 디바이스는 감지되지만 getUserMedia 스트림이 실제로 동작하지 않아 IDLE 상태 유지
- NCC 알고리즘은 50% 축소 그레이스케일에서 중앙 40% 스트립만 사용하여 성능 최적화
- NCC 검색 범위는 50% (기존 70%에서 축소), 최소 shift 2 (전체 스케일 4px), anti-periodic 로직 적용
- NCC 신뢰도 임계치는 0.5 (기존 0.3에서 상향)
- 크롭 영역은 캡처 시점에 적용 (기존: 다운로드 시에만 적용 → 버그 원인이었음)
- 자동 중단: 메모리 1.5GB 또는 프레임 2,000개 도달 시
- Canvas 최대 높이: 16,000px 제한 (향후 멀티 세그먼트 확장 가능)
