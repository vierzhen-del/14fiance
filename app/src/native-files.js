// app/src/native-files.js — APK(Capacitor 네이티브) 전용 파일 백업/복원.
// @capacitor/filesystem으로 안드로이드 공용 문서 폴더(Documents/14fiance/)에 내보내기·
// 자동백업 파일을 저장하고 실제 경로를 표시한다. 재설치 후 "📂 백업 폴더에서 복원" 버튼
// 한 번으로 파일 선택 없이 전 이력을 복원한다. 웹(비네이티브)에서는 아무 것도 하지 않고
// capture/index.html의 기본 구현(브라우저 다운로드)을 그대로 쓴다.
// build-www.mjs가 이 파일을 www에 복사하고 index.html에 <script>로 주입한다.
(function () {
  if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
  const Filesystem = window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
  if (!Filesystem) return;

  // Capacitor Directory enum의 실제 네이티브 문자열 값(대소문자 그대로 일치해야 함 — "Documents"처럼
  // TS enum 키를 그대로 쓰면 안드로이드 플러그인이 매칭 못 해 INVALID_DIR 오류가 난다).
  const DIR_PRIMARY = "DOCUMENTS"; // 공용 문서 폴더 — 앱 삭제 후에도 대개 잔존하지만 Android 11+ 권한 필요
  const DIR_FALLBACK = "EXTERNAL"; // 앱 전용 외부 저장소 — 권한 불필요, 항상 쓰기 가능(단, 완전 삭제 시 함께 삭제될 수 있음)
  const FOLDER = "14fiance";
  const BACKUP_NAME = "latest-backup.json";
  const DISPLAY_PATH = "문서/14fiance"; // 사용자에게 보여줄 사람이 읽는 경로

  // path는 폴더를 포함한 상대경로(예: "14fiance/latest-backup.json") — 옵시디안 볼트처럼
  // 사용자 지정 하위 경로에도 쓸 수 있도록 파일명이 아니라 경로를 그대로 받는다.
  async function writeTextTo(dir, path, text) {
    await Filesystem.writeFile({
      path,
      data: text,
      directory: dir,
      encoding: "utf8",
      recursive: true,
    });
    try {
      const { uri } = await Filesystem.getUri({ path, directory: dir });
      return uri;
    } catch (e) {
      return path;
    }
  }

  async function writeJsonTo(dir, name, jsonStr) {
    return writeTextTo(dir, `${FOLDER}/${name}`, jsonStr);
  }

  // 공용 문서 폴더 우선 시도(권한 거부·스코프드 스토리지 제한 등으로 실패하면) 앱 전용 외부
  // 저장소로 자동 폴백 — 둘 중 하나는 항상 성공하도록 해 "내보내기 실패"가 뜨지 않게 한다.
  let lastWorkingDir = null;
  async function writeJson(name, jsonStr) {
    try {
      const uri = await writeJsonTo(DIR_PRIMARY, name, jsonStr);
      lastWorkingDir = DIR_PRIMARY;
      return uri;
    } catch (primaryErr) {
      try {
        const uri = await writeJsonTo(DIR_FALLBACK, name, jsonStr);
        lastWorkingDir = DIR_FALLBACK;
        console.warn("Documents 저장 실패, 앱 전용 저장소로 대체:", primaryErr.message);
        return uri;
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
  }

  function flash(statusElId, msg) {
    if (typeof flashStatus === "function" && statusElId) flashStatus(statusElId, msg);
  }

  // 내보내기 저장 오버라이드 — 타임스탬프 파일 + 고정 백업 파일 둘 다 기록, 실제 경로 표시
  window.saveMyAssetsExport = async function (jsonStr, filename, statusElId) {
    try {
      const uri = await writeJson(filename, jsonStr);
      await writeJson(BACKUP_NAME, jsonStr); // 복원 버튼이 읽는 고정 파일도 최신화
      const note = lastWorkingDir === DIR_FALLBACK ? " (앱 전용 저장소 — 완전 삭제 시 함께 삭제될 수 있어 중요 시점엔 📤 내보내기 파일도 별도 보관 권장)" : "";
      flash(statusElId, `내보내기 완료 — ${DISPLAY_PATH}/${filename}${note}`);
      console.log("native export saved:", uri);
    } catch (err) {
      flash(statusElId, `내보내기 실패: ${err.message}`);
    }
  };

  // 데이터 변경·스냅샷 시 백업 파일 자동 갱신(호출은 saveMyAssets/스냅샷 핸들러에서)
  let backupTimer = null;
  window.autoBackupMyAssets = function () {
    // 짧은 시간 다중 호출을 합쳐서 한 번만 기록(디바운스)
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = setTimeout(async () => {
      try {
        if (typeof serializeMyAssets !== "function") return;
        await writeJson(BACKUP_NAME, JSON.stringify(serializeMyAssets(), null, 2));
        // A25d: 옵시디안 경로가 설정돼 있으면 노트도 같은 주기로 갱신(미설정이면 즉시 반환)
        await window.exportObsidianNotes();
      } catch (err) {
        console.warn("autoBackup 실패:", err.message);
      }
    }, 800);
  };

  /* A25d: 옵시디안 볼트 백업 — 설정 탭에 저장된 상대경로(예: "Obsidian/14rae") 아래
     "<볼트>/14fiance/"에 md+json 쌍을 기록한다. 본문 생성은 shared/myassets.js의
     buildObsidianNotes()(순수 함수)가 맡고 여기서는 파일 기록만 담당한다.
     경로 미설정이면 조용히 건너뛴다 — 백업을 안 쓰는 사용자에게 오류를 띄우지 않기 위함. */
  window.exportObsidianNotes = async function () {
    try {
      if (typeof obsidianVaultPath !== "function" || typeof buildObsidianNotes !== "function") return false;
      const vault = obsidianVaultPath();
      if (!vault) return false;
      const notes = buildObsidianNotes();
      let dir = lastWorkingDir || DIR_PRIMARY;
      for (const note of notes) {
        const path = `${vault}/${FOLDER}/${note.name}`;
        try {
          await writeTextTo(dir, path, note.text);
        } catch (primaryErr) {
          // 문서 폴더 권한이 없으면 앱 전용 외부 저장소로 폴백(기존 writeJson과 같은 정책)
          dir = dir === DIR_PRIMARY ? DIR_FALLBACK : DIR_PRIMARY;
          await writeTextTo(dir, path, note.text);
        }
      }
      /* A69(2026-08-26): 볼트에도 latest-backup.json을 남긴다.

         종전에는 이 파일이 `Documents/14fiance/` 에만 있었다 — writeJson이 FOLDER를
         고정으로 붙여서 볼트 경로 설정을 타지 않았기 때문. 그래서 Obsidian Git이
         동기화하는 `14fiance_asset` 레포에 들어가지 않았고, **Tab S9에는 도달하지
         않았다.** Tab S9의 n8n(자산 CLI)이 계좌·배당·MDD 질문에 답하려면 이
         파일이 필요한데 기기에 없어서 답할 수가 없었다.

         내용은 Documents 사본과 동일한 serializeMyAssets() 출력이다. 볼트는
         2계층 정책상 "기기 안" 계층이라 원문을 그대로 둔다(마스킹하지 않는다) —
         마스킹하면 Tab S9에서 어느 계좌인지 대조가 안 돼 목적을 잃는다.

         ⚠️ 볼트가 git 레포(`14fiance_asset`, private)와 연결돼 있으면 이 파일도
         함께 푸시된다. 그 레포가 public이 되면 보유수량·매입단가 전체가 노출된다. */
      if (typeof serializeMyAssets === "function") {
        const backupPath = `${vault}/${FOLDER}/${BACKUP_NAME}`;
        const backupText = JSON.stringify(serializeMyAssets(), null, 2);
        try {
          await writeTextTo(dir, backupPath, backupText);
        } catch (primaryErr) {
          dir = dir === DIR_PRIMARY ? DIR_FALLBACK : DIR_PRIMARY;
          await writeTextTo(dir, backupPath, backupText);
        }
      }
      lastWorkingDir = dir;
      console.log(`obsidian notes saved: ${vault}/${FOLDER}/ (${notes.length} files + ${BACKUP_NAME})`);
      return true;
    } catch (err) {
      console.warn("옵시디안 백업 실패:", err.message);
      return false;
    }
  };

  /* A28: 종합 탭 "📤 리포트 생성"에서 옵시디안을 선택하면 부르는 함수. buildReportText()가
     만든 텍스트를 그대로 저장한다(별도 가공 없음) — exportObsidianNotes와 같은 볼트에
     남기지만 파일이 다르므로(고정 이력 노트 vs 그때그때 생성되는 리포트) 별도 함수로 둔다.
     경로 미설정이면 조용히 건너뛴다(옵시디안 백업과 동일 정책). */
  window.exportReportNote = async function (text) {
    try {
      if (typeof obsidianVaultPath !== "function") return false;
      const vault = obsidianVaultPath();
      if (!vault) return false;
      const path = `${vault}/${FOLDER}/종합-리포트.md`;
      let dir = lastWorkingDir || DIR_PRIMARY;
      try {
        await writeTextTo(dir, path, text);
      } catch (primaryErr) {
        dir = dir === DIR_PRIMARY ? DIR_FALLBACK : DIR_PRIMARY;
        await writeTextTo(dir, path, text);
      }
      lastWorkingDir = dir;
      return true;
    } catch (err) {
      console.warn("리포트 노트 저장 실패:", err.message);
      return false;
    }
  };

  async function readBackupJson() {
    // 저장 시 DOCUMENTS/EXTERNAL 중 어느 쪽에 실제로 기록됐는지 알 수 없으므로(권한 상태가
    // 그 사이 바뀔 수도 있음) 두 위치를 순서대로 시도한다.
    let lastErr = null;
    for (const dir of [DIR_PRIMARY, DIR_FALLBACK]) {
      try {
        const { data } = await Filesystem.readFile({
          path: `${FOLDER}/${BACKUP_NAME}`,
          directory: dir,
          encoding: "utf8",
        });
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("백업 파일을 찾을 수 없습니다");
  }

  // "📂 백업 폴더에서 복원" 버튼 — 고정 백업 파일을 읽어 파일 선택 없이 복원
  function wireRestoreButton() {
    const btn = document.getElementById("myBackupRestoreBtn");
    if (!btn) return;
    btn.style.display = ""; // 네이티브에서만 노출
    btn.addEventListener("click", async () => {
      try {
        const data = await readBackupJson();
        const parsed = JSON.parse(data);
        if (typeof applyMyAssets !== "function" || !applyMyAssets(parsed)) throw new Error("백업 형식이 맞지 않습니다");
        if (typeof state === "object") state.myAssetsImportedAt = typeof nowDateTimeStr === "function" ? nowDateTimeStr() : "";
        if (typeof saveMyAssets === "function") saveMyAssets();
        if (typeof renderMyAssets === "function") await renderMyAssets();
        flash("myAssetStatus", `복원 완료 ✓ — ${DISPLAY_PATH}/${BACKUP_NAME} (보유·이력 전체)`);
      } catch (err) {
        const notFound = /not exist|not found|ENOENT|unable to read/i.test(err.message || "");
        flash("myAssetStatus", notFound
          ? `백업 파일이 없습니다 — 먼저 📤 내보내기를 한 번 하거나, 수동 내보내기 파일을 📂 가져오기 하세요`
          : `복원 실패: ${err.message}`);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireRestoreButton);
  } else {
    wireRestoreButton();
  }
})();
