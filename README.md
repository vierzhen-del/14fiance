# 🧠 Obsidian 개인 볼트 + Git 연동

노션 자료를 Obsidian으로 관리하고 Git으로 버전 관리하는 개인 볼트입니다.

## 📁 폴더 구조

```
.
├── .obsidian/              # Obsidian 설정 폴더
├── 📚 Books/               # 책 정리, 요약
├── 💡 Ideas/               # 아이디어, 영감
├── 🎯 Projects/            # 진행 중인 프로젝트
├── 📝 Daily/               # 일일 노트, 일기
├── 🏷️ Resources/           # 참고 자료, 링크, 이미지
├── 🔗 Obsidian-Repos/      # 외부 Obsidian 저장소 통합
├── 📖 Templates/           # 노트 템플릿
└── README.md               # 이 파일
```

## 🔧 Git 플러그인 설정

### Obsidian Git 설치 및 설정

1. **Obsidian 열기** → Settings → Community Plugins
2. **Disable safe mode** 클릭
3. **Browse** → **"Git"** 검색
4. **"Obsidian Git"** by **denolehov** 선택 및 Install
5. **Enable** 클릭 (토글 활성화)

### 자동 커밋 설정

Obsidian Git 플러그인 설정에서:
- **Automatic commit** 활성화
- **Interval (minutes)** : 10 (또는 원하는 시간)
- **Commit message** : `Auto-save: {{date}} {{time}}`

### Pull/Push 자동화

```json
Settings → Obsidian Git
- Auto pull interval: 10 minutes
- Disable push: (체크 해제)
- List modified files before pushing: (선택)
```

## 📥 노션 데이터 연동 방법

### 1️⃣ 노션에서 마크다운 내보내기

**노션 → 내보내기 방법:**
1. 내보낼 페이지 선택
2. **...** → **Export** → **Markdown & CSV**
3. 다운로드한 ZIP 파일 압축 해제
4. 마크다운 파일을 원하는 폴더에 이동

### 2️⃣ 자동 동기화 (고급)

**Notion2Markdown 도구 사용:**
```bash
# npm으로 설치
npm install -g notion-to-markdown

# 환경 변수 설정 (Notion API Token 필요)
export NOTION_TOKEN="your_token_here"

# 마크다운으로 변환
notion-to-markdown --database-id YOUR_DB_ID --output-dir ./📚\ Books
```

## 🔗 외부 Obsidian 저장소 통합

아래 저장소들을 참고하여 구성:

### 1. [obsidian-mind](https://github.com/bryandoesai/obsidian-mind)
- 마인드맵 및 생각 정리
- **연동**: `📚 Books/` 또는 `💡 Ideas/`에 추가

### 2. [obsidian-skills](https://github.com/bryandoesai/obsidian-skills)
- 기술 스킬 관리
- **연동**: `🎯 Projects/` 또는 별도 폴더

### 3. [obsidian-second-brain](https://github.com/bryandoesai/obsidian-second-brain)
- 제2의 뇌 구축 가이드
- **연동**: 전체 시스템 레퍼런스

## 📋 워크플로우

### 📌 일일 작업

```bash
# 1. Obsidian 열기 (자동으로 최신 변경 가져옴)

# 2. 노트 작성/수정

# 3. 자동으로 Git에 커밋 (10분 간격)

# 4. 수동 푸시 필요시:
#    Obsidian Git → Open source control → Push
```

### 🔄 Git 명령어

```bash
# 수동으로 모든 변경 커밋
git add .
git commit -m "📝 Update notes: $(date '+%Y-%m-%d %H:%M')"

# 원격 저장소와 동기화
git push origin main

# 최신 변경 가져오기
git pull origin main

# 변경 사항 확인
git status
```

## 🏷️ 추천 노트 작성 규칙

### 파일명
- 한글/영문 혼용 가능
- 날짜 포맷: `YYYY-MM-DD` (자동 정렬 용이)
- 예: `2026-01-15-Python-학습.md`

### Front Matter (옵션)
```yaml
---
tags: [python, 학습, 개발]
created: 2026-01-15
updated: 2026-01-15
status: in-progress
---
```

### 링크 방식
- Obsidian 내부 링크: `[[노트명]]`
- 외부 링크: `[텍스트](URL)`
- 태그: `#태그명`

## 🛠️ 트러블슈팅

### Git 충돌 해결
```bash
# 충돌 파일 확인
git status

# 충돌 내용 수정 후
git add .
git commit -m "Resolve conflict"
git push
```

### 자동 동기화 안 될 때
1. Obsidian Git 설정 확인
2. Git 권한 확인 (`git log`로 마지막 커밋 확인)
3. 원격 저장소 연결 확인: `git remote -v`

## 📚 추천 Obsidian 플러그인

- **Obsidian Git** ✅ (설치됨)
- **Templater**: 자동 템플릿 생성
- **Dataview**: 데이터베이스 쿼리
- **Graph Analysis**: 관계도 분석
- **Excalidraw**: 다이어그램 작성

## 🚀 시작하기

```bash
# 1. 저장소 클론
git clone https://github.com/your-username/14fiance.git

# 2. Obsidian으로 폴더 열기
# Obsidian → Open folder as vault → 14fiance 선택

# 3. Git 플러그인 설치 및 설정
# (위의 "Obsidian Git 설치 및 설정" 참고)

# 4. 노션 데이터 가져오기
# (위의 "노션 데이터 연동 방법" 참고)

# 5. 작성 시작! 🎉
```

## 📌 유용한 팁

- **빠른 검색**: Ctrl/Cmd + P → "Quick Switcher"
- **백링크 활용**: 관련 노트 자동 연결
- **그래프 보기**: 관계도 시각화
- **일일 노트**: 매일 자동으로 생성되는 노트

---

**마지막 업데이트**: 2026-01-06  
**저장소**: [14fiance](https://github.com/vierzhen-del/14fiance)
