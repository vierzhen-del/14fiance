// app/src/auto-report.js — APK 전용: 평일 장마감 텔레그램 리포트 자동발신(A32f).
// 네이티브 AutoReportPlugin(AlarmManager.setAlarmClock)이 정해진 시각에 MainActivity를
// 자동 실행시키면, 이 스크립트가 그 실행을 감지해 실제 리포트 생성·전송·스냅샷 저장을
// 수행하고 스스로 화면을 닫는다. 사람이 직접 앱을 연 경우에는 아무 것도 하지 않는다.
// build-www.mjs가 이 파일을 www에 복사하고 index.html에 <script>로 주입한다.
(function () {
  if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
  const AutoReport = window.Capacitor.Plugins && window.Capacitor.Plugins.AutoReport;
  if (!AutoReport) return;

  const AUTO_REPORT_KEY = "my_assets_auto_report_enabled_v1";

  // 설정 탭 토글 — localStorage(사람이 보는 UI 상태)와 네이티브 SharedPreferences(알람 스케줄
  // 담당)를 함께 갱신한다. 네이티브 코드는 브라우저 localStorage를 읽을 방법이 없으므로
  // 반드시 이 호출로 동기화해야 한다.
  window.setAutoReportEnabled = async function (enabled) {
    localStorage.setItem(AUTO_REPORT_KEY, enabled ? "1" : "0");
    try {
      await AutoReport.setEnabled({ enabled: !!enabled });
    } catch (err) {
      console.warn("AutoReport.setEnabled 실패:", err);
    }
  };
  window.getAutoReportEnabled = function () {
    return localStorage.getItem(AUTO_REPORT_KEY) === "1";
  };

  async function waitFor(cond, timeoutMs) {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
    return true;
  }

  async function runAutoReport() {
    const ready = await waitFor(() => typeof state !== "undefined" && state.listedEtfs && state.listedEtfs.length > 0, 20000);
    if (!ready) return;
    // init()에서 이미 한 번 렌더됐어도, 최신 시세를 다시 반영하도록 재렌더한다.
    if (typeof renderMyAssets === "function") await renderMyAssets();
    await waitFor(() => state.myAssetsCsvData != null, 5000);
    const csv = state.myAssetsCsvData;
    if (!csv || !csv.perRow || !csv.perRow.length) return; // 입력된 보유 종목이 없으면 보낼 리포트가 없음

    // 「추이」 탭 "오늘 자산 스냅샷" 버튼과 완전히 같은 로직 재사용 — 별도 구현 없이 클릭을
    // 그대로 시뮬레이션해 화면 버튼과 항상 같은 결과를 보장한다.
    const dailyBtn = document.getElementById("myDailySnapshotBtn");
    if (dailyBtn) dailyBtn.click();

    try {
      const history = JSON.parse(localStorage.getItem("my_assets_history_v1") || "[]");
      const text = await buildReportText(csv, history);
      if (text) {
        const tgText = text.length > 4000 ? text.slice(0, 3900) + "\n…(길이 제한으로 이하 생략)" : text;
        await sendTelegramMessage(`📤 자동 장마감 리포트 (${todayStr()})\n\n${tgText}`);
      }
    } catch (err) {
      console.error("자동 리포트 실패:", err);
    }
  }

  let checking = false; // 중복 트리거(콜드 스타트 + onNewIntent 재호출 등) 방지
  async function maybeRunOnLaunch() {
    if (checking) return;
    checking = true;
    try {
      let auto = false;
      try {
        const r = await AutoReport.isAutoLaunch();
        auto = !!(r && r.auto);
      } catch (err) {
        auto = false;
      }
      if (!auto) return;
      await runAutoReport();
      try {
        await AutoReport.reportDone();
      } catch (err) {
        /* 실패해도 화면이 계속 떠 있는 정도라 치명적이지 않음 */
      }
    } finally {
      checking = false;
    }
  }

  // MainActivity가 launchMode="singleTask"라, 앱이 이미 메모리에 떠 있는 상태로 알람이
  // 다시 울리면 onCreate가 아니라 onNewIntent로 들어온다 — 이 경우 페이지는 이미 로드돼
  // 있어 아래 setTimeout(1회성)이 다시 실행되지 않으므로, 네이티브가 onNewIntent에서
  // 이 함수를 직접 호출할 수 있도록 전역으로도 노출해 둔다.
  window.__checkAutoReportTrigger = maybeRunOnLaunch;

  // init()의 렌더 순서와 경쟁하지 않도록 다음 틱에 시작(콜드 스타트 경로).
  setTimeout(maybeRunOnLaunch, 0);
})();
