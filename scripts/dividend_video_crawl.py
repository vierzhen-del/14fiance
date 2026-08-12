#!/usr/bin/env python3
"""배당의만장 유튜브 채널의 이번 달 배당 공시 영상을 수집해 텔레그램으로 알린다.

매달 말일에 돌면서 그달 월초·월중·월말 영상을 모아 링크를 보내고, 다음 달 6일
「월배당 확정」 루틴이 그 링크를 근거로 배당기준 마스터를 확정한다.

설계 원칙 — 숫자는 자동으로 읽지 않는다.
    영상의 분배금 표는 음성이 아니라 슬라이드 **이미지**에 있어서 자막으로는 복원되지 않고,
    비전 OCR로 뽑으면 틀린 숫자가 조용히 배당기준 마스터에 들어갈 수 있다(2026-08-02
    divRate 누락으로 월배당이 ₩2.3M 부풀었던 것과 같은 계열의 사고). 그래서 이 스크립트는
    **영상을 찾아 링크를 전달하는 데까지만** 하고, 표 판독은 사용자 캡처 → Claude 판독 →
    노션 아카이브 적재 경로를 유지한다.

시크릿/변수 (전부 선택 — 없으면 그 단계만 건너뛰고 정상 종료):
    TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID  발송용. 미설정 시 콘솔 출력만.
    DIVIDEND_CHANNEL_ID                    UC로 시작하는 채널 ID. 미설정 시 시드 영상에서 역추적.
    DIVIDEND_SEED_VIDEO                    채널 ID 역추적용 시드 영상 ID(기본값 내장).
    NOTION_TOKEN                           설정 시 아카이브 페이지에 이번 달 절을 자동 추가.
    TARGET_MONTH                           YYYY-MM. 수동 실행 시 특정 달 지정용(기본: 오늘 기준 이번 달).
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

KST = timezone(timedelta(hours=9))

# 노션 「📺 배당의만장 배당표 아카이브」 — scripts/notion_sop.json 의 dividend_video_archive 와 동일.
# 여기 하드코딩된 값은 레지스트리를 읽지 못할 때의 폴백일 뿐이다.
ARCHIVE_FALLBACK_ID = "3ba5efd0-e462-8123-ac07-e98a4375fbac"
SEED_VIDEO_DEFAULT = "X4rG16Txtqg"
REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "notion_sop.json")

# 제목에 이 말들이 있으면 해당 슬롯으로 태깅한다. 매칭이 안 돼도 버리지 않고
# "기타"로 함께 보낸다 — 채널이 제목 형식을 바꿔도 영상을 놓치지 않기 위함.
SLOT_PATTERNS = [
    ("월초", re.compile(r"월\s*초|초순")),
    ("월중", re.compile(r"월\s*중|중순")),
    ("월말", re.compile(r"월\s*말|말일|하순")),
]

UA = "Mozilla/5.0 (compatible; 14fiance-dividend-crawler/1.0)"


def http_get(url, timeout=20, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def archive_page_id():
    """노션 아카이브 페이지 ID를 레지스트리에서 읽는다(하드코딩 금지 원칙)."""
    try:
        with open(REGISTRY_PATH, encoding="utf-8") as f:
            entry = json.load(f)["pages"]["dividend_video_archive"]
        return entry["id"], entry.get("url", "")
    except (OSError, KeyError, ValueError) as exc:
        print(f"⚠️ 레지스트리에서 아카이브 페이지를 못 읽음({exc}) — 폴백 ID 사용")
        return ARCHIVE_FALLBACK_ID, f"https://www.notion.so/{ARCHIVE_FALLBACK_ID.replace('-', '')}"


# ⚠️ watch 페이지에는 `"channelId"` 가 **여러 번** 나온다(추천 영상 것까지 섞임) — 첫 매치가
# 영상 주인이라는 보장이 없다. 실제로 2026-08-12 실행에서 첫 매치로 RSS 404가 났다.
# 그래서 "하나를 고른다"가 아니라 **후보를 순서대로 모아 RSS가 뚫릴 때까지 시도**한다.
# 앞쪽일수록 신뢰도가 높은 출처다(externalId = ytInitialData 상의 채널 주인).
CHANNEL_ID_PATTERNS = [
    re.compile(r'"externalId":"(UC[\w-]{22})"'),
    re.compile(r'youtube\.com/channel/(UC[\w-]{22})'),
    re.compile(r'"channelId":"(UC[\w-]{22})"'),
]
MAX_CANDIDATES = 6


def _scan_channel_ids(text):
    """신뢰도 순으로 채널 ID 후보를 뽑는다(중복 제거, 순서 유지)."""
    out = []
    for pattern in CHANNEL_ID_PATTERNS:
        for cid in pattern.findall(text or ""):
            if cid not in out:
                out.append(cid)
    return out


def channel_id_candidates():
    """채널 ID 후보를 신뢰도 순으로 모은다.

    ⚠️ Actions 워크플로는 미설정 변수를 **빈 문자열**로 넘긴다 — os.environ.get 의 기본값이
    발동하지 않으므로 반드시 `or 기본값` 으로 받아야 한다(2026-08-12 첫 실행 실패 원인).
    """
    env = (os.environ.get("DIVIDEND_CHANNEL_ID") or "").strip()
    if env.startswith("UC"):
        print(f"DIVIDEND_CHANNEL_ID 사용: {env}")
        return [env]

    seed = (os.environ.get("DIVIDEND_SEED_VIDEO") or "").strip() or SEED_VIDEO_DEFAULT
    print(f"DIVIDEND_CHANNEL_ID 미설정 — 시드 영상 {seed} 에서 채널 ID 역추적")
    candidates = []

    # ① oEmbed — 공식 API라 영상 주인 채널을 정확히 준다. 가장 신뢰도 높은 경로.
    try:
        oembed = json.loads(http_get(
            "https://www.youtube.com/oembed?format=json&url="
            + urllib.parse.quote(f"https://www.youtube.com/watch?v={seed}", safe="")))
        author_url = oembed.get("author_url", "")
        print(f"   oEmbed author_url: {author_url}")
        candidates += _scan_channel_ids(author_url)
        if not candidates and author_url:
            # author_url 이 /@handle 형태면 그 페이지에서 externalId 를 뽑는다.
            candidates += _scan_channel_ids(http_get(author_url))[:2]
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"   oEmbed 실패: {exc}")

    # ② watch 페이지 — 후보를 보강한다(순서상 뒤).
    try:
        for cid in _scan_channel_ids(http_get(f"https://www.youtube.com/watch?v={seed}")):
            if cid not in candidates:
                candidates.append(cid)
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"   영상 페이지 조회 실패: {exc}")

    candidates = candidates[:MAX_CANDIDATES]
    print(f"   후보 {len(candidates)}개: {', '.join(candidates) if candidates else '(없음)'}")
    return candidates


def fetch_feed(channel_id):
    """채널 RSS에서 최근 영상 목록을 읽는다(최대 15편). yt-dlp 불필요·봇차단 없음."""
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    xml = http_get(url)
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
    videos = []
    for entry in ElementTree.fromstring(xml).findall("a:entry", ns):
        vid = entry.findtext("yt:videoId", namespaces=ns)
        title = (entry.findtext("a:title", namespaces=ns) or "").strip()
        published = entry.findtext("a:published", namespaces=ns) or ""
        if not vid:
            continue
        try:
            when = datetime.fromisoformat(published.replace("Z", "+00:00")).astimezone(KST)
        except ValueError:
            continue
        videos.append({"id": vid, "title": title, "published": when})
    return videos


def slot_of(title):
    for name, pattern in SLOT_PATTERNS:
        if pattern.search(title):
            return name
    return "기타"


def target_month():
    env = os.environ.get("TARGET_MONTH", "").strip()
    if re.fullmatch(r"\d{4}-\d{2}", env):
        return env
    return datetime.now(KST).strftime("%Y-%m")


def is_last_day_of_month():
    today = datetime.now(KST).date()
    return (today + timedelta(days=1)).month != today.month


def build_message(month, picked, archive_url):
    lines = [f"<b>📺 배당의만장 {month} 배당 공시 영상</b>", ""]
    for slot in ("월초", "월중", "월말", "기타"):
        items = [v for v in picked if v["slot"] == slot]
        if not items:
            if slot != "기타":
                lines.append(f"{slot}: <i>아직 없음</i>")
            continue
        for v in items:
            when = v["published"].strftime("%m/%d")
            lines.append(f'{slot} ({when}) — <a href="https://youtu.be/{v["id"]}">{v["title"]}</a>')
    lines += [
        "",
        f'📓 노션 아카이브: <a href="{archive_url}">배당의만장 배당표 아카이브</a>',
        "",
        f"다음 달 6일 「월배당 확정」에서 위 링크를 근거로 {month} 분배금을 확정합니다.",
        "표가 아직 아카이브에 없으면 영상의 <b>표 화면을 캡처해 Claude에 전달</b>해 주세요 —",
        "숫자는 슬라이드 이미지라 자동 판독하지 않습니다(오판독이 배당 마스터를 오염시킴).",
    ]
    return "\n".join(lines)


def notion_append(page_id, month, picked):
    """NOTION_TOKEN이 있으면 아카이브 페이지에 이번 달 절을 추가한다(선택 단계)."""
    token = os.environ.get("NOTION_TOKEN", "").strip()
    if not token:
        print("ℹ️ NOTION_TOKEN 미설정 — 노션 자동 적재 생략(텔레그램 링크로 충분).")
        return None

    bullets = []
    for v in picked:
        when = v["published"].strftime("%Y-%m-%d")
        bullets.append({
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{
                    "type": "text",
                    "text": {"content": f'[{v["slot"]}] {when} — {v["title"]}',
                             "link": {"url": f'https://youtu.be/{v["id"]}'}},
                }]
            },
        })

    children = [
        {"object": "block", "type": "heading_2",
         "heading_2": {"rich_text": [{"type": "text", "text": {"content": f"🎬 {month} 수집 영상 (자동)"}}]}},
        {"object": "block", "type": "paragraph",
         "paragraph": {"rich_text": [{"type": "text", "text": {
             "content": "크롤러가 채널 RSS에서 찾은 이번 달 영상 목록. 표 판독은 사용자 캡처 → Claude 적재 경로로 진행한다."}}]}},
        *bullets,
    ]

    body = json.dumps({"children": children}).encode()
    req = urllib.request.Request(
        f"https://api.notion.com/v1/blocks/{page_id}/children",
        data=body, method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
        print("✅ 노션 아카이브에 이번 달 영상 목록 추가")
        return True
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        print(f"❌ 노션 적재 실패 ({exc.code}): {detail}")
        print("   통합(integration)이 아카이브 페이지에 연결돼 있는지 확인할 것.")
        return False


def send_telegram(message):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("\nℹ️ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 — 발송 생략.")
        return 0

    payload = urllib.parse.urlencode({
        "chat_id": chat_id, "text": message,
        "parse_mode": "HTML", "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            ok = json.loads(resp.read().decode()).get("ok")
    except urllib.error.HTTPError as exc:
        print(f"❌ 텔레그램 발송 실패: {exc.read().decode('utf-8', errors='replace')[:300]}")
        return 1
    print("텔레그램 발송:", "✅ 성공" if ok else "❌ 실패")
    return 0 if ok else 1


def main():
    forced = os.environ.get("FORCE_RUN", "").strip() in ("1", "true", "yes")
    if not forced and not is_last_day_of_month():
        print(f"오늘({datetime.now(KST):%Y-%m-%d})은 말일이 아님 — 종료. "
              "(cron이 28~31일 매일 돌면서 말일에만 실제 작업)")
        return 0

    candidates = channel_id_candidates()
    if not candidates:
        print("❌ 채널 ID 후보를 하나도 못 구했다 — 저장소 Settings → Secrets and variables →")
        print("   Actions → Variables 에 DIVIDEND_CHANNEL_ID(UC로 시작하는 24자)를 등록할 것.")
        return 1

    # 후보를 순서대로 시도 — RSS가 200을 주는 첫 후보가 진짜 채널이다.
    channel_id, videos = None, None
    for cid in candidates:
        try:
            videos = fetch_feed(cid)
            channel_id = cid
            print(f"✅ RSS 성공: {cid}")
            break
        except (urllib.error.URLError, ElementTree.ParseError, TimeoutError) as exc:
            print(f"   RSS 실패 {cid}: {exc}")
    if channel_id is None:
        print("❌ 모든 후보에서 RSS 조회 실패 — DIVIDEND_CHANNEL_ID 를 직접 등록할 것.")
        return 1

    month = target_month()

    picked = [{**v, "slot": slot_of(v["title"])}
              for v in videos if v["published"].strftime("%Y-%m") == month]
    picked.sort(key=lambda v: v["published"])

    print(f"채널 {channel_id} · 피드 {len(videos)}편 중 {month} 영상 {len(picked)}편")
    for v in picked:
        print(f"  [{v['slot']}] {v['published']:%m/%d} {v['title']} (https://youtu.be/{v['id']})")

    if not picked:
        print(f"⚠️ {month} 영상을 찾지 못함 — 발송 생략(채널 RSS는 최근 15편만 제공).")
        return 0

    page_id, archive_url = archive_page_id()
    notion_append(page_id, month, picked)
    message = build_message(month, picked, archive_url)
    print("=" * 60)
    print(re.sub(r"<[^>]+>", "", message))
    print("=" * 60)
    return send_telegram(message)


if __name__ == "__main__":
    sys.exit(main())
