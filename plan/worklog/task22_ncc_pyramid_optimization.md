# Task 22: NCC 매칭 피라미드 최적화 — 긴 문서 캡처 실패 해결

## 작업 시간
- 시작: 2026-03-10 KST
- 종료: 2026-03-10 KST

## 작업 대상
- `/index.html` — CaptureEngine 모듈 전면 교체 + captureFrame 개선

## 문제

수백 장 스크린샷이 필요한 긴 문서에서 두 가지 증상 발생:

| 증상 | 원인 |
|------|------|
| 스크롤 도중 매칭 실패 다수 발생 | NCC 브루트포스 연산이 프레임 간격(100ms)을 초과 |
| 결과 이미지 미생성 | 매칭 실패 누적 → 유효 스트립 부족 → 조립 실패 |

### 근본 원인: 브루트포스 NCC의 연산량

기존 `nccMatch`는 모든 가능한 shift 값을 순차 탐색:

```
1080p 기준:
  검색 범위: shift 4 ~ 648 (높이의 60%) = 644개 shift
  각 shift당 비교: 중앙 40% × 오버랩 높이 ≈ 57,000 픽셀
  총 연산: 644 × 57,000 ≈ 3,700만 연산
  예상 시간: ~370ms (JS 기준 ~100M ops/sec)
  프레임 간격: 100ms

  → 프레임 처리가 프레임 도착 속도의 3.7배 느림
  → 프레임 큐 누적 → 간격 증가 → 오버랩 감소 → NCC 저하 → 매칭 실패
```

---

## 변경 사항

### 1. 피라미드 NCC 매칭 (`nccMatch` 전면 재작성)

두 단계(Phase)로 분리하여 연산량을 대폭 감소:

#### Phase 1: Adaptive Search (힌트 기반 탐색)

이전 프레임의 `lastDeltaY`를 힌트로 활용. 스크롤 속도가 일정한 경우 대부분 여기서 해결됨.

```
조건: hintShift > 0 (두 번째 프레임부터)

1단계 — 거친 탐색:
  범위: [hint × 0.3, hint × 2.5]
  간격: step=2 (한 칸 건너)
  픽셀 샘플링: step=3 (9픽셀 중 1개)
  비교 영역: 가로 중앙 80% (양쪽 10% 제외)

2단계 — 정밀 탐색 (bestNCC ≥ 0.5일 때):
  범위: bestShift ± 4px
  간격: step=1 (전수)
  픽셀 샘플링: step=1 (전수)
  → 즉시 리턴 (Phase 2 생략)
```

**연산량 (hint=100px 가정):**
```
거친 탐색: (250-30)/2 = 110개 shift × ~6,400 샘플 = ~70만 연산
정밀 탐색: 9개 shift × ~57,000 픽셀 = ~51만 연산
합계: ~121만 연산 → ~12ms
```

#### Phase 2: Pyramid Fallback (Phase 1 실패 또는 첫 프레임)

이미지를 4배 축소한 뒤 전체 탐색, 결과를 원본 해상도로 복원:

```
1단계 — 다운샘플:
  1920×1080 → 480×270 (factor=4, area averaging)

2단계 — 축소 이미지 전체 탐색:
  범위: shift 1 ~ (축소 높이의 60%) = ~162개
  비교 영역: 축소 이미지의 중앙 80%
  픽셀 샘플링: step=1

3단계 — 원본 해상도 정밀 탐색:
  bestShift × 4 위치에서 ±8px (= 17개 shift)
  전체 픽셀 비교

4단계 — 저신뢰 보정 (bestNCC < 0.4이고 축소 NCC ≥ 0.3):
  ±16px로 확장 (= 33개 shift)
```

**연산량:**
```
다운샘플: 480×270 = ~13만 연산 (단순 합산)
축소 탐색: 162 × ~4,800 = ~78만 연산
정밀 탐색: 17 × ~57,000 = ~97만 연산
합계: ~188만 연산 → ~19ms
```

### 2. `_nccScore()` 헬퍼 추출

NCC 계수 계산을 독립 메서드로 분리 (DRY):

```
입력: prevData, currData, width, height, shift, isVert, stripX0, stripW, step
출력: NCC 계수 (-1 ~ +1)

계산:
  오버랩 영역에서 prev[shift+y][x] vs curr[y][x] 비교
  Pearson 상관계수 = cov(P,C) / sqrt(var(P) × var(C))
  샘플 수 < 20이면 -1 리턴 (신뢰 불가)
```

### 3. `downsample()` 메서드 추가

그레이스케일 이미지의 정수 배율 축소:

```
방식: area averaging (factor × factor 블록의 평균)
안전장치: 결과 크기가 16×16 미만이면 축소하지 않고 원본 리턴
```

### 4. `mergeStripsToBlob()` 단순화

기존의 feathered blending 코드 제거:
- **기존**: 스트립 경계마다 `getImageData`/`putImageData`로 전체 캔버스 읽기 → 2행 블렌딩 → 다시 쓰기
- **변경**: `putImageData`로 순차 배치만 수행
- **이유**: 2행 블렌딩의 시각적 효과가 미미한 반면, 큰 캔버스에서의 `getImageData` 비용이 과도

### 5. `assembleFinal` MAX_DIM 확대

```
16,000px → 32,000px
```

대부분의 최신 브라우저가 32768px 캔버스를 지원. 긴 문서 캡처 시 잘림 방지.

### 6. `captureFrame()` 개선

| 변경 | 기존 | 변경 후 |
|------|------|---------|
| NCC 호출 | `nccMatch(prev, curr, dir)` | `nccMatch(prev, curr, dir, cap.lastDeltaY)` |
| 신뢰도 임계치 | 0.5 | 0.4 |
| 연속 실패 복구 | 없음 | 15회 연속 실패 시 `prevGray` 리셋 + `lastDeltaY` 초기화 |
| deltaY 추적 | 없음 | 성공 시 `cap.lastDeltaY = result.deltaY` 저장 |

### 7. `captureRef` / `startCapture()` 업데이트

- `captureRef`에 `lastDeltaY: 0` 필드 추가
- `startCapture()`에서 `cap.lastDeltaY = 0`으로 초기화

---

## 현재 알고리즘 전체 흐름

### 전체 파이프라인

```
비디오 프레임 (10fps, 100ms 간격)
  │
  ├─ drawImage → 캔버스
  ├─ cropRect 적용 (있으면 해당 영역만 getImageData)
  ├─ toGray() → Uint8Array 그레이스케일
  │
  ├─ 첫 프레임? → prevGray로 저장 + 초기 스트립 → 리턴
  │
  ├─ 정지 감지: 200개 샘플 평균 차이 < 2 → 조용히 스킵
  │
  ├─ nccMatch(prevGray, currGray, direction, lastDeltaY)
  │   ├─ Phase 1: Adaptive (hint 기반, 좁은 범위, 거친→정밀)
  │   │   └─ NCC ≥ 0.5 → 즉시 리턴
  │   └─ Phase 2: Pyramid (4x 축소 → 전체탐색 → 원본 정밀)
  │       └─ 저신뢰 시 ±16px 확장
  │
  ├─ 결과: { deltaY, confidence }
  │   ├─ confidence < 0.4 또는 deltaY ≤ 0 → 실패
  │   │   └─ 15회 연속 → prevGray 리셋 (트래킹 재시작)
  │   └─ 성공 → 스트립 추출
  │
  ├─ getImageData(하단 deltaY 높이) → strip
  ├─ strips[] 에 push
  │   └─ 100개 도달 → mergeStripsToBlob() → chunks[]로 오프로드
  │
  ├─ lastDeltaY = deltaY, prevGray = currGray
  │
  └─ 메모리 ≥ 1500MB 또는 프레임 ≥ 2000 → 자동 정지
```

### NCC 매칭 상세

```
nccMatch(prevGray, currGray, direction, hintShift)
│
├─ 공통 설정
│   maxShift = 높이 × 0.6 (1080p → 648px)
│   minShift = 4
│   비교 영역 = 가로 중앙 80% (stripX0 = w×0.1, stripW = w×0.8)
│
├─ Phase 1: Adaptive Search
│   조건: hintShift > 0
│   │
│   ├─ 거친 탐색
│   │   범위: [hint×0.3, hint×2.5], step=2
│   │   _nccScore(..., step=3)  ← 9픽셀 중 1개만 샘플
│   │
│   └─ 정밀 탐색 (bestNCC ≥ 0.5)
│       범위: bestShift ± 4, step=1
│       _nccScore(..., step=1)  ← 전수 비교
│       → return { deltaY, confidence }
│
└─ Phase 2: Pyramid Fallback
    │
    ├─ downsample(prev, 4) + downsample(curr, 4)
    │   1920×1080 → 480×270
    │
    ├─ 축소 전체 탐색
    │   범위: 1 ~ 축소높이×0.6, step=1
    │   _nccScore(축소prev, 축소curr, ..., step=1)
    │
    ├─ 원본 정밀 탐색
    │   mapped = sBestShift × 4
    │   범위: mapped ± 8, step=1
    │   _nccScore(원본prev, 원본curr, ..., step=1)
    │
    └─ 저신뢰 보정 (bestNCC < 0.4 && sBestNCC ≥ 0.3)
        범위: mapped ± 16, step=1
        → return { deltaY, confidence }
```

### NCC 계수 계산 (`_nccScore`)

```
_nccScore(prevData, currData, w, h, shift, isVert, stripX0, stripW, step)

오버랩 영역 결정:
  수직: prev[shift..h] vs curr[0..h-shift], 너비 = stripW
  수평: prev[shift..w] vs curr[0..w-shift], 높이 = h

step 간격으로 샘플링하며 누적:
  sumP, sumC      — 픽셀값 합
  sumPP, sumCC    — 제곱합
  sumPC           — 교차곱

Pearson 상관계수:
  meanP = sumP/n,  meanC = sumC/n
  varP  = sumPP/n - meanP²
  varC  = sumCC/n - meanC²
  cov   = sumPC/n - meanP × meanC
  NCC   = cov / sqrt(varP × varC)

반환: NCC (-1 ~ +1), 샘플 < 20이면 -1
```

---

## 성능 비교 (1920×1080 기준)

### 변경 전 (브루트포스)

| 항목 | 값 |
|------|-----|
| 검색 shift 수 | 644개 (4 ~ 648) |
| shift당 비교 픽셀 | ~57,000 (중앙 40%, step=2) |
| 총 연산 | ~3,700만 |
| 예상 시간 | **~370ms** |
| 프레임 간격 | 100ms |
| **간격 대비** | **3.7배 초과** |

### 변경 후 (피라미드 + 적응형)

| 경로 | 조건 | 연산량 | 예상 시간 |
|------|------|--------|-----------|
| Phase 1 (adaptive) | 스크롤 속도 안정 | ~121만 | **~12ms** |
| Phase 1 (narrow hint) | hint 정확 | ~30만 | **~3ms** |
| Phase 2 (pyramid) | 첫 프레임 / Phase 1 실패 | ~188만 | **~19ms** |
| Phase 2 + 보정 | 저신뢰 | ~280만 | **~28ms** |

**최악의 경우에도 프레임 간격(100ms)의 28%만 사용.**

---

## 안전장치

| 메커니즘 | 조건 | 동작 |
|----------|------|------|
| 정지 프레임 스킵 | 200개 샘플 평균 차이 < 2 | 조용히 스킵 (실패 카운트 미증가) |
| Phase 1 조기 리턴 | NCC ≥ 0.5 | Phase 2 생략 → 연산 절약 |
| 연속 실패 복구 | 15회 연속 매칭 실패 | prevGray 리셋 + lastDeltaY 초기화 → 트래킹 재시작 |
| 저신뢰 확장 | Phase 2 NCC < 0.4, 축소 NCC ≥ 0.3 | 정밀 탐색 범위 ±8 → ±16 확장 |
| 메모리 자동 정지 | ≥ 1500MB | stopCapture() |
| 프레임 수 제한 | ≥ 2000프레임 | stopCapture() |
| 캔버스 크기 제한 | 최종 이미지 > 32000px | 잘림 (이전 16000px에서 확대) |
| Blob 오프로드 | 스트립 100개 누적 | mergeStripsToBlob → 메모리 해제 |

---

## CaptureEngine 메서드 요약

| 메서드 | 입력 | 출력 | 역할 |
|--------|------|------|------|
| `toGray(imageData)` | ImageData (RGBA) | `{data: Uint8Array, width, height}` | 그레이스케일 변환 (정수 가중합) |
| `downsample(gray, factor)` | 그레이스케일, 축소 배율 | 축소된 그레이스케일 | area averaging 다운샘플 |
| `_nccScore(pd, cd, w, h, shift, isVert, stripX0, stripW, step)` | 두 그레이스케일 + 파라미터 | NCC 계수 (-1~+1) | 단일 shift의 NCC 계산 |
| `nccMatch(prevGray, currGray, direction, hintShift)` | 이전/현재 프레임 + 힌트 | `{deltaY, confidence}` | 피라미드 NCC 매칭 |
| `extractStrip(canvas, ctx, videoEl, deltaY, direction)` | 캔버스 + deltaY | ImageData (스트립) | 새 콘텐츠 영역 추출 |
| `mergeStripsToBlob(strips, direction, callback)` | 스트립 배열 | Blob URL + 크기 | 스트립 합성 → Blob 오프로드 |
| `assembleFinal(chunks, strips, direction, onProgress, onComplete)` | 청크 + 잔여 스트립 | 최종 캔버스 | 전체 이미지 조립 (최대 32000px) |
| `estimateMemory(strips, chunks)` | 스트립/청크 배열 | 바이트 수 | 메모리 사용량 추정 |

---

## captureRef 상태 필드

| 필드 | 타입 | 용도 |
|------|------|------|
| `active` | boolean | 캡처 진행 중 여부 |
| `canvas` | HTMLCanvasElement | 프레임 그리기용 캔버스 |
| `ctx` | CanvasRenderingContext2D | 캔버스 컨텍스트 |
| `prevGray` | `{data, width, height}` | 이전 프레임 그레이스케일 |
| `strips` | ImageData[] | 누적된 새 콘텐츠 스트립 |
| `chunks` | `{url, width, height}[]` | Blob 오프로드된 청크 |
| `frameCount` | number | 성공 프레임 수 |
| `consecutiveFails` | number | 연속 매칭 실패 횟수 |
| `startTime` | number | 캡처 시작 시각 (ms) |
| `timerId` | number | setInterval ID (프레임 캡처) |
| `sampleIntervalId` | number | setInterval ID (UI 갱신) |
| `BLOB_THRESHOLD` | number | Blob 오프로드 임계치 (100) |
| `MAX_FRAMES` | number | 최대 프레임 수 (2000) |
| `MEMORY_AUTO_STOP` | number | 메모리 자동정지 (1500MB) |
| `lastDeltaY` | number | 이전 프레임의 스크롤량 (Phase 1 힌트) |
| `cropApplied` | boolean | 크롭 적용 여부 |

---

## 검증 상태

| 항목 | 결과 |
|------|------|
| JS 문법 검증 (Node.js `new Function`) | ✅ 통과 |
| LSP 진단 (biome) | ⚠️ biome 미설치 — 실행 불가 |
| 브라우저 런타임 테스트 | ⏳ 미실시 (HDMI 캡처카드 필요) |

## 향후 개선 가능 사항

| 항목 | 효과 | 복잡도 |
|------|------|--------|
| Web Worker로 NCC 오프로드 | 메인 스레드 블로킹 제거 | 높음 (아키텍처 변경) |
| 그레이스케일 버퍼 재사용 | GC 감소 | 낮음 |
| getImageData 통합 | 중복 호출 제거 | 중간 |
| WASM NCC 커널 | 10-50배 연산 가속 | 높음 |
