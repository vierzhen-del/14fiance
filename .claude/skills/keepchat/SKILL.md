---
name: keepchat
description: Preserve the current session's progress into persistent files (CLAUDE.md and any linked ops doc) before context fills up or the session ends, so a future session on any device can resume without re-explaining anything. Use when the user asks to wrap up, "정리해줘", "기억해줘", "오늘 한 거 저장해줘", "이어가게 해줘", before a long break, when context feels close to full, or proactively around ~80% context usage.
---

# keepchat

## 목적

대화 맥락(컨텍스트)이 꽉 차거나 세션이 끊기기 전에 지금까지의 진행 상황을 파일에 기록해서, 다음 세션(다른 기기 포함)이 처음부터 다시 설명받지 않아도 이어갈 수 있게 한다. 대화 이력 자체를 저장하는 게 아니라 **결과와 상태**를 저장하는 방식이다 (문서·CLAUDE.md 우선 — 노션 v5.8 "프롬프트보다 파일 세팅이 중요" 원칙).

## 실행 절차

1. **변경 파악**: 현재 저장소에서 `git status` · `git diff` · `git log -5 --oneline`으로 이번 세션에서 실제로 바뀐 것을 확인한다. 아직 파일에 안 남은 대화 중 결정사항(설계, 정책 결정, 다음 할일)도 함께 정리한다.
2. **CLAUDE.md 갱신**: 저장소 루트의 CLAUDE.md를 찾아 "예정 작업"류 섹션을 최신 상태로 반영한다 — 완료된 항목 정리, 새로 나온 결정/할일 추가. CLAUDE.md가 없으면 만들지 말고 사용자에게 먼저 확인한다 (과설계 금지, 요청된 것만).
3. **연동 문서 확인**: CLAUDE.md 안에 노션 등 외부 운영 문서 URL이 있으면, 그 문서 하단에 날짜를 붙인 짧은 세션 로그를 추가한다 (한 일 / 남은 일, 5줄 이내). 연동 문서가 없으면 이 단계는 생략한다.
4. **커밋**: 변경된 CLAUDE.md를 규약대로 커밋한다 — 1기능 1커밋, 커밋 메시지에 why 포함, main 직커밋 금지(현재 브랜치 유지). 이미 원격에 push해온 저장소라면 push까지 진행한다.
5. **컨텍스트 조언**: 컨텍스트가 차서 이 스킬이 트리거된 상황이면 `/compact` 실행을 제안한다.
6. **확인 메시지**: 사용자에게 "다음에 어느 기기·세션에서든 이 저장소를 열면 [저장 위치]에서 바로 이어집니다" 형태로 짧게 안내하고 끝낸다.

## 하지 않는 것

- 대화 전체를 그대로 복사해서 저장하지 않는다 — 요약만 남긴다
- 시크릿·토큰·API 키는 절대 기록하지 않는다 (SENTINEL 원칙)
- 사용자가 명시적으로 요청하지 않은 새 문서·폴더를 만들지 않는다
- 이미 파일에 반영된 내용을 중복 기록하지 않는다
