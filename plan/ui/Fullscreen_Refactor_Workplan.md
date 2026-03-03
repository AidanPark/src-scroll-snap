# 전체화면 모드 리팩토링 작업계획서

> 작성일: 2026-03-03
> 관련: ScrollSnap_Fullscreen_Mode_Proposal.md

---

## 1. 문제 정의

### 현재 동작 (잘못됨)

전체화면 버튼 클릭 시 `document.documentElement.requestFullscreen()`을 호출하여 **브라우저 자체**가 전체화면 모드로 전환된다.

```
[전체화면 버튼 클릭]
  → document.documentElement.requestFullscreen()
  → 브라우저가 OS 수준 전체화면 진입 (태스크바/탭바 숨김)
  → fullscreenchange 이벤트로 isFullscreen = true
  → 앱 UI 변경
```

- 브라우저 탭바, OS 태스크바가 사라짐
- Escape 키가 브라우저 전체화면 해제에 먹힘 (앱에서 사용 불가)
- 사용자가 원한 것이 아님

### 원하는 동작

브라우저는 그대로 두고, **앱 내부 레이아웃만 변경**한다.

```
[전체화면 버튼 클릭]
  → dispatch({ type: 'SET_FULLSCREEN', v: true })
  → 앱 내부 상태만 변경
  → 헤더, 사이드바, 상태바 숨김
  → 비디오가 브라우저 뷰포트(앱 영역)를 꽉 채움
  → 플로팅 아이콘이 비디오 위에 오버레이
```

- 브라우저 탭바, OS 태스크바 그대로 유지
- Escape 키를 앱에서 자유롭게 사용 가능
- Fullscreen API 사용하지 않음

### 비교

| 항목 | 현재 (브라우저 전체화면) | 목표 (앱 내부 전체화면) |
|------|----------------------|----------------------|
| 트리거 | `requestFullscreen()` | `dispatch SET_FULLSCREEN` |
| 브라우저 탭바 | 숨겨짐 | **유지** |
| OS 태스크바 | 숨겨짐 | **유지** |
| Escape 키 | 브라우저가 가로챔 | **앱에서 사용 가능** |
| 비디오 영역 | OS 화면 전체 | 브라우저 뷰포트(앱 영역) 전체 |
| 상태 감지 | `fullscreenchange` 이벤트 | 앱 state (`isFullscreen`) |

---

## 2. 변경 범위

### 2.1 제거할 코드

| 대상 | 위치 | 이유 |
|------|------|------|
| `useFullscreen` 훅 | ~line 928 | Fullscreen API 연동 로직 전체 삭제 |
| `document.documentElement.requestFullscreen()` | 키보드 핸들러 (~line 4147) | 브라우저 전체화면 호출 제거 |
| `document.exitFullscreen()` | 키보드 핸들러, FsExitButton | 브라우저 전체화면 해제 제거 |
| `fullscreenchange` 이벤트 리스너 | `useFullscreen` 훅 내부 | 불필요 |
| `document.fullscreenElement` 체크 | `canEnterFullscreen`, 키보드 핸들러 | 불필요 |
| `document.documentElement.requestFullscreen` 지원 체크 | `canEnterFullscreen` | 불필요 |

### 2.2 수정할 코드

| 대상 | 현재 | 목표 |
|------|------|------|
| **`canEnterFullscreen()`** | `requestFullscreen` API 지원 체크 포함 | API 체크 제거, 모드/상태만 체크 |
| **`shouldAutoExitFullscreen()`** | 변경 없음 (로직은 동일) | 그대로 유지 |
| **`FullscreenOverlay`** | `useFullscreen(d)` 훅 사용 | 훅 없이 직접 타이머 관리 |
| **`FsExitButton`** | `fs.toggleFullscreen()` (Fullscreen API) | `dispatch({ type: 'SET_FULLSCREEN', v: false })` |
| **키보드 `F` 핸들러** | `requestFullscreen()` / `exitFullscreen()` | `dispatch SET_FULLSCREEN` 토글 |
| **키보드 `Escape` 핸들러** | 브라우저에 위임 (가로챌 수 없음) | **앱에서 직접 처리** — 전체화면 해제 |
| **자동 해제 `useEffect`** | `document.exitFullscreen()` 호출 | `dispatch SET_FULLSCREEN false` |

### 2.3 새로 추가/재작성할 코드

| 대상 | 내용 |
|------|------|
| **오버레이 타이머 로직** | `useFullscreen` 훅 대신 `FullscreenOverlay` 내부에서 직접 `useState` + `setTimeout`으로 자동숨김 관리 |

---

## 3. 작업 단계

### Step 1: `useFullscreen` 훅 제거 및 대체

**삭제**: `useFullscreen` 함수 전체 (~line 928-966)

**대체**: `FullscreenOverlay` 내부에서 타이머 로직을 직접 관리

```javascript
// FullscreenOverlay 내부
var overlayTimerRef = useRef(null);
var _ov = useState(true);
var isOverlayVisible = _ov[0];
var setOverlayVisible = _ov[1];

function resetOverlayTimer() {
  setOverlayVisible(true);
  clearTimeout(overlayTimerRef.current);
  overlayTimerRef.current = setTimeout(function() {
    setOverlayVisible(false);
  }, 3000);
}
```

### Step 2: `canEnterFullscreen` 수정

```javascript
// Before
function canEnterFullscreen(state) {
  if (!document.documentElement.requestFullscreen) return false;  // ← 제거
  ...
}

// After
function canEnterFullscreen(state) {
  var mode = state.mode;
  if (mode === MODES.SC) {
    var phase = state.scrollCapture.phase;
    return phase === 'READY' || phase === 'CAPTURING';
  }
  if (mode === MODES.BT) {
    var phase = state.blockText.phase;
    return phase === 'MONITORING' || phase === 'PROCESSING';
  }
  return false;
}
```

### Step 3: `FsExitButton` 수정

```javascript
// Before: props.onClick → fs.toggleFullscreen() → document.exitFullscreen()
// After:  props.onClick → dispatch SET_FULLSCREEN false
```

### Step 4: `FullscreenOverlay` 수정

- `useFullscreen(d)` 훅 호출 제거
- 타이머 로직을 컴포넌트 내부로 인라인
- `fs.toggleFullscreen()` → `dispatch SET_FULLSCREEN false`
- `fs.resetOverlayTimer()` → 로컬 `resetOverlayTimer()`
- `fs.isOverlayVisible` → 로컬 `isOverlayVisible`

### Step 5: 키보드 핸들러 수정 (`onKey` 함수)

```javascript
// F 키: Before
if (document.fullscreenElement) {
  document.exitFullscreen();
} else if (canEnterFullscreen(state)) {
  document.documentElement.requestFullscreen();
}

// F 키: After
if (state.isFullscreen) {
  dispatch({ type: 'SET_FULLSCREEN', v: false });
} else if (canEnterFullscreen(state)) {
  dispatch({ type: 'SET_FULLSCREEN', v: true });
}
```

```javascript
// Escape 키: 새로 추가 (전체화면 모드일 때)
if (e.code === 'Escape' && state.isFullscreen) {
  e.preventDefault();
  dispatch({ type: 'SET_FULLSCREEN', v: false });
  return;  // 다른 Escape 동작 무시
}
```

### Step 6: 자동 해제 `useEffect` 수정

```javascript
// Before
useEffect(function() {
  if (state.isFullscreen && shouldAutoExitFullscreen(state)) {
    if (document.fullscreenElement) {
      document.exitFullscreen();  // ← 브라우저 전체화면 해제
    }
  }
});

// After
useEffect(function() {
  if (state.isFullscreen && shouldAutoExitFullscreen(state)) {
    dispatch({ type: 'SET_FULLSCREEN', v: false });  // ← 앱 상태만 변경
  }
});
```

### Step 7: 전체화면 해제 후 캡처 진행 중 토스트 (`prevFullscreenRef`)

```javascript
// 이 로직은 유지. fullscreenchange 이벤트 의존 없이 state.isFullscreen 변화만 감지하므로 수정 불필요.
```

---

## 4. 영향받지 않는 코드

| 코드 | 이유 |
|------|------|
| `FullscreenButton` | `props.onClick` 콜백만 호출, 내부 로직 없음. App에서 전달하는 onClick만 변경하면 됨 |
| `FsStatusBadge` | state만 읽음, Fullscreen API 의존 없음 |
| `FsActionButton` | state만 읽음, Fullscreen API 의존 없음 |
| `VideoPreview` / `BlockTextMain` | `isFullscreen` prop으로 CSS만 전환, API 의존 없음 |
| `shouldAutoExitFullscreen()` | 순수 state 체크, API 의존 없음 |
| `FS` 디자인 토큰 | CSS 클래스만 정의, API 의존 없음 |
| `INIT_STATE`, `reducer` | `isFullscreen` boolean, API 의존 없음 |

---

## 5. 검증 항목

- [ ] `node --check` JS 문법 검증
- [ ] `requestFullscreen` / `exitFullscreen` / `fullscreenElement` / `fullscreenchange` 텍스트가 코드에 남아있지 않음
- [ ] `useFullscreen` 함수가 완전히 제거됨
- [ ] F 키로 앱 내부 전체화면 토글 동작
- [ ] Escape 키로 앱 내부 전체화면 해제 동작
- [ ] 전체화면 진입 시 헤더/사이드바/상태바 숨김, 비디오 뷰포트 꽉 채움
- [ ] 전체화면 해제 시 원래 레이아웃 복귀
- [ ] 플로팅 아이콘 3개 (나가기, 상태뱃지, 액션버튼) 정상 표시
- [ ] 자동 숨김 타이머 동작 (3초 후 fade-out)
- [ ] CAPTURING 시 REC 뱃지 + 종료 버튼 항상 표시
- [ ] 자동 해제 조건 (ASSEMBLING, 장치 끊김) 정상 동작
- [ ] 캡처 중 전체화면 해제 시 토스트 표시

---

## 6. 기획문서 수정 필요 사항

`ScrollSnap_Fullscreen_Mode_Proposal.md`에서 Fullscreen API 관련 내용을 앱 내부 전체화면으로 변경해야 한다:

- §2.4 "Fullscreen API 사용" → 삭제 또는 "앱 내부 상태 토글"로 대체
- §2.2 해제 방법에서 "브라우저 Fullscreen API 기본 동작으로 해제" → "앱에서 직접 해제"
- §6 상태 전이도에서 "Fullscreen API" 언급 제거
- §8.2 "Escape는 전체화면 해제만 수행 (브라우저 제약)" → "Escape로 전체화면 해제 (앱 제어)"
- §9.2 "Fullscreen API 미지원" → 해당 없음 (삭제)
- §부록 B 주석에서 API 언급 제거
