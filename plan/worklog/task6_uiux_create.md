# TASK 6 UI/UX 문서 재작성 작업 로그

작성일: 2026-03-01
대상 문서: `idea/ui/ScrollSnap_PC_WebApp_UI_UX_Proposal.md`

## 1) 사전 분석
- 기존 UI/UX 제안서(약 2,100라인) 전체 구조와 섹션 경계를 확인했다.
- 전송 방식 문서 3종을 모두 읽고 반영 포인트를 추출했다.
  - `idea/trans/ScrollSnap_Visual_Transfer_Method.md`
  - `idea/trans/ScrollSnap_DirectText_Transfer_Method.md`
  - `idea/trans/ScrollSnap_BlockText_Transfer_Method.md`

## 2) 문서 반영 내역

### 변경 1: 탭 바 업데이트 (Section 5)
- 탭 구성을 5개로 변경했다.
  - `[스크롤 캡처] [파일 수신] [텍스트 캡처] [블록 텍스트] [설정]`
- 블록 텍스트 탭(클립보드 아이콘 16px), 설정 탭(기어 아이콘 16px) 사양을 추가했다.
- 탭 목적/아이콘/전환 설명을 갱신했다.

### 변경 2: 6A(텍스트 캡처) 보강
- SETUP 상태에 **OCR 타겟 영역 선택 그리드**를 추가했다.
  - 자동 감지/수동 지정 토글
  - 선택 영역 밝게, 제외 영역 딤 처리
  - 수동 ROI 핸들 포함
- CAPTURING 상태에 **스크롤 속도 표시기**를 추가했다.
  - red/green/yellow 구간
  - 임계치 초과 경고 규칙
- LLM 제공자 설정은 **Section 7.1 참조**로 연결했다.

### 변경 3: 신규 6B(블록 텍스트 UI/UX) 추가
- 상태 전이도 추가:
  - `SETUP -> MONITORING <-> PROCESSING`
  - `TRANSFERRED` 토스트 후 MONITORING 유지
- SETUP/MONITORING/PROCESSING/TRANSFERRED를 모두 상세 설계했다.
- 특히 MONITORING 상태에 요청된 핵심 요소를 모두 포함했다.
  - 하이라이트 감지 오버레이
  - 원형 안정화 진행률
  - 안정화 대기 텍스트
  - 상태 인디케이터/임계치 슬라이더/전송 이력/감지 중단
- 신규 상태별 ASCII 와이어프레임을 추가했다.
- 신규 컴포넌트에 대응하는 Tailwind 클래스 사양을 포함했다.

### 변경 4: 설정 섹션(Section 7) 개편
- 기존 Section 7을 **설정 UI/UX**로 재구성했다.
- 7.1 LLM API 설정
  - Provider 표(OpenAI/Anthropic/Google)
  - 모델 선택, API 키 마스킹 입력
  - 연결 테스트/결과, 키 삭제
  - Claude Max 구독과 API 과금 분리 안내
  - localStorage 저장 + XSS 주의 문구
- 7.2 캡처 설정
  - 기본 장치/스크롤 방향/프레임 레이트
- 7.3 블록 텍스트 설정
  - 안정성 임계치/자동 클립보드/알림 시간/감지 민감도

### 변경 5: 상태바 메시지(Section 8) 확장
- 블록 텍스트 모드 메시지를 추가했다.
  - 블록 텍스트 대기
  - 감지 중
  - 선택 감지됨
  - OCR 처리 중
  - 클립보드 복사 완료

### 변경 6: 컴포넌트 트리(Section 12) 갱신
- 블록 텍스트 모드 컴포넌트를 반영했다.
  - `<BlockTextGuide />`
  - `<VideoPreview />`
  - `<HighlightOverlay />`
  - `<StabilityIndicator />`
  - `<TransferHistory />`
  - `<OcrProcessingView />`
- 설정 컴포넌트를 반영했다.
  - `<LlmApiSettings />`
  - `<CaptureSettings />`
  - `<BlockTextSettings />`

## 3) 보존/정합성 처리
- 기존 문서의 유효한 본문(1~4, 6, 8~11, 부록 중심)은 최대한 유지했다.
- 탑바 예시 문자열에서 잔존하던 `[OCR]` 표기를 제거해 5탭 구조와 정합성을 맞췄다.
- 목차에 6B/7(설정) 항목을 반영했다.

## 4) 검증
- Markdown 파일은 현재 워크스페이스 LSP 설정상 진단 서버가 없어 `lsp_diagnostics` 자동 검증이 불가함을 확인했다.
- 본 작업은 문서 변경만 포함하며, 실행 가능한 빌드 대상(패키지/앱 엔트리)이 없어 빌드 검증은 해당 없음.
