package io.github.vierzhen.myassets;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Capacitor 커스텀 플러그인은 super.onCreate() 이전에 등록해야 브릿지 초기화 시점에 잡힌다.
    registerPlugin(AutoReportPlugin.class);
    super.onCreate(savedInstanceState);
    // A32f: 매 실행(수동·자동 모두)마다 자동 리포트 알람이 살아있는지 확인해 다시 건다.
    AutoReportPlugin.reconcile(getApplicationContext());
  }

  // A32f: MainActivity가 launchMode="singleTask"라, 알람이 울렸을 때 앱이 이미 메모리에
  // 떠 있으면 onCreate가 아니라 여기로 들어온다. getIntent()가 새 인텐트를 보게 setIntent로
  // 갱신한 뒤, 이미 로드된 웹뷰의 JS 쪽 자동발신 체크 함수를 다시 호출해 준다(콜드 스타트
  // 때만 실행되는 JS의 1회성 setTimeout 체크로는 이 경로를 못 잡기 때문).
  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (intent != null && intent.getBooleanExtra(AutoReportPlugin.EXTRA_TRIGGER, false)
        && getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().post(() ->
          getBridge().getWebView().evaluateJavascript(
              "window.__checkAutoReportTrigger && window.__checkAutoReportTrigger();", null));
    }
  }
}
