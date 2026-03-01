# Task 13: [6.2] 캡처 디바이스 연결/프리뷰

## 작업 시간
- 시작: 2026-03-01 02:55 KST
- 종료: 2026-03-01 03:05 KST

## 작업 대상
- `/index.html` — 984줄 (6.1 앱 셸 기반에서 디바이스 관리 코드 추가)

## 작업 내용

### 추가된 기능

#### 1. React Hook alias 추가
- `useRef = React.useRef` 추가 (video element 참조용)

#### 2. INIT_STATE.device 확장
- `devices: []` — 감지된 비디오 입력 장치 목록
- `selectedDeviceId: null` — 현재 선택된 장치 ID

#### 3. Reducer 액션 추가
- `SET_DEVICES` — 장치 목록 갱신, 첫 번째 장치 자동 선택, 선택된 장치 제거 시 연결 해제 + SC READY→IDLE 전환
- `SELECT_DEVICE` — 사용자가 드롭다운에서 장치 선택

#### 4. VideoPreview 컴포넌트
- `useRef`로 `<video>` element 참조
- `stream` prop 변경 시 `srcObject` 자동 설정
- 해상도/FPS 오버레이 표시
- `object-contain` + 검은 배경으로 비율 유지

#### 5. DeviceSelect 컴포넌트
- 장치 목록에서 드롭다운 렌더링
- 장치 없을 때 "연결된 장치 없음" 표시 (disabled)
- `SELECT_DEVICE` 디스패치

#### 6. App 디바이스 관리 (2개 useEffect)
- **Effect 1**: `enumerateDevices()` 2초 폴링 + `devicechange` 이벤트 리스너 → `SET_DEVICES` 디스패치
- **Effect 2**: `selectedDeviceId` 변경 시 `getUserMedia({ deviceId: { exact: id } })` 호출 → 스트림 설정, DEVICE 정보 디스패치, SC READY 전환, `track.onended` 감시

#### 7. MediaStream 관리
- `streamRef` (useRef) — 실제 MediaStream 보관 (직렬화 불가능하므로 reducer에 넣지 않음)
- `stream` (useState) — React 리렌더 트리거용

#### 8. 기존 컴포넌트 업데이트
- `ScrollCaptureMain` — READY 상태에서 VideoPreview 표시
- `TextCaptureMain` — SETUP+connected에서 VideoPreview 표시
- 모든 사이드바에 DeviceSelect 추가
- `FileReceiveSidebar` — 장치 미연결 시 수신 시작 버튼 비활성화

## 검증 결과 (Playwright)

| 항목 | 결과 |
|------|------|
| 페이지 로드 | ✅ JS 에러 없음 (favicon 404만 발생) |
| 스크롤 캡처 탭 | ✅ IDLE 상태, "캡처카드를 연결해 주세요" |
| 파일 수신 탭 | ✅ SETUP, 스크립트 안내, 장치 드롭다운 |
| 텍스트 캡처 탭 | ✅ OCR 배지 표시, 장치 드롭다운 |
| 블록 텍스트 탭 | ✅ 역방향 스크롤 경고, 안정성 슬라이더 |
| 설정 탭 | ✅ 모든 설정 카드 렌더링 |
| 장치 미연결 처리 | ✅ "연결된 장치 없음" 드롭다운 (disabled) |
| 상태바 | ✅ "장치 대기 중 \| 장치: 미연결 \| 해상도: -- \| FPS: --" |
| OCR 상태바 전환 | ✅ 텍스트 모드에서 "OCR: Tesseract.js v5 (eng+kor)" 표시 |

## 비고
- 물리 캡처카드 없이 테스트하므로 실제 스트림 연결은 확인 불가
- `getUserMedia` 거부 시 graceful 처리 (console.warn + 상태 초기화)
- 캡처카드 연결 시 자동 감지(2초 폴링) 동작은 실제 장치 필요
