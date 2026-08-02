package io.github.vierzhen.myassets;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.util.Calendar;
import java.util.TimeZone;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A32f: 평일 장마감 텔레그램 리포트 자동발신.
 * 매일 정해진 시각(기본 16:05 KST — 국내 장마감 후)에 MainActivity를 자동 실행시켜
 * (AlarmManager.setAlarmClock — 알람앱과 같은 취급이라 별도 권한 없이 Doze 영향도 안 받음)
 * 실제 웹앱 로직(auto-report.js의 buildReportText/sendTelegramMessage)을 그대로 돌린 뒤
 * 스스로 화면을 닫는다. 켜짐 여부는 이 앱 전용 SharedPreferences에 보관한다 — 네이티브
 * 코드가 WebView의 localStorage를 직접 읽을 방법이 없기 때문에, JS 쪽 토글(설정 탭)이
 * 바뀔 때마다 setEnabled()를 호출해 두 저장소를 동기화한다.
 */
@CapacitorPlugin(name = "AutoReport")
public class AutoReportPlugin extends Plugin {
  static final String PREFS = "auto_report_prefs";
  static final String KEY_ENABLED = "enabled";
  static final String EXTRA_TRIGGER = "auto_report_trigger";
  static final int REQUEST_CODE = 4201;
  // 장마감 확정 후 여유를 둔 시각 — signal-alert.yml의 국내 마감 스케줄(16:05 KST)과 맞춘다.
  static final int HOUR_KST = 16;
  static final int MINUTE_KST = 5;

  @PluginMethod
  public void setEnabled(PluginCall call) {
    boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
    if (enabled) {
      scheduleNext(getContext());
    } else {
      cancel(getContext());
    }
    call.resolve();
  }

  @PluginMethod
  public void getEnabled(PluginCall call) {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    JSObject ret = new JSObject();
    ret.put("enabled", prefs.getBoolean(KEY_ENABLED, false));
    call.resolve(ret);
  }

  // 이번 실행(Activity 시작)이 자동 리포트 트리거였는지 — 사람이 직접 앱을 열었을 때는
  // JS가 자동발신 로직을 돌리면 안 되므로 이 플래그로 구분한다.
  @PluginMethod
  public void isAutoLaunch(PluginCall call) {
    Intent intent = getActivity() != null ? getActivity().getIntent() : null;
    JSObject ret = new JSObject();
    ret.put("auto", intent != null && intent.getBooleanExtra(EXTRA_TRIGGER, false));
    call.resolve(ret);
  }

  // 자동발신 로직(리포트 전송 + 스냅샷 저장) 완료 후 JS가 호출 — 다음 평일 알람을 다시 걸고
  // 화면을 닫는다(자동 실행이므로 사용자가 계속 볼 필요 없음).
  @PluginMethod
  public void reportDone(PluginCall call) {
    scheduleNext(getContext());
    call.resolve();
    if (getActivity() != null) {
      getActivity().finish();
    }
  }

  static void scheduleNext(Context context) {
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    long triggerAt = nextWeekdayTriggerMillis();
    PendingIntent showIntent = buildPendingIntent(context);
    // setAlarmClock: 별도 권한(SCHEDULE_EXACT_ALARM) 없이 항상 정확한 시각에 동작하고
    // Doze의 영향을 받지 않는다(알람시계 앱과 같은 취급) — 상태바에 알람 아이콘이 하나 뜨는
    // 부작용은 있지만, "매일 정해진 시각에 앱이 자동 실행"이라는 요구에 정확히 맞는 API다.
    am.setAlarmClock(new AlarmManager.AlarmClockInfo(triggerAt, showIntent), showIntent);
  }

  static void cancel(Context context) {
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    am.cancel(buildPendingIntent(context));
  }

  private static PendingIntent buildPendingIntent(Context context) {
    Intent activityIntent = new Intent(context, MainActivity.class);
    activityIntent.putExtra(EXTRA_TRIGGER, true);
    activityIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return PendingIntent.getActivity(
        context, REQUEST_CODE, activityIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  // 평일(월~금) 16:05 KST 중 다음으로 다가오는 시각 — 이미 지난 시각이면 다음 영업일로.
  static long nextWeekdayTriggerMillis() {
    TimeZone kst = TimeZone.getTimeZone("Asia/Seoul");
    Calendar cal = Calendar.getInstance(kst);
    cal.set(Calendar.HOUR_OF_DAY, HOUR_KST);
    cal.set(Calendar.MINUTE, MINUTE_KST);
    cal.set(Calendar.SECOND, 0);
    cal.set(Calendar.MILLISECOND, 0);
    Calendar now = Calendar.getInstance(kst);
    if (!cal.after(now)) {
      cal.add(Calendar.DAY_OF_MONTH, 1);
    }
    while (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
      cal.add(Calendar.DAY_OF_MONTH, 1);
    }
    return cal.getTimeInMillis();
  }

  // 앱이 켜질 때마다(수동이든 자동이든) 스케줄이 살아있는지 확인해 다시 건다 — 일부 제조사의
  // 강한 배터리 최적화가 예고 없이 알람을 지우는 경우, 재부팅으로 알람이 초기화되는 경우에
  // 대한 자기 치유(MainActivity.onCreate·BootReceiver에서 호출).
  static void reconcile(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    if (prefs.getBoolean(KEY_ENABLED, false)) {
      scheduleNext(context);
    }
  }
}
