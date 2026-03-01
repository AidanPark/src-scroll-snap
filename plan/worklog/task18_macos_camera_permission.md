# Task 18: macOS 카메라 권한 버그 수정

## 작업 시간
- 시작: 2026-03-01 10:30 KST
- 종료: 2026-03-01 11:15 KST

## 문제 상황

macOS Chrome에서 HDMI 캡처카드를 연결해도 화면에 아무것도 표시되지 않는 버그 발생.

### 근본 원인

macOS Chrome의 `enumerateDevices()` API는 카메라 권한이 부여되기 전에도 비디오 입력 장치 목록을 반환하지만, `deviceId`가 빈 문자열(`""`)로 제공됨.

```
기존 코드 흐름:
1. Effect 1: enumerateDevices() → 장치 감지됨 (deviceId: "")
2. Effect 2: if (!deviceId) return → 빈 문자열은 falsy → getUserMedia 호출 안됨
3. getUserMedia가 호출되지 않음 → macOS 카메라 권한 다이얼로그 미표시
4. 권한 다이얼로그 없음 → 영원히 "장치 대기 중" 상태
```

이는 **닭과 달걀 문제(chicken-and-egg problem)**:
- `getUserMedia()`를 호출해야 권한 다이얼로그가 표시됨
- 권한이 있어야 실제 `deviceId`를 받을 수 있음
- 하지만 `deviceId`가 없으면 `getUserMedia()`를 호출하지 않음

### 사용자 증거

1. macOS 시스템 설정 → 카메라: Chrome이 목록에 없음 (getUserMedia 미호출 증거)
2. Chrome DevTools Console: Tailwind CDN 경고만 있고, `getUserMedia failed:` 메시지 없음

## 수정 내용

### 1. INIT_STATE 확장 (device 상태)

```javascript
device: {
  connected: false,
  resolution: '',
  fps: 0,
  needsPermission: false,   // 새로 추가
  permissionDenied: false    // 새로 추가
}
```

### 2. Effect 1 (enumerate) 수정

빈 `deviceId`를 가진 장치가 감지되면 `needsPermission: true` 플래그를 설정하여 권한 요청 UI를 표시하도록 변경.

```javascript
// 빈 deviceId 감지 → 권한 필요 상태로 전환
var hasEmptyId = videoDevices.some(function(d) { return !d.deviceId; });
if (hasEmptyId && !permissionRequested.current) {
  dispatch({ type: 'DEVICE', v: { needsPermission: true } });
  return;
}
```

### 3. requestCameraPermission() 함수 추가

사용자가 "카메라 접근 허용" 버튼을 클릭하면:
1. `getUserMedia({ video: true })` 호출 → OS 권한 다이얼로그 표시
2. 권한 부여 시: 임시 스트림 해제 → `enumerateDevices()` 재호출 → 실제 deviceId 획득
3. 권한 거부 시: `permissionDenied: true` 상태로 전환

### 4. 3개 모드 모두 권한 UI 추가

| 모드 | 컴포넌트 | 변경 내용 |
|------|----------|----------|
| 스크롤 캡처 | ScrollCaptureMain | IDLE 단계에 3개 서브 상태 추가 |
| 텍스트 캡처 | TextCaptureMain | SETUP (no device) 단계에 3개 서브 상태 추가 |
| 블록 텍스트 | BlockTextMain | SETUP (no device) 단계에 3개 서브 상태 추가 |

각 서브 상태:
- `needsPermission=true` → "카메라 접근 권한이 필요합니다" + "카메라 접근 허용" 버튼
- `permissionDenied=true` → "카메라 권한이 거부되었습니다" + "페이지 새로고침" 버튼 + macOS 설정 경로 안내
- 기본값 → 기존 "캡처카드를 연결해 주세요" + 스피너

### 5. Props 전달 경로

```
App (requestCameraPermission 함수)
  → MainContent (onRequestPermission prop)
    → dp 객체 (needsPermission, permissionDenied, onRequestPermission)
      → ScrollCaptureMain / TextCaptureMain / BlockTextMain
```

## 검증 결과

- ✅ JavaScript 구문 검사 통과 (`node --check`)
- ✅ Playwright 테스트: 페이지 로드 시 JS 에러 0건
- ✅ Playwright 테스트: 5개 탭 모두 정상 렌더링
- ✅ 텍스트 캡처 탭: 권한 요청 UI 정상 표시
- ✅ 블록 텍스트 탭: 권한 요청 UI 정상 표시
- ⏳ 실제 macOS + 캡처카드 테스트: 사용자 확인 필요

## 참고 사항

- Windows에서는 `enumerateDevices()`가 실제 `deviceId`를 반환하므로 이 문제가 발생하지 않음
- Playwright 헤드리스 브라우저는 가상 장치를 제공하여 실제 deviceId가 있으므로 권한 UI가 표시되지 않음 (정상 동작)
- 실제 macOS Chrome에서만 빈 deviceId 시나리오가 재현됨
