# Phase 1 Sub-Plan 1: 프레임 캡처 & 메모리 적재

> 상위 문서: [Phase1_ScrollCapture_Plan.md](./Phase1_ScrollCapture_Plan.md)

## 1. 개요

캡처카드로부터 수신되는 영상 프레임을 효율적으로 수집하고, 변화가 있는 프레임만 압축하여 메모리에 적재한다. 동시에 Web Worker에서 연속 프레임 간 오프셋을 실시간으로 계산하여 저장한다.

**입력:** 캡처카드 MediaStream (30fps, 1920x1080 또는 캡처카드 출력 해상도)
**출력:** JPEG Blob 배열 + 오프셋 배열 (캡처 종료 시점에 모두 준비 완료)

---

## 2. 전체 파이프라인

```
requestVideoFrameCallback (30fps 동기화)
|
+-- [1] 프레임 그래브: <video> -> 작업용 Canvas -> drawImage()
|
+-- [2] 변화 감지: 썸네일(80x45) 비교
|   +-- 변화 없음 -> 건너뜀
|   +-- 변화 있음 -> 다음 단계
|
+-- [3] JPEG 압축 & 저장: canvas.toBlob('image/jpeg', 0.90)
|   +-- Blob을 frames[] 배열에 push
|
+-- [4] Worker 오프셋 계산 요청
    +-- Worker 유휴 -> 프레임 쌍 전송 (Transferable)
    +-- Worker 작업 중 -> 대기 프레임 교체 (최신 유지)
    +-- Worker 결과 수신 -> offsets[] 배열에 push
```

---

## 3. 프레임 그래브

### 3.1 requestVideoFrameCallback

캡처카드가 실제로 새 프레임을 전달할 때마다 콜백이 발생한다. setInterval과 달리 비디오 프레임과 정확히 동기화된다.

```javascript
// 의사 코드
function onVideoFrame(now, metadata) {
  if (!isCapturing) return;

  // 작업용 Canvas에 현재 프레임 그리기
  captureCtx.drawImage(videoElement, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

  // 변화 감지 -> 저장 -> Worker 전송 (아래 섹션 참조)
  processFrame();

  // 다음 프레임 콜백 등록
  videoElement.requestVideoFrameCallback(onVideoFrame);
}
```

**폴백:** `requestVideoFrameCallback` 미지원 시 `requestAnimationFrame`으로 전환. 이 경우 동일 프레임이 여러 번 콜백될 수 있으므로, 변화 감지(섹션 4)에서 자연스럽게 걸러진다.

### 3.2 작업용 Canvas 해상도

캡처카드 원본(1920x1080)을 그대로 쓰면 처리 비용이 크다. **960x540으로 축소**하여 작업한다.

| 해상도 | 픽셀 수 | JPEG 크기 (추정) | 용도 |
|--------|---------|-----------------|------|
| 1920x1080 | 2,073,600 | ~200KB | 사용 안 함 |
| 960x540 | 518,400 | ~60-80KB | 캡처 & 스티칭 기본 해상도 |
| 480x270 | 129,600 | — | Worker 내 NCC 매칭용 축소 |
| 80x45 | 3,600 | — | 변화 감지 썸네일 |

---

## 4. 변화 감지 (중복 제거)

### 4.1 썸네일 비교

매 프레임마다 80x45 그레이스케일 썸네일을 생성하고, 직전 프레임 썸네일과 픽셀 차이의 평균을 계산한다.

```
thumbCanvas에 drawImage(captureCanvas, 0, 0, 80, 45)
thumbData = thumbCtx.getImageData(0, 0, 80, 45)

그레이스케일 변환:
  gray[i] = 0.299*R + 0.587*G + 0.114*B

차이 계산:
  diff = mean(|gray_current[i] - gray_previous[i]|)  for all i
```

### 4.2 판정 기준

```
diff < 3   -> 동일 프레임 (정지 상태), 건너뜀
diff >= 3  -> 변화 감지, 저장 대상
```

임계값 3은 MJPEG 압축 아티팩트의 프레임 간 노이즈(1~2)를 흡수하면서 실제 스크롤 변화(10 이상)를 놓치지 않는 값이다.

### 4.3 썸네일 캐싱

직전 프레임의 썸네일 그레이스케일 배열(3,600 bytes)만 유지한다. 프레임이 건너뛰어지면 썸네일도 갱신하지 않는다.

---

## 5. JPEG 압축 & 메모리 적재

### 5.1 압축 저장

변화가 감지된 프레임은 즉시 JPEG Blob으로 압축하여 배열에 저장한다.

```javascript
// 작업용 Canvas(960x540)에서 JPEG Blob 생성
captureCanvas.toBlob((blob) => {
  frames.push({
    blob: blob,            // JPEG Blob (~60-80KB)
    frameIndex: frameCount, // 프레임 순번
    timestamp: performance.now()
  });
  frameCount++;
}, 'image/jpeg', 0.90);
```

### 5.2 메모리 사용량

```
프레임당: ~80KB (JPEG, quality 0.90)
10초 캡처 (30fps, 50% 변화 감지 통과): ~150프레임 = ~12MB
30초 캡처: ~450프레임 = ~36MB
60초 캡처: ~900프레임 = ~72MB

1분 캡처해도 브라우저 메모리 한도 대비 충분히 작음.
```

### 5.3 프레임 수 상한

안전장치로 최대 **2,000프레임** (JPEG 기준 ~160MB)을 상한으로 설정한다. 도달 시:
- UI에 경고 표시
- 캡처 자동 종료
- 이미 저장된 프레임으로 조립 진행 가능

---

## 6. Web Worker 오프셋 계산

### 6.1 Worker 통신 구조

```
메인 스레드                              Web Worker
  |                                        |
  |-- 프레임 F1 저장 완료                   |
  |   Worker 유휴 확인                      |
  |-- postMessage({                        |
  |     type: 'computeOffset',             |
  |     prev: prevImageData.buffer,        |
  |     curr: currImageData.buffer,        |
  |     direction: 'vertical',             |
  |     frameIndex: 5                      |
  |   }, [prevBuffer, currBuffer])  ------->|-- 수신
  |                                        |-- 그레이스케일 변환
  |                                        |-- 50% 축소 (480x270)
  |                                        |-- 템플릿 분산 검사
  |                                        |-- NCC 2D 탐색
  |                                        |-- 결과 반환
  |<-- postMessage({                       |
  |      type: 'offsetResult',             |
  |      frameIndex: 5,                    |
  |      dx: 2, dy: 105,                   |
  |      confidence: 0.92,                 |
  |      success: true                     |
  |   }) ----------------------------------|
  |                                        |
  |-- offsets[5] = { dx:2, dy:105, ... }   |
```

### 6.2 Transferable 전송

ImageData의 ArrayBuffer를 **소유권 이전(Transferable)**으로 전송하여 복사 비용을 0으로 만든다.

```javascript
// 메인 -> Worker: 복사 없이 소유권 이전
const prevBuffer = prevImageData.data.buffer;
const currBuffer = currImageData.data.buffer;
worker.postMessage(
  { type: 'computeOffset', prev: prevBuffer, curr: currBuffer },
  [prevBuffer, currBuffer]  // Transferable 목록
);
// 이 시점에서 prevBuffer, currBuffer는 메인 스레드에서 접근 불가 (detached)
```

**주의:** Transferable 전송 후 원본 버퍼는 사용 불가(detached)가 된다. 따라서 JPEG Blob 저장은 Transferable 전송 **이전에** 완료해야 한다.

### 6.3 Worker 배압 조절

Worker는 한 번에 하나의 오프셋만 계산한다. 처리 속도에 맞춰 자연스럽게 프레임을 건너뛴다.

```
상태 변수:
  workerBusy = false
  pendingFrame = null       // Worker 작업 중 대기하는 최신 프레임
  lastSentFrame = null      // Worker에 마지막으로 보낸 프레임

프레임 저장 후:
  if (!workerBusy):
    Worker에 (lastSentFrame, currentFrame) 전송
    lastSentFrame = currentFrame
    workerBusy = true
  else:
    pendingFrame = currentFrame    // 이전 대기 프레임은 자연 폐기

Worker 결과 수신 후:
  offsets 배열에 결과 저장
  workerBusy = false
  if (pendingFrame != null):
    Worker에 (lastSentFrame, pendingFrame) 전송
    lastSentFrame = pendingFrame
    pendingFrame = null
    workerBusy = true
```

### 6.4 오프셋 계산 실패 처리

Worker가 매칭 실패(confidence < 0.85)를 반환하면:

```
offsets[frameIndex] = {
  dx: 0, dy: 0,
  confidence: 0.45,
  success: false           // 실패 표시
}
```

실패한 오프셋은 조립 단계에서 처리한다 (Sub-Plan 2 참조).

### 6.5 건너뛴 프레임의 오프셋

Worker 배압으로 건너뛴 프레임(예: F2)은 오프셋이 계산되지 않는다. 이 경우:
- offsets 배열에 해당 인덱스가 비어 있음
- 조립 단계에서 건너뛴 프레임은 제외하고, **실제로 오프셋이 계산된 프레임만** 사용하여 위치 맵을 구성한다.

따라서 frames 배열과 offsets 배열의 인덱스를 직접 대응시키지 않고, 오프셋 결과에 **프레임 인덱스 쌍(fromIndex, toIndex)**을 명시적으로 기록한다.

```javascript
offsets.push({
  fromIndex: 3,    // 이전 프레임 인덱스
  toIndex: 5,      // 현재 프레임 인덱스 (4는 건너뜀)
  dx: 2,
  dy: 210,         // F3→F5는 두 프레임 분량의 이동
  confidence: 0.88,
  success: true
});
```

---

## 7. NCC 매칭 알고리즘 상세

> Worker 내부에서 실행된다.

### 7.1 전처리

```
입력: prevBuffer (960x540 RGBA), currBuffer (960x540 RGBA)

1. 그레이스케일 변환
   gray[i] = 0.299*R + 0.587*G + 0.114*B
   결과: 960x540 단일 채널 배열 2개

2. 50% 축소 (2x2 평균)
   결과: 480x270 단일 채널 배열 2개

3. 이 축소 배열에서 NCC 매칭 수행
```

### 7.2 스트립 추출

```
세로 스크롤:
  이전 프레임(A)의 하단 20% 영역을 템플릿으로 사용
  템플릿 크기: 480 x 54 (축소 기준)

가로 스크롤:
  이전 프레임(A)의 우측 20% 영역을 템플릿으로 사용
  템플릿 크기: 96 x 270 (축소 기준)
```

### 7.3 템플릿 분산 검사

```
variance = SUM((T[i] - T_mean)^2) / pixel_count

if variance < 100:
  -> 저분산 템플릿 (균일 영역)
  -> 스트립 위치를 변경하여 재시도:
     1차: 하단 20% (기본)
     2차: 하단 30~50%
     3차: 하단 50~70%
  -> 모든 위치에서 저분산이면 매칭 실패(success=false) 반환
```

### 7.4 NCC 2D 탐색

```
세로 스크롤 기준:

주 방향(세로) 탐색 범위: 0 ~ (270 - 54) = 0 ~ 216  (전체)
부 방향(가로) 탐색 범위: -10 ~ +10 (21 위치)

총 탐색 위치: 217 x 21 = 4,557

각 위치 (sx, sy)에서:
  B의 영역 I = B[sx : sx+480, sy : sy+54]

  NCC(T, I) = SUM((T - T_mean)(I - I_mean))
              / sqrt(SUM((T - T_mean)^2) * SUM((I - I_mean)^2))

최대 NCC 값의 위치 (best_sx, best_sy)를 찾음
```

**가로 탐색 범위 +-10px 근거:**
축소 50% 기준 +-10px = 원본 기준 +-20px. 일반적인 마우스 휠 스크롤 중 가로 흔들림은 이 범위 내에 있다.

### 7.5 오프셋 환산

```
축소 기준 매칭 위치: (best_sx, best_sy)
원본 스케일 오프셋:
  dx = (best_sx - 0) * 2     // 가로 이동량 (부 방향)
  dy = (templateY_in_A - best_sy) * 2   // 세로 이동량 (주 방향)

세로 스크롤에서:
  templateY_in_A = 270 - 54 = 216 (축소 기준, A의 하단 스트립 시작 위치)
  dy = (216 - best_sy) * 2

  dy > 0: 아래로 스크롤
  dy < 0: 위로 스크롤 (역방향)
  dy ~ 0: 거의 이동 안 함
```

### 7.6 성능

```
탐색 위치: 4,557
위치당 연산: 480 x 54 = 25,920 곱셈+덧셈
총 연산: ~1.18억

Web Worker에서 순수 JS: 약 15~25ms
-> 초당 40~66프레임 처리 가능
-> 캡처카드 30fps를 충분히 소화
```

---

## 8. 캡처 종료 시 출력 데이터

캡처 종료 버튼 클릭 시, 다음 데이터가 준비되어 있다:

```javascript
// 1. 프레임 배열
frames = [
  { blob: Blob, frameIndex: 0, timestamp: 0 },
  { blob: Blob, frameIndex: 1, timestamp: 35 },
  { blob: Blob, frameIndex: 2, timestamp: 68 },
  ...
];

// 2. 오프셋 배열 (Worker가 실시간으로 계산한 결과)
offsets = [
  { fromIndex: 0, toIndex: 1, dx: 0, dy: 102, confidence: 0.93, success: true },
  { fromIndex: 1, toIndex: 3, dx: 1, dy: 215, confidence: 0.89, success: true },
  // toIndex:2는 건너뛴 경우 (Worker 배압)
  { fromIndex: 3, toIndex: 4, dx: -1, dy: -80, confidence: 0.91, success: true },
  // 역방향 스크롤 (dy 음수)
  ...
];

// 3. 메타데이터
captureInfo = {
  totalFrames: frames.length,
  totalOffsets: offsets.length,
  scrollDirection: 'vertical',
  captureResolution: { width: 960, height: 540 },
  duration: 15000  // ms
};
```

이 데이터를 Sub-Plan 2 (조립)에 전달한다.

---

## 9. 에러 처리

| 상황 | 감지 방법 | 대응 |
|------|----------|------|
| 캡처카드 연결 끊김 | MediaStream의 `ended` 이벤트 | 캡처 자동 종료, 에러 메시지 표시 |
| Worker 크래시 | Worker의 `error` 이벤트 | Worker 재생성, 오프셋 계산 재개 |
| 프레임 상한 도달 | frameCount >= 2000 | 캡처 자동 종료, 경고 표시 |
| toBlob 실패 | Blob이 null | 해당 프레임 건너뜀, 경고 카운트 증가 |
| 연속 매칭 실패 | offsets에서 success=false 연속 5회 | UI에 경고 ("스크롤이 너무 빠르거나 화면 변화가 큽니다") |

---

*최종 수정일: 2026-02-27*
