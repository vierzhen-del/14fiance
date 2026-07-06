#!/usr/bin/env python3
"""
Notion → Obsidian 자동 동기화 스크립트
금융비서 노션 데이터를 Obsidian으로 가져오기
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

# 동기화할 노션 페이지 ID들
# URL에서 마지막 ID 부분 추출
NOTION_PAGES = {
    "14RAE-SOP-SSOT": "3955efd0e46281dab7f3cbd905a15dfd",
    "14RAE-금융현황": "3865efd0e46281c49a72c9bbc70dcea0",
    "금융비서-현황": "38f5efd0e46281e8a1a0e35bfb864dc6",
}

# Obsidian 저장 폴더
OBSIDIAN_DIR = Path("./🎯\ Projects")
OBSIDIAN_DIR.mkdir(parents=True, exist_ok=True)


def convert_blocks_to_markdown(blocks):
    """노션 블록을 마크다운으로 변환"""
    markdown = []

    for block in blocks:
        block_type = block.get("type")

        if block_type == "paragraph":
            text = extract_text(block["paragraph"]["rich_text"])
            if text:
                markdown.append(text)
                markdown.append("")

        elif block_type == "heading_1":
            text = extract_text(block["heading_1"]["rich_text"])
            if text:
                markdown.append(f"# {text}")
                markdown.append("")

        elif block_type == "heading_2":
            text = extract_text(block["heading_2"]["rich_text"])
            if text:
                markdown.append(f"## {text}")
                markdown.append("")

        elif block_type == "heading_3":
            text = extract_text(block["heading_3"]["rich_text"])
            if text:
                markdown.append(f"### {text}")
                markdown.append("")

        elif block_type == "bulleted_list_item":
            text = extract_text(block["bulleted_list_item"]["rich_text"])
            if text:
                markdown.append(f"- {text}")

        elif block_type == "numbered_list_item":
            text = extract_text(block["numbered_list_item"]["rich_text"])
            if text:
                markdown.append(f"1. {text}")

        elif block_type == "code":
            code_text = extract_text(block["code"]["rich_text"])
            language = block["code"].get("language", "")
            if code_text:
                markdown.append(f"```{language}")
                markdown.append(code_text)
                markdown.append("```")
                markdown.append("")

        elif block_type == "quote":
            text = extract_text(block["quote"]["rich_text"])
            if text:
                markdown.append(f"> {text}")
                markdown.append("")

        elif block_type == "divider":
            markdown.append("---")
            markdown.append("")

        elif block_type == "table":
            markdown.append("| Table |\n| --- |")
            markdown.append("")

    return "\n".join(markdown)


def extract_text(rich_text_array):
    """Notion의 rich_text 배열에서 텍스트 추출"""
    text_parts = []
    for item in rich_text_array:
        if item.get("type") == "text":
            text = item["text"].get("content", "")

            # 링크 처리
            if item["text"].get("link"):
                url = item["text"]["link"].get("url", "")
                text_parts.append(f"[{text}]({url})")
            else:
                # 포맷팅 처리
                annotations = item.get("annotations", {})
                if annotations.get("bold"):
                    text = f"**{text}**"
                if annotations.get("italic"):
                    text = f"*{text}*"
                if annotations.get("strikethrough"):
                    text = f"~~{text}~~"
                if annotations.get("code"):
                    text = f"`{text}`"
                text_parts.append(text)

    return "".join(text_parts)


def sync_notion_page(page_name, page_id):
    """노션 페이지를 Obsidian으로 동기화"""
    try:
        print(f"\n📖 처리 중: {page_name}")

        # 페이지 정보 가져오기
        page = client.pages.retrieve(page_id)

        # 페이지 제목 추출
        title = page_name
        if "properties" in page and "title" in page["properties"]:
            title_prop = page["properties"]["title"]
            if title_prop.get("title"):
                title = extract_text(title_prop["title"])

        # 페이지 내용 가져오기
        blocks_response = client.blocks.children.list(page_id)
        blocks = blocks_response.get("results", [])

        # 마크다운으로 변환
        content = convert_blocks_to_markdown(blocks)

        # Front Matter 작성
        now = datetime.now()
        frontmatter = f"""---
title: {title}
notion-id: {page_id}
created: {now.strftime('%Y-%m-%d')}
synced: {now.strftime('%Y-%m-%d %H:%M:%S')}
tags: [notion-sync, 금융비서]
---

"""

        full_content = frontmatter + content

        # 파일명 정리
        safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()
        filepath = OBSIDIAN_DIR / f"{safe_title}.md"

        # 파일 저장
        filepath.write_text(full_content, encoding="utf-8")
        print(f"✅ 저장됨: {filepath.relative_to('.')}")

        return True

    except Exception as e:
        print(f"❌ 오류: {page_name} - {str(e)}")
        return False


def commit_changes(message):
    """Git에 커밋"""
    try:
        subprocess.run(["git", "add", "🎯\\ Projects/"], check=True)
        subprocess.run(
            ["git", "commit", "-m", message],
            check=True
        )
        subprocess.run(
            ["git", "push", "origin", "claude/obsidian-git-integration-tm1g0z"],
            check=True
        )
        print("\n✅ Git 커밋/푸시 완료!")
    except subprocess.CalledProcessError as e:
        print(f"\n⚠️ Git 오류: {e}")


def main():
    """메인 동기화 함수"""
    print("=" * 60)
    print("🔄 Notion → Obsidian 동기화 시작")
    print("=" * 60)

    success_count = 0

    for page_name, page_id in NOTION_PAGES.items():
        if sync_notion_page(page_name, page_id):
            success_count += 1

    print("\n" + "=" * 60)
    print(f"📊 결과: {success_count}/{len(NOTION_PAGES)} 페이지 동기화 성공")
    print("=" * 60)

    if success_count > 0:
        commit_message = f"📥 노션 데이터 동기화: {success_count}개 페이지\n\n금융비서 노션 데이터 자동 가져오기\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
        commit_changes(commit_message)

    print("\n✨ 동기화 완료!")


if __name__ == "__main__":
    main()
