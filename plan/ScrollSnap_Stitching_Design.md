# ScrollSnap 스크롤 캡처 스티칭 설계 문서

> **문서 버전**: 1.0  
> **대상 코드**: `/index.html` — `CaptureEngine` 객체 + `App` 내 캡처 파이프라인  
> **최종 수정**: 2026-03-11  
> **현재 매칭 알고리즘**: Row SAD (Sum of Absolute Differences)

---

## 1. 개요

### 1.1 목적

HDMI 캡처카드로 수신한 외부 PC 화면을 **사용자가 수동으로 스크롤**하는 동안 프레임을 캡처하고, 겹치는 영역을 제거한 뒤 하나의 긴 이미지로 조립(stitching)한다.

### 1.2 제약 조건

| 제약 | 영향 |
|------|------|
| 소스 PC에 소프트웨어 설치 불가 | 자동 스크롤 불가 — 사용자 수동 스크롤에 의존 |
| 역방향 통신 불가 (단방향 HDMI) | 스크롤 속도/위치 피드백 불가 — 캡처 측이 수동적으로 관찰만 해야 함 |
| 브라우저 환경 (Web API만 사용) | Canvas 크기 제한, 메모리 제한, 싱글 스레드 |
| 캡처카드 입력 (MJPEG/YUV) | 압축 아티팩트 존재 — 픽셀 단위 완벽 매칭 불가능 |

### 1.3 설계 목표

| 목표 | 기준 |
|------|------|
| 매칭 정확도 | 캡처카드 노이즈 하에서 confidence ≥ 0.85 유지 |
| 처리 속도 | 프레임 간격(100ms) 이내 매칭 완료 |
| 메모리 효율 | 수천 프레임 캡처 시에도 브라우저 크래시 방지 |
| 견고성 | 페이지 전환, 스크롤 멈춤, 반복 패턴에서도 동작 |

---

## 2. 알고리즘 진화 이력

| 버전 | 매칭 방식 | 문제점 | 참조 |
|------|-----------|--------|------|
| v1 (task14) | NCC 브루트포스 | 1080p에서 ~370ms/프레임 → 100ms 간격 초과 | `worklog/task14` |
| v2 (task22) | Pyramid NCC (4x 축소 + 적응형) | ~19ms로 개선. 그러나 NCC는 HDMI 캡처카드 노이즈에 과민 반응하는 경향 | `worklog/task22` |
| **v3 (현재)** | **Row SAD + 힌트 탐색** | 현행. 단순하고 빠르며 노이즈에 강건 | 본 문서 |

---

## 3. 전체 파이프라인

### 3.1 상태 머신

```
IDLE ──[캡처카드 연결]──▶ READY ──[캡처 시작]──▶ CAPTURING ──[캡처 종료]──▶ ASSEMBLING ──▶ RESULT
  ▲                        ▲                                                                 │
  └── [장치 분리] ◀─────────┘◀───────────────── [새 캡처 시작] ◀──────────────────────────────┘
```

| Phase | 진입 조건 | 수행 작업 | 종료 조건 |
|-------|-----------|-----------|-----------|
| `IDLE` | 캡처카드 미연결 | 장치 폴링 (2초 간격) | 장치 감지 시 READY |
| `READY` | 미디어 스트림 활성 | 비디오 프리뷰, 크롭 영역 설정 | 캡처 시작 버튼 / Space |
| `CAPTURING` | `startCapture()` 호출 | 100ms 간격 프레임 샘플링 + 매칭 + 스트립 추출 | 수동 종료 / Esc / 자동 정지 |
| `ASSEMBLING` | `stopCapture()` 호출 | chunks + strips → 최종 Canvas 조립 | 조립 완료 |
| `RESULT` | 조립 완료 | 결과 표시, PNG 자동 다운로드 | 새 캡처 시작 |

### 3.2 데이터 흐름

```
비디오 프레임 (MediaStream, ~30fps)
       │
       ▼
  ┌─ captureFrame() ─────────────────────────────────── (10fps, 100ms 간격) ─┐
  │                                                                          │
  │  ① drawImage(video → canvas)                                             │
  │  ② getImageData(cropRect 적용)  ← 크롭은 캡처 시점에 적용                   │
  │  ③ toGray(imageData) → currGray {data: Uint8Array, width, height}        │
  │  ④ 정지 감지: 200샘플 평균 diff < 2 → skip                                │
  │  ⑤ rowMatch(prevGray, currGray, direction, hintDeltaY)                   │
  │       → { deltaY, confidence }                                           │
  │  ⑥ 성공 시: 스트립 추출 (하단/우측 deltaY px)                               │
  │  ⑦ strips[] 누적, 100개마다 mergeStripsToBlob → chunks[]                  │
  │  ⑧ prevGray = currGray, lastDeltaY = deltaY                             │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘
       │
       ▼ (캡처 종료)
  assembleFinal(chunks, strips, direction)
       │
       ▼
  최종 Canvas (width × totalHeight, max 32,000px)
```

---

## 4. 핵심 모듈: CaptureEngine

### 4.1 그레이스케일 변환 — `toGray(imageData)`

```
입력: ImageData (RGBA, 4 bytes/pixel)
출력: { data: Uint8Array, width: number, height: number }

변환 공식: gray = (R×77 + G×150 + B×29) >> 8
  → ITU-R BT.601 가중치의 정수 근사 (0.299, 0.587, 0.114)
  → 비트 시프트로 나눗셈 대체 (성능 최적화)

목적: 비교 연산량을 RGBA(4채널) → Gray(1채널)로 1/4 감소
```

### 4.2 Row SAD 매칭 — `rowMatch(prevGray, currGray, direction, hintDeltaY)`

이전 프레임 하단(또는 우측)의 특징적인 행(열)이 현재 프레임에서 어디에 위치하는지 찾아 **스크롤 변위(deltaY)**를 산출한다.

#### 4.2.1 원리

```
이전 프레임 (prevGray)              현재 프레임 (currGray)
┌────────────────────────┐         ┌────────────────────────┐
│                        │         │ ░░░░░░░░░░░░░░░░░░░░░░ │
│                        │         │ ░░░░ 새 콘텐츠 ░░░░░░░ │  ← deltaY 높이
│                        │         │ ░░░░░░░░░░░░░░░░░░░░░░ │
│ ══════════════════════ │         │ ══════════════════════ │
│ ▓▓▓ refRow (3행) ▓▓▓▓ │ ──찾기─▶│ ▓▓▓ bestRow (3행) ▓▓▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │         │                        │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │         │                        │
└────────────────────────┘         └────────────────────────┘
        ▲ refRow 위치                      ▲ bestRow 위치

deltaY = refRow - bestRow = 스크롤된 픽셀 수
```

#### 4.2.2 상수 및 파라미터

| 상수 | 값 | 역할 |
|------|-----|------|
| `REF_ROWS` | 3 | 참조로 사용할 연속 행 수 — 1행은 노이즈에 취약, 3행이면 충분히 robust |
| `BAIL_PER_PIXEL` | 30 | 행 단위 early-exit 임계값. 한 픽셀 평균 SAD 30 초과 시 불일치로 판단 |
| `MIN_VARIANCE` | 100 | 참조 행의 최소 픽셀 분산. 균일한 행(흰 배경 등)을 참조점에서 제외 |
| `x0` | `width × 0.1` | 비교 시작점 — 좌측 10% 마진 제외 (UI 요소, 스크롤바 등 회피) |
| `cmpW` | `width × 0.8` | 비교 폭 — 중앙 80%만 비교 |

#### 4.2.3 알고리즘 단계

**Step 1 — Distinctive Reference Row 탐색**

이전 프레임 하단에서 위쪽으로 스캔하며 **분산이 충분한 3개 연속 행**을 찾는다.

```
목적: 흰 배경, 단색 영역 등 어디서든 매칭될 수 있는 uniform row를 피한다.

탐색 방향: 하단 → 상단 (checkY = h - REF_ROWS - 4 부터 0까지)
샘플링: 매 8픽셀 (속도 최적화)
분산 계산: variance = E[x²] - E[x]²
통과 조건: variance > MIN_VARIANCE (100)

결과: refRow = 분산 조건을 만족하는 첫 행의 Y좌표
      refRow < 0 이면 → 전체 프레임이 균일 → 매칭 불가 → { deltaY: 0, confidence: 0 }
```

**Step 2A — Phase 1: 힌트 기반 좁은 범위 탐색** (hintDeltaY > 0일 때)

이전 프레임의 deltaY를 힌트로 활용하여 탐색 범위를 축소한 뒤, 그 범위 내에서 SAD 매칭을 수행한다.

**Step 2A-1: 탐색 범위 결정 (시작점 축소)**

```
조건: 이전 프레임에서 이미 deltaY를 알고 있을 때 (두 번째 프레임부터)

예측 위치: hintY = refRow - hintDeltaY
  → 이전 프레임에서 refRow가 현재 프레임의 hintY 위치에 있을 것으로 예측

탐색 범위: [hintY - span, hintY + span]
  span = max(10, hintDeltaY × 0.3)  — 예측 위치 ±30%

예) hintDeltaY=100 → hintY=refRow-100, span=30 → 60개 위치만 탐색
예) hintDeltaY=30  → hintY=refRow-30,  span=10 → 20개 위치만 탐색

이 단계는 "어디를 탐색할지"만 정한다. 실제 비교는 다음 단계에서 수행한다.
```

**Step 2A-2: SAD 매칭 수행**

```
축소된 범위 내에서 각 후보 위치(y)에 대해 refRow 3행과의 SAD를 계산한다.

탐색 방향: hMax → hMin (아래 → 위, 가장 작은 deltaY를 우선 발견)

각 후보 위치 y에서:
  for r = 0..2 (REF_ROWS=3):
    for x = x0..x0+cmpW:
      rowSAD += |prev[refRow+r][x] - curr[y+r][x]|
      if rowSAD > rowBail → bail (이 위치는 불일치, 다음 y로)
    totalSAD += rowSAD

  bail 없이 3행 모두 통과 → 이 y가 매칭 위치 (bestRow = y)
  → 즉시 반환, 추가 탐색 없음

반환: { deltaY: refRow - bestRow, confidence: max(0, min(1, 1 - avgSAD/20)) }

매칭 성공 시 Phase 2를 건너뛴다.
범위 내 모든 위치가 bail → Phase 1 실패 → Phase 2로 진행.
```

**Step 2B — Phase 2: Full Search** (Phase 1 실패 또는 첫 프레임)

```
탐색 범위: maxY(= refRow - 4) → 0
탐색 방향: 아래 → 위 (가장 가까운 매치 우선)

SAD 계산 및 Early Exit: Phase 1과 동일

반환: 첫 valid match의 { deltaY, confidence }

주의: 반복 패턴(표, 코드 등)에서 먼 위치의 false match를 방지하기 위해
      bottom-to-top 탐색으로 최소 deltaY를 우선 채택
```

#### 4.2.4 수직/수평 대칭

| 항목 | 수직 (vertical) | 수평 (horizontal) |
|------|-----------------|-------------------|
| Reference 탐색 위치 | 하단 행(row) | 우측 열(column) |
| SAD 비교 단위 | 행 기반 (좌→우) | 열 기반 (상→하) |
| 비교 범위 마진 | 좌우 10% 제외 | 상하 10% 제외 |
| deltaY 의미 | 수직 스크롤 픽셀 | 수평 스크롤 픽셀 |
| 스트립 추출 | 하단 deltaY px | 우측 deltaY px |

수평 모드의 코드 구조는 수직 모드의 완전한 대칭이며, `isVert` 플래그로 분기한다.

#### 4.2.5 Confidence 점수

```
avgSAD = bestSAD / (cmpW × REF_ROWS)
confidence = clamp(1 - avgSAD / 20, 0, 1)
```

| avgSAD 범위 | Confidence | UI 표시 | 해석 |
|-------------|-----------|---------|------|
| 0 ~ 2 | 0.90 ~ 1.00 | 우수 (emerald) | 거의 완벽한 매칭 |
| 2 ~ 3 | 0.85 ~ 0.90 | 양호 (sky) | 양호한 매칭 |
| 3 ~ 6 | 0.70 ~ 0.85 | 주의 (amber) | 캡처카드 노이즈 수준 |
| 6 ~ 20 | 0.00 ~ 0.70 | 위험 (red) | 매칭 신뢰도 낮음 |
| > 20 | 0 | — | 매칭 실패 |

### 4.3 스트립 추출

매칭 성공 시, 현재 프레임에서 **이전 프레임과 겹치지 않는 새로운 영역만** 추출한다.

```
수직 스크롤:
  stripH = min(deltaY, 프레임높이)
  strip = getImageData(cx, cy + ch - stripH, cw, stripH)
  → 크롭 영역 하단 stripH 픽셀

수평 스크롤:
  stripW = min(deltaY, 프레임너비)
  strip = getImageData(cx + cw - stripW, cy, stripW, ch)
  → 크롭 영역 우측 stripW 픽셀
```

### 4.4 메모리 관리 — Blob 오프로드

```
조건: strips.length >= BLOB_THRESHOLD (100)

처리:
  1. strips[] 전체를 임시 Canvas에 putImageData로 합성
  2. canvas.toBlob() → PNG 압축된 Blob 생성
  3. URL.createObjectURL(blob) → chunks[]에 { url, width, height } 저장
  4. strips[] 초기화 → 원본 ImageData GC 대상

메모리 추정 (estimateMemory):
  strips: width × height × 4 (RGBA raw)
  chunks: width × height × 0.5 (압축 추정)
```

### 4.5 최종 조립 — `assembleFinal(chunks, strips, direction, onProgress, onComplete)`

```
┌─────────────────────────────────────────────────────┐
│  1. 잔여 strips → mergeStripsToBlob → 마지막 chunk   │
│  2. 모든 chunk blob URL → new Image() → onload 대기  │
│  3. 전체 크기 계산 (MAX_DIM = 32,000px 적용)          │
│  4. 최종 Canvas 생성 → drawImage() 순차 배치          │
│  5. chunk blob URL 해제 (revokeObjectURL)            │
│  6. onComplete({ canvas, width, height }) 호출        │
└─────────────────────────────────────────────────────┘
```

---

## 5. 캡처 파이프라인 (App 레벨)

### 5.1 상태 관리

캡처 상태는 React 렌더링 외부의 `useRef`로 관리한다 (`captureRef`).

| 필드 | 타입 | 초기값 | 역할 |
|------|------|--------|------|
| `active` | boolean | false | 캡처 진행 중 플래그 |
| `canvas` | HTMLCanvasElement | null | 프레임 그리기용 (첫 프레임에서 생성) |
| `ctx` | CanvasRenderingContext2D | null | canvas 컨텍스트 (`willReadFrequently: true`) |
| `prevGray` | {data, width, height} | null | 이전 프레임 그레이스케일 |
| `strips` | ImageData[] | [] | 누적된 새 콘텐츠 스트립 |
| `chunks` | {url, width, height}[] | [] | Blob 오프로드된 청크 |
| `frameCount` | number | 0 | 성공 프레임 수 |
| `consecutiveFails` | number | 0 | 연속 매칭 실패 횟수 |
| `startTime` | number | 0 | 캡처 시작 시각 (Date.now()) |
| `timerId` | number | null | 경과 시간 갱신 setInterval ID (1초) |
| `sampleIntervalId` | number | null | 프레임 샘플링 setInterval ID (100ms) |
| `BLOB_THRESHOLD` | number | 100 | Blob 오프로드 스트립 수 임계치 |
| `MAX_FRAMES` | number | 2000 | 최대 캡처 프레임 수 |
| `MEMORY_AUTO_STOP` | number | 1500 | 메모리 자동 정지 임계치 (MB) |
| `lastDeltaY` | number | 0 | 이전 프레임의 스크롤량 (Phase 1 힌트) |
| `cropApplied` | boolean | false | 크롭 영역 적용 여부 |

### 5.2 `startCapture()`

```
1. captureRef 필드 초기화 (active=true, canvas/prevGray/strips/chunks 리셋)
2. SC_UPDATE dispatch → phase='CAPTURING', 카운터 리셋
3. 50ms 후 videoRef.srcObject 설정 (CAPTURING 뷰의 video 엘리먼트에 연결)
4. setInterval(1초) → 경과 시간 갱신
5. setInterval(100ms) → captureFrame() 호출 (~10fps)
```

### 5.3 `captureFrame()`

```
1. 활성 체크: cap.active && video.readyState >= 2
2. Canvas 초기화: 첫 프레임 시 video 크기로 canvas 생성
3. drawImage: video → canvas
4. 크롭 적용: ocrTarget='manual'이면 cropRect의 X/Y/W/H로 getImageData 범위 제한
5. toGray: 그레이스케일 변환
6. 첫 프레임: prevGray 저장 + 전체 프레임을 초기 스트립으로 push → return
7. 정지 감지: 200개 등간격 샘플의 평균 |diff| < 2 → 조용히 return (실패 아님)
8. rowMatch: SAD 매칭 수행
9. 매칭 실패 (deltaY ≤ 0):
   - consecutiveFails++
   - 15회 연속 → prevGray = currGray, lastDeltaY = 0 (트래킹 재시작)
   - 진단 로그 출력 (brute-force best match 위치 등)
   - return
10. 매칭 성공:
    - 스트립 추출 (getImageData)
    - strips[]에 push
    - consecutiveFails = 0
    - 100개 도달 시 mergeStripsToBlob → chunks[]
    - 메모리 체크
    - ≥1500MB 또는 ≥2000프레임 → stopCapture()
11. lastDeltaY = deltaY, prevGray = currGray
```

### 5.4 `stopCapture()`

```
1. cap.active = false
2. clearInterval(timerId), clearInterval(sampleIntervalId)
3. SC_UPDATE dispatch → phase='ASSEMBLING'
4. assembleFinal(chunks, strips, direction, onProgress, onComplete)
5. onComplete → SC_UPDATE dispatch → phase='RESULT', resultCanvas 설정
6. strips/chunks/prevGray 정리
```

### 5.5 자동 동작

- **결과 생성 시 자동 PNG 다운로드** + 클립보드 복사 (Effect 8)
- **풀스크린 자동 종료**: ASSEMBLING 또는 RESULT 진입 시

---

## 6. 안전장치

| 메커니즘 | 조건 | 동작 |
|----------|------|------|
| 정지 프레임 스킵 | 200개 샘플 평균 diff < 2 | 조용히 return (실패 카운트 미증가) |
| Early Exit | 행 SAD > rowBail | 해당 위치 즉시 건너뜀 → 탐색 성능 대폭 향상 |
| 힌트 기반 탐색 | hintDeltaY > 0 | ±30% 범위만 탐색 → Phase 2 생략 가능 |
| Distinctive Row 필터 | variance < MIN_VARIANCE | uniform 행 참조점 제외 → false match 방지 |
| Bottom-to-top 탐색 | — | 반복 패턴에서 최소 deltaY 우선 채택 → false match 방지 |
| 연속 실패 복구 | 15회 연속 매칭 실패 | prevGray 리셋 + lastDeltaY 초기화 (트래킹 재시작) |
| 메모리 자동 정지 | ≥ 1500MB | stopCapture() |
| 프레임 수 제한 | ≥ 2000프레임 | stopCapture() |
| Blob 오프로드 | 100개 스트립 누적 | mergeStripsToBlob → ImageData 해제 |
| Canvas 크기 제한 | > 32,000px | 잘림 적용 (브라우저 한계) |

---

## 7. 성능 분석

### 7.1 Row SAD 매칭 연산량 (1920×1080 기준)

| 경로 | 조건 | 탐색 위치 수 | 위치당 연산 | 총 연산 | 예상 시간 |
|------|------|-------------|-----------|---------|-----------|
| Phase 1 (hint 정확) | 첫 위치에서 매칭 | 1 | 3행 × 1536px = 4,608 | ~4,600 | **< 0.1ms** |
| Phase 1 (hint ±30%) | span=30 | ~60 | 4,608 (대부분 early exit) | ~10만 | **~1ms** |
| Phase 2 (full scan) | 첫 프레임 | ~max refRow | 4,608 (대부분 early exit) | ~50만 | **~5ms** |

**Early Exit 효과**: 불일치 위치는 평균 10-20픽셀 비교 후 bail → 실질 연산량은 이론값의 1-5%

### 7.2 vs 이전 NCC 방식

| 항목 | NCC 브루트포스 (v1) | Pyramid NCC (v2) | **Row SAD (v3, 현재)** |
|------|-------------------|------------------|----------------------|
| 프레임당 시간 | ~370ms | ~12-28ms | **~1-5ms** |
| 프레임 간격 대비 | 370% (초과) | 12-28% | **1-5%** |
| 노이즈 내성 | 중간 | 중간 | **높음** (절대값 차이 기반) |
| 반복 패턴 내성 | 낮음 (anti-periodic 필요) | 중간 | **높음** (bottom-to-top 최소 delta 우선) |
| 구현 복잡도 | 중간 | 높음 (다운샘플 + 2-phase) | **낮음** |

### 7.3 메모리 프로파일 (1920×1080 연속 캡처 기준)

```
1 스트립 (평균 deltaY=50px):
  1920 × 50 × 4 bytes = 384 KB

100 스트립 (BLOB_THRESHOLD 도달):
  384 KB × 100 = 38.4 MB (raw) → Blob 압축 후 ~10-15 MB

1000 프레임 (10 chunks):
  chunks: ~100-150 MB (Blob storage)
  strips: 0-38 MB (현재 배치)
  기타: prevGray ~2 MB, canvas ~8 MB
  합계: ~120-200 MB
```

---

## 8. 알려진 제한 사항 및 잠재적 문제

### 8.1 구조적 제한

| 항목 | 현상 | 원인 | 영향 |
|------|------|------|------|
| 메인 스레드 블로킹 | captureFrame() 실행 중 UI 응답 지연 가능 | Web Worker 미사용, 모든 연산이 메인 스레드 | 현재 SAD가 충분히 빠라 실용적 문제는 적음 |
| Canvas 크기 제한 | 32,000px 초과 시 하단 잘림 | 브라우저 Canvas 스펙 제한 | 매우 긴 문서에서 후반부 누락 가능 |
| 단일 getImageData | 매 프레임 전체 영역 픽셀 복사 | 크롭 적용 시에도 drawImage 후 getImageData | 2회 메모리 복사 (video→canvas, canvas→ImageData) |

### 8.2 알고리즘 취약점

| 항목 | 현상 | 원인 |
|------|------|------|
| 균일 콘텐츠 | refRow을 찾지 못해 매칭 실패 | 전체 프레임이 흰색/단색인 경우 variance < MIN_VARIANCE |
| 매우 빠른 스크롤 | 겹치는 영역이 없어 매칭 실패 | 프레임 간 오버랩 0 → 참조 행이 현재 프레임에 없음 |
| 수평 UI 변동 | SAD 증가로 confidence 저하 | 스크롤바 위치 변화, 커서 깜빡임 등 (중앙 80%로 어느 정도 완화) |
| 연속 실패 후 재시작 | 누락 구간 발생 | 15회 실패 후 prevGray 리셋 → 중간 콘텐츠 소실 |

### 8.3 스트립 추출 관련

| 항목 | 현상 | 원인 |
|------|------|------|
| 크롭 시 스트립 추출 좌표 | 크롭 영역 기준으로 정확히 추출되는지 | captureFrame에서 cx/cy/cw/ch를 기반으로 직접 getImageData 호출 |
| 첫 프레임 처리 | 전체 imgData를 strips[0]에 push | 첫 프레임은 매칭 없이 전체를 초기 스트립으로 사용 |

---

## 9. CaptureEngine 메서드 요약

| 메서드 | 시그니처 | 역할 |
|--------|----------|------|
| `toGray` | `(imageData) → {data, width, height}` | RGBA → 8bit 그레이스케일 (BT.601) |
| `rowMatch` | `(prevGray, currGray, direction, hintDeltaY) → {deltaY, confidence}` | Row SAD 매칭 — 스크롤 변위 계산 |
| `extractStrip` | `(canvas, ctx, videoEl, deltaY, direction) → ImageData` | 새 콘텐츠 영역 추출 |
| `mergeStripsToBlob` | `(strips, direction, callback) → void` | 스트립 배열 → Blob URL 변환 |
| `assembleFinal` | `(chunks, strips, direction, onProgress, onComplete) → void` | 최종 이미지 조립 |
| `estimateMemory` | `(strips, chunks) → number` | 메모리 사용량 추정 (bytes) |

---

## 10. 설정 파라미터

| 파라미터 | 위치 | 기본값 | 설명 |
|----------|------|--------|------|
| 프레임 샘플링 간격 | `startCapture()` setInterval | 100ms (~10fps) | 캡처 프레임 속도 |
| `BLOB_THRESHOLD` | `captureRef` | 100 | Blob 오프로드 트리거 스트립 수 |
| `MAX_FRAMES` | `captureRef` | 2000 | 자동 정지 프레임 상한 |
| `MEMORY_AUTO_STOP` | `captureRef` | 1500 (MB) | 자동 정지 메모리 상한 |
| `REF_ROWS` | `rowMatch` 내부 | 3 | 참조 행 수 |
| `BAIL_PER_PIXEL` | `rowMatch` 내부 | 30 | early-exit 픽셀당 SAD 임계값 |
| `MIN_VARIANCE` | `rowMatch` 내부 | 100 | 참조 행 최소 분산 |
| 비교 영역 | `rowMatch` 내부 | 중앙 80% | 좌우(또는 상하) 10% 마진 제외 |
| 연속 실패 리셋 | `captureFrame` 내부 | 15회 | prevGray 교체 트리거 |
| 정지 감지 임계값 | `captureFrame` 내부 | avg diff < 2 | 정지 프레임 skip 기준 |
| MAX_DIM | `assembleFinal` 내부 | 32,000px | 최종 Canvas 최대 크기 |

---

## 부록 A. 코드 위치 참조

| 구성 요소 | 파일 | 줄 범위 (대략) |
|-----------|------|---------------|
| `CaptureEngine` 객체 | `index.html` | 203 ~ 572 |
| `CaptureEngine.toGray` | `index.html` | 209 ~ 218 |
| `CaptureEngine.rowMatch` | `index.html` | 224 ~ 410 |
| `CaptureEngine.extractStrip` | `index.html` | 413 ~ 426 |
| `CaptureEngine.mergeStripsToBlob` | `index.html` | 429 ~ 460 |
| `CaptureEngine.assembleFinal` | `index.html` | 463 ~ 558 |
| `CaptureEngine.estimateMemory` | `index.html` | 561 ~ 571 |
| `captureRef` 정의 | `index.html` | 3297 ~ 3313 |
| `captureFrame()` | `index.html` | 3555 ~ 3693 |
| `startCapture()` | `index.html` | 3695 ~ 3741 |
| `stopCapture()` | `index.html` | 3743 ~ 3792 |
| INIT_STATE.scrollCapture | `index.html` | 999 |
