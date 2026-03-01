# Task 20: 인터랙티브 크롭 영역 (CropRectOverlay) 완성

## 작업 시간
- 시작: 2026-03-01 15:14 KST
- 종료: 2026-03-01 15:20 KST

## 작업 내용

### 배경
Task 19(스크롤 캡처 + 텍스트 캡처 탭 통합) 이후, 수동 OCR 영역을 사용자가 드래그로 이동하고 리사이즈할 수 있는 인터랙티브 오버레이가 필요했다. CropRectOverlay 컴포넌트 코드는 이미 삽입되어 있었으나, 버그 수정과 READY phase 연결이 남아있었다.

### 수행한 작업

#### 1. CropRectOverlay 버그 수정
- **'n' 방향 리사이즈 조건 단순화**: 기존 코드에서 `d.type.indexOf('n') >= 0 && d.type !== 'ne' || d.type === 'n' || d.type === 'nw' || d.type === 'ne'` 라는 중복되고 논리적으로 항상 true인 조건을 `d.type.indexOf('n') >= 0` 으로 단순화
- **'s' 에지 핸들 수정**: 남쪽 에지 핸들이 `onDown(e, 'se')`를 호출하던 것을 `onDown(e, 's')`로 수정. 커서도 `s-resize`로 올바르게 설정

#### 2. ScrollCaptureMain READY phase 연결
- 기존: 정적 `pointer-events-none` div로 크롭 영역 표시 (이동/리사이즈 불가)
- 변경: `CropRectOverlay` 컴포넌트로 교체
  - `rect`: `st.cropRect` 상태 전달
  - `onChange`: `SC_UPDATE` dispatch로 상태 동기화
  - 사이드바의 X/Y/W/H 입력 필드와 자동 연동

### CropRectOverlay 기능
- 8개 핸들 (4 코너: nw, ne, sw, se + 4 에지: n, s, w, e)
- 본체 드래그로 이동
- 핸들 드래그로 리사이즈
- 최소 크기 5% 제한
- 화면 밖으로 나가지 않도록 클램핑
- "OCR 영역" 라벨 표시
- 퍼센트 좌표 → 사이드바 입력 필드 실시간 동기화

## 검증
- ✅ `node --check` 문법 검사 통과
- ✅ Playwright 테스트: 페이지 로드 정상 (JS 에러 없음)
- ✅ "수동" 버튼 클릭 시 READY phase에서 크롭 영역 + 핸들 정상 렌더링
- ✅ 사이드바 X/Y/W/H 값 실시간 표시 확인
- ✅ 스크린샷으로 시각적 검증 완료

## 변경 파일
- `index.html`: CropRectOverlay 버그 수정 + READY phase 연결 (3줄 수정, 2줄 삭제)
