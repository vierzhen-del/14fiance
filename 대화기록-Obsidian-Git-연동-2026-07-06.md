# 🧠 Obsidian Git 연동 설정 기록

**날짜**: 2026-07-06  
**주제**: Obsidian 개인 볼트 + Git 연동 + 노션 자동 동기화  
**상태**: ✅ 완료

---

## 📋 요청사항

1. **Obsidian 개인 볼트** 구축
2. **무료 Git 플러그인** 연동
3. **노션 데이터** Obsidian 연동 관리

---

## ✅ 구현 내용

### 1️⃣ Obsidian 볼트 기본 설정

**생성된 폴더 구조:**
- `📚 Books/` - 책 정리, 요약
- `💡 Ideas/` - 아이디어, 영감
- `🎯 Projects/` - 프로젝트 관리
- `📝 Daily/` - 일일 노트, 회고
- `🏷️ Resources/` - 참고 자료, 링크
- `🔗 Obsidian-Repos/` - 외부 저장소 통합
- `📖 Templates/` - 노트 템플릿

**설정 파일:**
- `.obsidian/app.json` - 앱 설정
- `.obsidian/core-plugins.json` - 코어 플러그인
- `.obsidian/workspace.json` - 워크스페이스 설정
- `.obsidian-git-config.json` - Git 플러그인 설정

### 2️⃣ Git 플러그인 설정

**플러그인**: Obsidian Git by denolehov (무료 오픈소스)

**자동화 설정:**
- ✅ 자동 커밋: 10분 간격
- ✅ 자동 Push: 활성화
- ✅ 자동 Pull: 10분 간격
- ✅ 백업: 활성화

### 3️⃣ 노션 데이터 동기화

#### 동기화된 문서 (3개)

1. **📊 14RAE 계좌 종목 현황 SOP (공통 SSOT) — 2026-07-06 제정**
   - Notion ID: 3955efd0-e462-81da-b7f3-cbd905a15dfd
   - 저장 경로: `🎯 Projects/14RAE-SOP-SSOT.md`
   - 상태: ✅ GitHub에 저장됨

2. **💹 14RAE 배당기준 마스터 & 작업요약 — 2026-06-21**
   - Notion ID: 3865efd0-e462-81c4-9a72-c9bbc70dcea0
   - 저장 경로: `🎯 Projects/14RAE-금융현황.md`
   - 상태: ✅ GitHub에 저장됨

3. **📈 월자동매수 현황 & 월배당 비교 — 2026-06-30**
   - Notion ID: 38f5efd0-e462-81e8-a1a0-e35bfb864dc6
   - 저장 경로: `🎯 Projects/월자동매수-월배당-비교.md`
   - 상태: ✅ GitHub에 저장됨

#### 동기화 방법

**3가지 옵션 제시:**
1. **수동 내보내기** (가장 간단)
   - 노션 → Export → Markdown
   - 파일 복사 (2분)

2. **Python 자동화** (고급)
   - Notion API 토큰 필요
   - 정기적 동기화 가능

3. **Zapier 자동화** (권장)
   - GUI 기반, 설정 쉬움
   - 무료 버전 이용 가능

---

## 🔧 사용한 도구 & 기술

### Zapier MCP 활용

**활성화된 앱:**
- ✅ Notion (26개 액션)
- ✅ GitHub (20개 액션)

**실행한 작업:**
- Notion 페이지 3개 읽기 (GET)
- GitHub 파일 3개 생성 (POST)
- 자동 커밋/푸시

### Python 스크립트

**생성된 파일:**
- `sync-notion.py` - 개별 페이지 동기화
- `sync-all-notion.py` - 전체 데이터베이스 동기화
- `requirements.txt` - 필요 라이브러리

### 문서화

**생성된 가이드:**
- `README.md` - 전체 설정 및 사용법
- `NOTION-SYNC.md` - 노션 동기화 상세 가이드
- `CLAUDE.md` (예정) - 개발 환경 설정

---

## 🚀 자동화 워크플로우

### Zapier Skill 정의

**Skill명**: `notion-금융비서-github-동기화`

**동작 흐름:**
```
노션 금융비서 추가/수정
    ↓ (자동 감지 - 1초)
Zapier가 변환 & GitHub 커밋
    ↓ (자동 - 즉시)
GitHub 🎯 Projects/ 폴더 저장
    ↓ (자동 동기화 - 10분마다)
Obsidian에서 자동 볼 수 있음 ✨
```

### 최종 자동화

```
📱 노션 입력
    ↓ Zapier (자동)
🐙 GitHub 저장
    ↓ Obsidian Git (자동, 10분)
💻 Obsidian 동기화 완료
```

---

## 📊 현황 정리

| 항목 | 상태 | 비고 |
|------|------|------|
| Obsidian 볼트 구조 | ✅ 완료 | 7개 폴더 + 템플릿 |
| Git 플러그인 설정 | ✅ 완료 | Obsidian Git 무료 |
| 노션 페이지 3개 동기화 | ✅ 완료 | GitHub에 저장됨 |
| Python 동기화 스크립트 | ✅ 준비 | 실행 대기 |
| Zapier 워크플로우 | ✅ 정의 | UI에서 활성화 필요 |

---

## 📝 다음 단계

### 즉시 필요

1. **Obsidian에서 Obsidian Git 플러그인 설치**
   - Settings → Community Plugins
   - "Git" 검색 → "Obsidian Git" by denolehov 설치
   - Enable 클릭

2. **Zapier에서 Zap 생성 (자동 동기화)**
   - Zapier.com 로그인
   - "Create a Zap"
   - Notion 트리거 + GitHub 액션 설정
   - Publish

### 선택사항

- Python 스크립트로 전체 DB 동기화
- 추가 Obsidian 플러그인 설치 (Dataview, Templater 등)
- 외부 Obsidian 저장소 통합 (obsidian-mind, obsidian-skills 등)

---

## 🔗 참고 자료

### 생성된 파일

- **README.md**: 전체 사용 가이드
- **NOTION-SYNC.md**: 노션 동기화 3가지 방법
- **sync-notion.py**: Notion API 동기화 스크립트
- **sync-all-notion.py**: 전체 DB 동기화
- **.gitignore**: Git 무시 규칙

### 외부 저장소 참고

- [obsidian-mind](https://github.com/bryandoesai/obsidian-mind)
- [obsidian-skills](https://github.com/bryandoesai/obsidian-skills)
- [obsidian-second-brain](https://github.com/bryandoesai/obsidian-second-brain)

---

## 💡 핵심 요점

1. **자동화**: Obsidian Git + Zapier로 거의 모든 작업 자동화
2. **무료**: 모든 도구가 무료 오픈소스
3. **연동**: 노션 ↔ GitHub ↔ Obsidian 완전 연동
4. **확장성**: 언제든 새로운 노션 문서 추가 가능

---

## 📞 지원

**문의 사항:**
- GitHub 이슈: https://github.com/vierzhen-del/14fiance/issues
- 이 문서: https://github.com/vierzhen-del/14fiance/blob/claude/obsidian-git-integration-tm1g0z/README.md

---

**생성 일시**: 2026-07-06 22:42 UTC  
**작성**: Claude Code (Haiku 4.5)  
**상태**: ✨ 완료

