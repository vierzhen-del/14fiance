#!/usr/bin/env python3
"""
Notion → Obsidian 자동 동기화 스크립트 (전체 문서)
사용자의 노션 워크스페이스의 모든 문서를 Obsidian으로 가져오기
"""

import os
import json
import subprocess
from pathlib import Path
from datetime import datetime
from notion_client import Client

# 환경 변수에서 토큰 읽기
NOTION_TOKEN = os.getenv("NOTION_TOKEN")
if not NOTION_TOKEN:
    raise ValueError("❌ NOTION_TOKEN 환경 변수를 설정해주세요")

client = Client(auth=NOTION_TOKEN)

# Obsidian 저장 폴더
OBSIDIAN_DIR = Path("./🎯\ Projects")
OBSIDIAN_DIR.mkdir(parents=True, exist_ok=True)

# 처리한 페이지 추적
processed_pages = []
error_pages = []


def extract_text(rich_text_array):
    """Notion의 rich_text 배열에서 텍스트 추출"""
    if not rich_text_array:
        return ""

    text_parts = []
    for item in rich_text_array:
        if item.get("type") == "text":
            text = item["text"].get("content", "")
            if text:
                text_parts.append(text)

    return "".join(text_parts)


def get_page_title(page):
    """노션 페이지에서 제목 추출"""
    try:
        # Title 속성 찾기
        if "properties" in page:
            for key, prop in page["properties"].items():
                if prop.get("type") == "title":
                    title_text = extract_text(prop.get("title", []))
                    if title_text:
                        return title_text

        # 기본값
        return f"Page-{page['id'][:8]}"
    except:
        return f"Page-{page['id'][:8]}"


def get_page_content(page_id):
    """노션 페이지의 간단한 내용 가져오기"""
    try:
        blocks = client.blocks.children.list(page_id)
        content = []

        for block in blocks.get("results", []):
            block_type = block.get("type")

            if block_type == "paragraph":
                text = extract_text(block["paragraph"]["rich_text"])
                if text:
                    content.append(text)
            elif block_type == "heading_1":
                text = extract_text(block["heading_1"]["rich_text"])
                if text:
                    content.append(f"# {text}")
            elif block_type == "heading_2":
                text = extract_text(block["heading_2"]["rich_text"])
                if text:
                    content.append(f"## {text}")
            elif block_type == "bulleted_list_item":
                text = extract_text(block["bulleted_list_item"]["rich_text"])
                if text:
                    content.append(f"- {text}")

        return "\n\n".join(content)
    except:
        return ""


def sync_notion_page(page_id, page_title):
    """노션 페이지를 Obsidian으로 동기화"""
    try:
        # 페이지 메타데이터
        page = client.pages.retrieve(page_id)

        title = page_title or get_page_title(page)
        created_time = page.get("created_time", datetime.now().isoformat())
        last_edited_time = page.get("last_edited_time", created_time)

        # 페이지 내용 가져오기
        content = get_page_content(page_id)

        # Front Matter 작성
        frontmatter = f"""---
title: {title}
notion-id: {page_id}
created: {created_time[:10]}
synced: {datetime.now().isoformat()[:19]}
tags: [notion-sync, 금융비서]
---

"""

        full_content = frontmatter + f"# {title}\n\n" + content if content else frontmatter + f"# {title}"

        # 파일명 정리
        safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()[:100]
        if not safe_title:
            safe_title = f"page-{page_id[:8]}"

        filepath = OBSIDIAN_DIR / f"{safe_title}.md"

        # 파일 저장
        filepath.write_text(full_content, encoding="utf-8")

        processed_pages.append({
            "title": title,
            "path": str(filepath.relative_to('.')),
            "id": page_id
        })

        print(f"✅ {title}")
        return True

    except Exception as e:
        error_pages.append({
            "title": page_title or f"page-{page_id[:8]}",
            "id": page_id,
            "error": str(e)
        })
        print(f"⚠️ 스킵: {page_title} - {str(e)[:50]}")
        return False


def find_all_pages(start_cursor=None, depth=0):
    """사용자의 모든 노션 페이지 찾기 (재귀)"""
    max_depth = 5  # 깊이 제한

    if depth > max_depth:
        return

    try:
        # 검색 (모든 페이지)
        response = client.search(
            filter={"value": "page", "property": "object"},
            page_size=100,
            start_cursor=start_cursor
        )

        pages = response.get("results", [])

        for page in pages:
            page_id = page["id"]

            # 제목 추출
            title = None
            if "title" in page:
                title = page["title"]
            elif "properties" in page:
                for key, prop in page["properties"].items():
                    if prop.get("type") == "title":
                        title = extract_text(prop.get("title", []))
                        if title:
                            break

            # 페이지 동기화
            if title:
                sync_notion_page(page_id, title)

        # 페이지네이션 처리
        next_cursor = response.get("next_cursor")
        if next_cursor:
            find_all_pages(next_cursor, depth + 1)

    except Exception as e:
        print(f"❌ 검색 오류: {str(e)}")


def commit_changes():
    """Git에 커밋"""
    try:
        if not processed_pages and not error_pages:
            print("\n📌 변경사항 없음")
            return False

        subprocess.run(["git", "add", "🎯\\ Projects/"], check=True, capture_output=True)

        commit_msg = f"📥 노션 문서 대량 동기화: {len(processed_pages)}개 페이지\n\n"
        if processed_pages:
            commit_msg += "동기화된 문서:\n"
            for page in processed_pages[:10]:  # 처음 10개만 표시
                commit_msg += f"- {page['title']}\n"
            if len(processed_pages) > 10:
                commit_msg += f"... 외 {len(processed_pages) - 10}개\n"

        if error_pages:
            commit_msg += f"\n⚠️ 처리 실패: {len(error_pages)}개\n"

        commit_msg += "\nCo-Authored-By: Claude <noreply@anthropic.com>"

        subprocess.run(
            ["git", "commit", "-m", commit_msg],
            check=True,
            capture_output=True
        )

        subprocess.run(
            ["git", "push", "origin", "claude/obsidian-git-integration-tm1g0z"],
            check=True,
            capture_output=True
        )

        return True

    except subprocess.CalledProcessError as e:
        print(f"⚠️ Git 오류: {e}")
        return False


def main():
    """메인 동기화 함수"""
    print("=" * 60)
    print("🔄 Notion 전체 문서 동기화 시작")
    print("=" * 60)

    # 모든 페이지 찾기 및 동기화
    find_all_pages()

    print("\n" + "=" * 60)
    print(f"📊 결과 요약")
    print(f"✅ 성공: {len(processed_pages)}개")
    print(f"⚠️ 실패: {len(error_pages)}개")
    print("=" * 60)

    if processed_pages:
        print("\n📄 동기화된 문서:")
        for page in processed_pages[:20]:
            print(f"  - {page['title']}")
        if len(processed_pages) > 20:
            print(f"  ... 외 {len(processed_pages) - 20}개")

    # Git 커밋
    if commit_changes():
        print("\n✨ 동기화 완료 및 커밋됨!")
    else:
        print("\n📝 동기화만 완료됨 (커밋 제외)")


if __name__ == "__main__":
    main()
