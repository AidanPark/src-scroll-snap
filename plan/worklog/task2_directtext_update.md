# Task 2: ScrollSnap_DirectText_Transfer_Method.md 수정

## 작업 정보
- 작업 대상: ScrollSnap_DirectText_Transfer_Method.md
- 작업 시작 시각: 2026-03-01 10:05
- 작업 종료 시각: 2026-03-01 10:42

## 수정 내역
1. 문서 독립성 확보를 위해 타 전송 방안 비교/참조 내용을 전면 제거함
   - 기존 1.1 "기존 전송 방안의 대상과 한계" 삭제
   - 기존 1.3 비교 표 삭제
   - 기존 7.3 비교 섹션 삭제
   - 기존 11장 내 비교 표 및 "방안 간 역할 분담" 삭제
   - 문서 하단 "관련 문서" 참조 라인 삭제
2. 2.1 공통 제약을 Visual 문서 제약 기준으로 교체함
   - 제약 표를 8개 항목(키보드 입력 유일 수단 포함)으로 확장
   - "이 제약이 의미하는 것" 설명 박스를 2.1.1로 추가
3. 3장 전체 워크플로우를 텍스트 블록에서 Mermaid sequenceDiagram으로 변환함
   - 참여자: 사용자(U), 소스 PC(S), HDMI 캡처카드(H), 타겟 PC ScrollSnap(T)
   - 파일 열기부터 OCR 결과 반환까지 전체 흐름 반영
4. 기존 5.3 "텍스트 영역 감지"를 "OCR 타겟 영역 선택 그리드"로 대체함
   - 라이브 프리뷰 오버레이 기반 그리드 선택 방식으로 변경
   - 그리드 해상도(48x27/96x54), 드래그 지정, 하이라이트/딤 피드백, ROI 재사용 정책 명시
5. 멀티모달 LLM 제공자 설정 및 API 키 등록 섹션(5.4) 추가
   - 제공자: OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet/Claude 4, Google Gemini 1.5 Pro/Flash
   - 로그인 방식(API 키), 모델 강점, 연결 테스트, localStorage 저장 정책 기술
   - Claude Max 구독자 API 사용 가능 안내 반영
6. 스크롤 속도 대응 전용 섹션(6장) 신설
   - Adaptive frame sampling
   - Scroll speed detection
   - Fast scroll warning
   - Frame overlap validation(최소 30%)
   - Scroll pause detection
   - Recovery from fast scroll(GAP 마커 및 복구)
   - Speed recommendation display(too fast/optimal/too slow)
7. 섹션 구조를 재정렬하여 번호 체계를 논리적으로 갱신함
   - 결론은 12장으로 이동 및 독립형 내용으로 정리

## 작업 내용 요약
DirectText 문서를 독립 문서로 재구성하고, 공통 제약을 최신 기준으로 보강했으며, 워크플로우를 Mermaid 시퀀스 다이어그램으로 전환했다. 또한 OCR 대상 영역을 사용자가 프리뷰 그리드에서 직접 지정하는 방식으로 개선하고, 멀티모달 LLM 제공자/API 키 설정 체계 및 스크롤 과속 대응 설계를 추가해 실제 운용 안정성을 강화했다.
