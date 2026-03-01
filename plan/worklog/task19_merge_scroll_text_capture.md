# Task 19: 스크롤 캡처 + 텍스트 캡처 탭 통합

## 작업 시간
- 시작: 2026-03-01 14:30 KST
- 종료: 2026-03-01 15:00 KST

## 문제 상황

기획 문서에는 3개의 전송 방법이 정의되어 있지만, 앱에는 4개의 모드 탭이 있어 매핑이 불분명했음.

| 기획 (3개) | 기존 탭 (4개) |
|------------|-------------|
| DirectText Transfer | 스크롤 캡처 (이미지만) + 텍스트 캡처 (이미지+OCR) |
| Visual Transfer | 파일 수신 |
| BlockText Transfer | 블록 텍스트 |

**DirectText 기획 1개가 탭 2개로 분리**되어 있었으며, 스크롤 캡처와 텍스트 캡처의 파이프라인 90%가 동일했음.

## 해결 방안

스크롤 캡처 탭에 OCR 기능을 통합하여 **단일 탭으로 병합**.

### 새로운 플로우
```
IDLE → READY → CAPTURING → ASSEMBLING → RESULT → (선택) OCR_PROCESSING → OCR_RESULT
```

**RESULT 단계**: 스티칭된 이미지 표시 + PNG/JPEG 다운로드 + OCR 실행 버튼
**OCR_RESULT 단계**: 이미지(좌) + OCR 텍스트(우) 분할 뷰

## 변경 내용

### 1. 상태 구조 통합
- `textCapture` 상태 제거
- `scrollCapture`에 OCR 필드 추가: `ocrMethod`, `ocrTarget`, `ocrProgress`, `ocrChunks`, `ocrCurrentChunk`, `ocrText`, `cropRect`
- `MODES.TC` 제거
- `TC_UPDATE` 리듀서 액션 제거

### 2. UI 컴포넌트 통합
- **TextCaptureMain** + **TextCaptureSidebar** 삭제 (~200줄)
- **ScrollCaptureMain** 확장:
  - `READY`: 가이드 오버레이 + 수동 OCR 영역 사각형 표시
  - `RESULT`: ResultViewer (기존)
  - `OCR_PROCESSING`: 스피너 + 진행률 + OcrBadge (신규)
  - `OCR_RESULT`: 이미지/텍스트 분할 뷰 (신규)
- **ScrollCaptureSidebar** 확장:
  - `IDLE/READY`: 장치 + 스크롤 방향 + **OCR 타겟 영역** (전체/수동) + **OCR 방법** + 캡처 시작
  - `RESULT`: 이미지 다운로드 + OCR 방법 선택 + **OCR 실행** 버튼 + 새 캡처 시작
  - `OCR_PROCESSING`: 청크 진행 + 취소
  - `OCR_RESULT`: 문자/줄 수 통계 + 텍스트 복사/다운로드 + 이미지 다운로드

### 3. 캡처 영역 사각형
- OCR 타겟 영역을 "수동"으로 설정 시 X/Y/W/H (%) 입력 필드 표시
- READY 단계 비디오 위에 파란색 점선 사각형 오버레이 표시
- OCR 실행 시 스티칭된 이미지를 해당 비율로 크롭한 뒤 OCR 수행

### 4. 파이프라인 통합
- TC 파이프라인 전체 삭제 (~120줄): `tcRef`, `tcCaptureFrame`, `startTextCapture`, `stopTextCapture`, `cancelTextCapture`, `tcPerformOcr`, `tcCopyText`, `tcDownloadText`, `tcNewCapture`
- SC OCR 파이프라인 추가: `ocrCancelledRef`, `scStartOcr`, `scCancelOcr`, `scCopyText`, `scDownloadText`

### 5. 기타 정리
- **TopBar**: 텍스트 캡처 탭 제거 (4탭 → 3탭+설정)
- **StatusBar**: TC 참조 제거, SC의 OCR 상태 표시 지원
- **키보드 단축키**: TC 단축키 제거, SC에 OCR 취소(Escape) 추가
- **MainContent/SidebarSwitch**: TC 라우팅 제거

## 코드 규모
- 삭제: ~320줄 (TextCaptureMain, TextCaptureSidebar, TC 파이프라인)
- 추가: ~200줄 (SC OCR 페이즈, 사이드바, 파이프라인)
- 수정: ~50줄 (라우팅, 상태바, 단축키)
- 전체: 3599줄 → ~3400줄 (약 200줄 순감소)

## 검증 결과
- ✅ `node --check` 구문 검사 통과
- ✅ Playwright: 0 JS errors
- ✅ 스크롤 캡처 탭: OCR 타겟 영역(전체/수동) + OCR 방법 + 캡처 시작 정상 표시
- ✅ 수동 모드: 크롭 사각형 설정 UI(X/Y/W/H) + 초기화 버튼 정상 표시
- ✅ 블록 텍스트 탭: 정상 렌더링
- ✅ 설정 탭: 정상 렌더링
- ✅ 파일 수신 탭: 정상 렌더링
