# 📥 노션 → Obsidian 연동 가이드

노션에서 작성한 자료를 Obsidian 개인 볼트로 동기화하는 방법을 설명합니다.

## 🔄 3가지 동기화 방법

### 방법 1️⃣: 수동 내보내기 (가장 간단)

**장점**: 설정이 간단함  
**단점**: 수동으로 매번 해야 함

#### 단계별 가이드

1. **노션에서 내보내기**
   - 노션 페이지 우측 상단 `⋯` → `Export`
   - **Export format**: `Markdown & CSV` 선택
   - **Includes**: 
     - ✅ Sub-pages
     - ✅ Files & media
   - **ZIP download**

2. **파일 정리**
   ```bash
   # 다운로드한 ZIP 파일 압축 해제
   unzip export-*.zip
   
   # 마크다운 파일 이동
   # 예: Books 폴더로 이동
   mv "노션 페이지명/*.md" ~/14fiance/📚\ Books/
   ```

3. **이미지 정리**
   ```bash
   # attachments 폴더 생성
   mkdir -p ~/14fiance/🏷️\ Resources/attachments
   
   # 이미지 파일 이동
   mv -r export-*/*/[이미지폴더]/* ~/14fiance/🏷️\ Resources/attachments/
   ```

4. **마크다운 링크 수정** (필요시)
   ```
   # 변경 전
   ![](../../../어떤폴더/이미지.png)
   
   # 변경 후
   ![](../../🏷️\ Resources/attachments/이미지.png)
   ```

---

### 방법 2️⃣: 노션 API 활용 (자동화)

**장점**: 자동 동기화 가능  
**단점**: 설정이 복잡, API 토큰 필요

#### 준비물
- Notion Integration Token
- Python 3.8+

#### 설치 & 설정

1. **Notion API Token 발급**
   - [Notion Developers](https://www.notion.so/my-integrations) 접속
   - **New integration** → `14fiance` 작성
   - **Associated workspace**: 자신의 워크스페이스 선택
   - **Token 복사 후 안전한 곳에 저장**

2. **Python 라이브러리 설치**
   ```bash
   pip install notion-client notion2md
   ```

3. **동기화 스크립트 생성**
   ```bash
   # sync-notion.py 파일 생성
   touch sync-notion.py
   ```

4. **스크립트 작성**

   **파일**: `sync-notion.py`
   ```python
   #!/usr/bin/env python3
   import os
   import json
   from pathlib import Path
   from notion_client import Client
   from datetime import datetime

   # 환경 변수에서 토큰 읽기
   NOTION_TOKEN = os.getenv("NOTION_TOKEN")
   if not NOTION_TOKEN:
       raise ValueError("NOTION_TOKEN 환경 변수를 설정해주세요")

   client = Client(auth=NOTION_TOKEN)

   # Notion 데이터베이스 ID (your_database_id)
   DATABASE_ID = "your-notion-database-id-here"

   def sync_notion_to_obsidian():
       """Notion 데이터베이스에서 Obsidian으로 동기화"""
       
       try:
           # 데이터베이스 쿼리
           response = client.databases.query(DATABASE_ID)
           pages = response.get("results", [])
           
           print(f"🔄 {len(pages)}개 페이지를 찾았습니다.")
           
           for page in pages:
               # 페이지 제목 추출
               title = page["properties"]["Name"]["title"][0]["plain_text"] if page["properties"]["Name"]["title"] else "Untitled"
               page_id = page["id"]
               
               print(f"📝 처리 중: {title}")
               
               # 페이지 내용 가져오기
               page_content = client.blocks.children.list(page_id)
               
               # 마크다운으로 변환 (간단 버전)
               content = f"# {title}\n\n"
               content += f"**Notion URL**: https://www.notion.so/{page_id.replace('-', '')}\n\n"
               
               # 기본 메타데이터
               created = page["created_time"]
               modified = page["last_edited_time"]
               
               # Front Matter 추가
               frontmatter = f"""---
title: {title}
notion-id: {page_id}
created: {created[:10]}
modified: {modified[:10]}
tags: [notion-sync]
---

"""
               
               # 파일 저장 (Books 폴더에)
               filepath = Path(f"./📚\ Books/{title}.md")
               filepath.parent.mkdir(parents=True, exist_ok=True)
               
               with open(filepath, "w", encoding="utf-8") as f:
                   f.write(frontmatter + content)
               
               print(f"✅ 저장됨: {filepath}")
           
           print("\n✨ 동기화 완료!")
           
       except Exception as e:
           print(f"❌ 오류 발생: {e}")

   if __name__ == "__main__":
       sync_notion_to_obsidian()
   ```

5. **실행**
   ```bash
   # 환경 변수 설정
   export NOTION_TOKEN="your_token_here"
   
   # 스크립트 실행
   python3 sync-notion.py
   ```

6. **자동 실행 (크론 작업)**
   ```bash
   # 매일 오전 9시에 실행
   0 9 * * * cd ~/14fiance && python3 sync-notion.py
   ```

---

### 방법 3️⃣: Zapier 자동화 (권장 - 초보자)

**장점**: GUI 기반, 설정 쉬움  
**단점**: 무료 버전 제한 있음

#### 단계

1. **Zapier 가입**
   - [Zapier.com](https://zapier.com) 접속
   - GitHub/Google 로그인 또는 회원가입

2. **Notion 데이터베이스 연결**
   - **Create Zap** → Trigger: Notion
   - **Event**: Database item created/updated
   - Notion 계정 연결 & 데이터베이스 선택

3. **GitHub에 파일 저장**
   - **Action**: GitHub → Create file
   - **Repository**: `vierzhen-del/14fiance`
   - **File path**: `📚\ Books/{title}.md`
   - **Content**: 노션 페이지 내용

4. **Zap 테스트 & 활성화**
   - "Test" 버튼으로 테스트
   - 성공하면 "Publish" → 활성화

---

## 📋 노션 → Obsidian 마이그레이션 체크리스트

- [ ] 노션 API 토큰 발급 (방법 2 선택시)
- [ ] 동기화 도구 선택 (1, 2, 또는 3)
- [ ] 첫 동기화 실행
- [ ] 마크다운 파일 확인
- [ ] 이미지 경로 수정
- [ ] 내부 링크 정정 (`[[]]` 형식 확인)
- [ ] Git 커밋

---

## 🔗 노션 데이터베이스 ID 찾는 법

노션 URL: `https://www.notion.so/your-workspace/UUID?v=...`

- `UUID` 부분이 데이터베이스 ID입니다
- 하이픈 제거: `12345-67890-abcde` → `123456789abcde`

**예시**:
```
https://www.notion.so/my-workspace/12345-6789a-bcdef?v=xyz
                                    ↑ 이 부분
```

---

## 📝 노션 페이지 구조 팁

동기화를 쉽게 하려면 노션 페이지를 다음처럼 구조화하세요:

```
📚 Books (Database)
├── Name: [책제목]
├── Category: Books / Ideas / Projects / Daily
├── Tags: [태그들]
├── Status: Completed / In Progress / To Read
├── Content: [본문]
└── Resources: [링크, 이미지]
```

---

## ⚠️ 주의사항

1. **API 토큰 보안**
   - `.env` 파일에 저장
   - `.env`를 `.gitignore`에 추가
   - 절대 깃헙에 올리지 말 것!

2. **파일 중복 방지**
   - 이미 동기화된 파일은 수동으로 덮어쓰지 말 것
   - 자동 도구에서만 업데이트

3. **마크다운 호환성**
   - 노션의 일부 포맷이 마크다운으로 완벽히 변환되지 않을 수 있음
   - 필요시 수동 수정

---

## 🚀 빠른 시작 (권장 방법)

**초보자 → 방법 1 (수동) 시작**
```bash
# 1. 노션에서 내보내기
# 2. 파일 복사
cp ~/Downloads/export-*.md ./📚\ Books/
# 3. Git 커밋
git add .
git commit -m "📥 노션에서 가져온 자료"
git push origin claude/obsidian-git-integration-tm1g0z
```

**중급 → 방법 2 (Python API)**
```bash
# 1. NOTION_TOKEN 설정
export NOTION_TOKEN="secret_..."
# 2. 동기화 스크립트 실행
python3 sync-notion.py
# 3. Git 커밋
git add .
git commit -m "🔄 노션 자동 동기화"
git push
```

---

**마지막 업데이트**: 2026-01-06
