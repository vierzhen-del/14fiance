package io.github.vierzhen.myassets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 기기 재부팅 시 AlarmManager의 모든 알람이 초기화되므로, 자동 리포트가 켜져 있었다면 재등록한다. */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent != null && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
      AutoReportPlugin.reconcile(context.getApplicationContext());
    }
  }
}
