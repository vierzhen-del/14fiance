# Tab S9 ↔ S26 Obsidian vault 동기화 — Syncthing 설정

`n8n/README.md`의 "S26에서 열람하려면 Syncthing 또는 Obsidian Sync 별도 구성 필요(미해결)" 항목 해결용 절차. Obsidian Git 플러그인은 Android에서 desktop-only 취급으로 검색 자체가 막히는 경우가 흔해 배제 — Syncthing은 Obsidian 플러그인이 아니라 **OS 레벨 파일 동기화**라 Obsidian과 무관하게 동작한다(n8n이 vault에 직접 쓰는 방식과 동일한 원리).

vault 경로(양쪽 기기 동일해야 함): `/storage/emulated/0/Documents/vierzhen_home/MyVault`

## 1. 앱 설치 (Tab S9·S26 둘 다)

Google Play에서 **Syncthing**(공식, Syncthing Foundation) 설치. proot/Termux와 무관 — 일반 Android 앱이라 Tab S9도 proot 밖에서 설치.

첫 실행 시 안드로이드 저장공간 접근 권한(전체 파일 접근, "모든 파일 관리" 권한)을 반드시 허용 — 안 그러면 `/storage/emulated/0/Documents/...` 아래 폴더를 선택할 수 없음.

## 2. 기기 페어링

1. 양쪽 앱에서 우측 상단 메뉴 → **내 기기 정보(This Device)** → Device ID(긴 영숫자 문자열) 확인
2. Tab S9에서 **기기 추가(Add Device)** → S26의 Device ID 입력(QR 스캔이 더 쉬움 — 서로 화면에 QR 코드 표시 가능) → 저장
3. S26에서도 동일하게 Tab S9의 Device ID로 기기 추가
4. 같은 와이파이가 아니어도 Syncthing 내장 글로벌 디스커버리/릴레이로 인터넷 통해 페어링됨(로컬 네트워크면 더 빠름) — 양쪽에서 서로 "새 기기 추가 요청" 알림이 뜨면 수락

## 3. 폴더 공유

1. **Tab S9**(원본 — n8n이 쓰는 쪽)에서 **폴더 추가(Add Folder)**:
   - 폴더 경로: `/storage/emulated/0/Documents/vierzhen_home/MyVault`
   - 폴더 타입: **Send & Receive**(양방향 — S26에서도 메모 수정 가능하게)
   - 공유 대상: S26 체크
2. **S26**에 "폴더 공유 요청" 알림이 뜨면 수락, 로컬 저장 경로 지정(같은 하위 경로 `Documents/vierzhen_home/MyVault` 권장 — 나중에 헷갈리지 않음)
3. Obsidian 앱(S26)에서 "폴더 열기" → 위에서 지정한 경로를 vault로 열기

## 4. 확인

- Tab S9에서 n8n `notion-obsidian-sync` 워크플로우를 한 번 수동 실행(또는 다음 매시간 자동 실행 대기) → `_notion-sync/*.md` 갱신
- S26 Syncthing 앱에서 해당 폴더가 "최신 상태(Up to Date)"로 바뀌는지 확인(수 초~수 분 소요, 네트워크 상태에 따라 다름)
- S26의 Obsidian 앱에서 갱신된 노트가 실제로 보이는지 확인

## 참고

- **충돌 처리**: 두 기기에서 동시에 같은 파일을 수정하면 Syncthing이 `파일명.sync-conflict-날짜-기기ID.md`로 별도 저장 — 자동 병합 안 함, 수동으로 확인 후 정리. n8n은 `_notion-sync/`만 쓰고 S26에서는 대부분 열람만 할 거라 실제 충돌 가능성은 낮음
- **배터리/백그라운드**: Android가 절전 최적화로 Syncthing을 죽이면 동기화가 지연될 수 있음 — 설정에서 Syncthing을 배터리 최적화 제외 목록에 추가 권장
- 시크릿 없음(Device ID는 공개 식별자, 실제 데이터는 두 기기 간 직접 암호화 전송 — 별도 클라우드 서버에 vault 내용이 저장되지 않음) — SENTINEL ③ 해당 없음
