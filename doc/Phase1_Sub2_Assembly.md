# Phase 1 Sub-Plan 2: 이미지 조립 (Assembly)

> 상위 문서: [Phase1_ScrollCapture_Plan.md](./Phase1_ScrollCapture_Plan.md)

## 1. 개요

캡처 단계에서 수집된 JPEG Blob 배열과 오프셋 배열을 입력으로 받아, 하나의 연속된 문서 이미지를 생성한다. 사용자가 자유롭게 스크롤한 경우(역방향, 좌우 왔다갔다)도 정상적으로 처리한다.

**입력:**
- `frames[]`: JPEG Blob 배열 (캡처 순서대로)
- `offsets[]`: 프레임 쌍별 오프셋 배열 `{ fromIndex, toIndex, dx, dy, confidence, success }`
- `captureInfo`: 해상도, 스크롤 방향 등 메타데이터

**출력:** 하나의 완성된 문서 이미지 (Canvas -> PNG/JPEG Blob)

---

## 2. 조립 파이프라인

```
[1] 오프셋 체인 구성
    offsets 배열에서 유효한(success=true) 것만 추출하여 프레임 연결 체인 구성

[2] 절대 위치 맵 생성
    오프셋을 누적하여 각 프레임의 절대 좌표 (x, y) 계산

[3] 중복 영역 분석 & 사용 프레임 선정
    같은 영역을 여러 프레임이 덮는 경우 대표 프레임 선정

[4] 결과 Canvas 크기 결정
    전체 범위(minX, minY, maxX, maxY)에서 Canvas 크기 산출

[5] 프레임 디코딩 & 그리기
    JPEG Blob을 하나씩 디코딩하여 결과 Canvas에 그림

[6] 경계 블렌딩
    이어붙인 경계에서 선형 블렌딩 적용

[7] 크롭 & 출력
    실제 콘텐츠 영역만 크롭하여 최종 이미지 생성
```

---

## 3. 오프셋 체인 구성

### 3.1 유효 오프셋 필터링

```
유효 조건:
  - success == true
  - confidence >= 0.85

유효하지 않은 오프셋은 체인에서 제외한다.
제외된 구간의 프레임은 최종 이미지에 포함되지 않는다.
```

### 3.2 체인 구성

오프셋 배열은 `(fromIndex, toIndex)` 쌍으로 구성되어 있다. 이를 연결 리스트처럼 이어서 **프레임 체인**을 만든다.

```
예시:
  offsets: F0->F1, F1->F3, F3->F4, F4->F5, F5->F8

  체인: F0 - F1 - F3 - F4 - F5 - F8

  F2, F6, F7은 체인에 포함되지 않음 (건너뛴 프레임)
  -> 해당 JPEG Blob은 조립에서 사용하지 않음
```

### 3.3 체인 단절 처리

오프셋 실패로 체인이 끊어지는 경우:

```
offsets: F0->F1(성공), F1->F2(실패), F2->F3(성공), F3->F4(성공)

체인 1: F0 - F1           (F1->F2 실패로 단절)
체인 2: F2 - F3 - F4      (F2부터 새 체인 시작)

-> 두 체인은 독립적으로 조립
-> 가장 긴 체인의 결과를 최종 이미지로 사용
-> 또는 모든 체인의 결과를 개별 이미지로 제공 (사용자 선택)
```

---

## 4. 절대 위치 맵 생성

### 4.1 오프셋 누적

체인의 첫 프레임을 원점(0, 0)으로 놓고, 이후 프레임은 오프셋을 누적하여 절대 좌표를 계산한다.

```
positions = []
positions[chain[0]] = { x: 0, y: 0 }

for i = 1 to chain.length - 1:
  offset = getOffset(chain[i-1], chain[i])
  positions[chain[i]] = {
    x: positions[chain[i-1]].x + offset.dx,
    y: positions[chain[i-1]].y + offset.dy
  }
```

### 4.2 자유 스크롤 예시

```
사용자가 아래로 스크롤 -> 위로 되돌림 -> 다시 아래로:

F0: (0, 0)
F1: (0, 100)       아래로
F2: (0, 200)       아래로
F3: (0, 300)       아래로
F4: (0, 220)       위로 되돌림 (dy = -80)
F5: (0, 140)       위로 되돌림 (dy = -80)
F6: (0, 240)       다시 아래로 (dy = +100)
F7: (0, 340)       다시 아래로 (dy = +100)
F8: (0, 440)       다시 아래로 (dy = +100)

최종 이미지 범위: y = 0 ~ (440 + 540) = 0 ~ 980
F4, F5는 F1~F3과 겹치는 영역 -> 중복 처리 필요
```

### 4.3 음수 좌표 정규화

스크롤이 시작점보다 위(또는 왼쪽)로 갈 수 있다.

```
positions:
  F0: (0, 0)
  F1: (0, -100)     위로 스크롤 (시작점보다 위)
  F2: (-20, -200)   왼쪽 위로

정규화:
  minX = -20, minY = -200
  모든 좌표에서 (minX, minY)를 빼서 양수로 변환:

  F0: (20, 200)
  F1: (20, 100)
  F2: (0, 0)
```

---

## 5. 중복 영역 분석 & 사용 프레임 선정

사용자가 왔다갔다 스크롤하면 같은 영역을 여러 프레임이 덮는다.

### 5.1 처리 전략: 시간순 덮어쓰기

가장 단순하고 효과적인 방법: **나중에 캡처된 프레임이 이전 프레임을 덮어쓴다.**

```
결과 Canvas에 프레임을 체인 순서(= 시간순)로 그린다.
같은 영역을 덮는 프레임이 있으면, 나중 프레임의 픽셀이 최종 결과에 남는다.
```

이 방식의 장점:
- 구현이 매우 단순 (순서대로 drawImage)
- 나중 프레임이 일반적으로 더 최신 상태를 반영
- 블렌딩 없이도 자연스러운 결과

### 5.2 불필요 프레임 사전 제거 (최적화)

중복 영역이 많으면 (왔다갔다 스크롤) 불필요한 디코딩 & 그리기를 줄일 수 있다.

```
"완전히 덮이는" 프레임 판별:

for each frame F in chain (시간 역순):
  F의 영역이 이미 "커버된 영역"에 완전히 포함되면:
    -> F를 제거 (그려도 결국 나중 프레임에 덮임)
  else:
    -> "커버된 영역"에 F의 영역을 추가

이 최적화는 선택적이며, 기본 구현에서는 생략해도 된다.
```

---

## 6. 결과 Canvas 크기 결정

### 6.1 전체 범위 계산

```
정규화된 positions에서:
  maxX = max(pos.x + frameWidth for all frames in chain)
  maxY = max(pos.y + frameHeight for all frames in chain)

결과 Canvas 크기:
  width = maxX
  height = maxY
```

### 6.2 Canvas 크기 제한

브라우저별 Canvas 최대 크기:

| 브라우저 | 최대 면적 | 최대 단일 차원 |
|----------|----------|---------------|
| Chrome | ~268M 픽셀 | 32,767px |
| Firefox | ~124M 픽셀 | 32,767px |
| Safari | ~67M 픽셀 | 16,384px |

```
if (width > 32000 || height > 32000):
  분할 저장 모드 진입 (섹션 8 참조)

if (width * height > 250_000_000):
  분할 저장 모드 진입
```

---

## 7. 프레임 디코딩 & 그리기

### 7.1 순차 디코딩

JPEG Blob을 하나씩 ImageBitmap으로 디코딩하여 Canvas에 그린다. 한 번에 하나만 디코딩하므로 메모리 사용이 일정하다.

```javascript
// 의사 코드
async function assembleImage(frames, positions, chain) {
  const canvas = createCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext('2d');

  for (const frameIndex of chain) {
    const frame = frames[frameIndex];
    const pos = positions[frameIndex];

    // JPEG Blob -> ImageBitmap (비동기 디코딩)
    const bitmap = await createImageBitmap(frame.blob);

    // 결과 Canvas에 절대 위치로 그리기
    ctx.drawImage(bitmap, pos.x, pos.y);

    // ImageBitmap 즉시 해제
    bitmap.close();

    // 진행률 업데이트
    updateProgress(frameIndex / chain.length * 100);
  }

  return canvas;
}
```

### 7.2 성능 추정

```
createImageBitmap: ~1-3ms per frame (JPEG 80KB, 960x540)
drawImage: ~0.5ms per frame
총: ~2-4ms per frame

300프레임: 0.6 ~ 1.2초
```

캡처 중 Worker가 이미 오프셋을 계산해 두었으므로, **조립 단계는 순수 그리기 작업만** 수행한다. 따라서 매우 빠르다.

### 7.3 진행률 표시

조립 진행률을 UI에 표시한다.

```
진행률 = (처리된 프레임 수 / 체인 내 총 프레임 수) * 100%
```

비동기 루프(`for...of` + `await`)를 사용하므로, 매 프레임 사이에 UI 업데이트가 가능하다. 필요시 `requestAnimationFrame` 또는 `setTimeout(0)`으로 yield한다.

---

## 8. 경계 블렌딩

### 8.1 기본 전략: 선형 블렌딩

인접 프레임이 겹치는 영역에서 경계선이 눈에 띄지 않도록 블렌딩한다.

```
겹침 영역에서 블렌딩 (blendSize = 16px):

세로 스크롤의 경우, 이전 프레임의 하단과 현재 프레임의 상단이 겹침:

  for y = 0 to blendSize:
    alpha = y / blendSize    // 0.0 -> 1.0
    resultPixel = prevPixel * (1 - alpha) + currPixel * alpha
```

### 8.2 구현 방식

Canvas의 `globalCompositeOperation`과 그래디언트 마스크를 조합하여 블렌딩을 구현한다. 픽셀 단위 조작보다 Canvas API를 활용하는 것이 빠르다.

```javascript
// 의사 코드: 그래디언트 마스크 블렌딩
function drawWithBlending(ctx, bitmap, pos, overlapSize) {
  // 1. 겹치지 않는 영역은 그대로 그리기
  // 2. 겹치는 영역만 그래디언트 알파로 그리기

  ctx.save();

  // 겹침 영역에 그래디언트 마스크 적용
  const gradient = ctx.createLinearGradient(
    pos.x, pos.y,
    pos.x, pos.y + overlapSize
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(255,255,255,1)');

  // globalCompositeOperation으로 블렌딩
  // ... (구현 세부사항)

  ctx.restore();
}
```

### 8.3 블렌딩 적용 조건

- 겹침 영역이 blendSize(16px) 이상일 때만 적용
- 겹침이 너무 작으면 (16px 미만) 단순 덮어쓰기
- 블렌딩은 선택적 기능으로, 성능 문제 시 비활성화 가능

---

## 9. 분할 저장

결과 이미지가 Canvas 최대 크기를 초과하는 경우.

### 9.1 분할 전략

```
세로로 긴 문서의 경우:
  최대 높이 = 30,000px로 분할

  이미지 1: y = 0 ~ 30,000
  이미지 2: y = 29,500 ~ 59,500   (500px 겹침으로 연속성 확인 가능)
  이미지 3: y = 59,000 ~ 80,000   (마지막)

각 분할 이미지를 별도 파일로 다운로드:
  document_001.png, document_002.png, document_003.png
```

### 9.2 구현

```javascript
// 의사 코드
function assembleWithSplit(frames, positions, chain, maxHeight) {
  const results = [];
  let currentY = 0;

  while (currentY < totalHeight) {
    const segmentHeight = Math.min(maxHeight, totalHeight - currentY);
    const segmentCanvas = createCanvas(totalWidth, segmentHeight);
    const ctx = segmentCanvas.getContext('2d');

    // 이 세그먼트 범위에 해당하는 프레임만 그리기
    for (const frameIndex of chain) {
      const pos = positions[frameIndex];
      if (pos.y + frameHeight > currentY && pos.y < currentY + segmentHeight) {
        const bitmap = await createImageBitmap(frames[frameIndex].blob);
        ctx.drawImage(bitmap, pos.x, pos.y - currentY);
        bitmap.close();
      }
    }

    results.push(segmentCanvas);
    currentY += maxHeight - 500;  // 500px 겹침
  }

  return results;
}
```

---

## 10. 최종 출력

### 10.1 크롭

결과 Canvas에서 실제 콘텐츠가 있는 영역만 크롭한다. (사전 할당 크기 > 실제 콘텐츠)

```
크롭 영역:
  x: 0
  y: 0
  width: maxX (정규화된 최대 X + frameWidth)
  height: maxY (정규화된 최대 Y + frameHeight)
```

### 10.2 다운로드

```javascript
// Canvas -> Blob -> 다운로드
canvas.toBlob((blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scroll_capture_${timestamp}.png`;
  a.click();
  URL.revokeObjectURL(url);
}, 'image/png');
// 또는 'image/jpeg' 선택 시 quality 0.92 적용
```

### 10.3 파일 정보 표시

```
파일명: scroll_capture_20260227_143052.png
크기: 2,450 x 8,320 px
파일 용량: 4.2 MB
캡처 프레임 수: 280 / 사용 프레임 수: 245
조립 소요 시간: 1.2초
```

---

## 11. 에러 처리

| 상황 | 감지 방법 | 대응 |
|------|----------|------|
| 모든 오프셋 실패 | 유효 오프셋 0개 | "매칭 가능한 프레임이 없습니다" 메시지, 조립 중단 |
| 체인 단절 | 연속 실패 구간 존재 | 가장 긴 체인으로 조립, 단절 위치 표시 |
| Canvas 크기 초과 | 계산된 크기 > 제한 | 분할 저장 자동 전환 |
| createImageBitmap 실패 | 디코딩 에러 | 해당 프레임 건너뜀, 빈 영역으로 남김 |
| 메모리 부족 | Canvas 생성 실패 | 해상도를 50%로 낮춰 재시도 |

---

*최종 수정일: 2026-02-27*
