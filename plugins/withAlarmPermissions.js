const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withAlarmPermissions(config) {
  // 1. Add showWhenLocked + turnScreenOn to MainActivity
  // 2. Register AlarmChannelProvider in the manifest (auto-inits before app code)
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];

    const activity = application.activity[0];
    activity.$['android:showWhenLocked'] = 'true';
    activity.$['android:turnScreenOn'] = 'true';

    // Register the ContentProvider that creates the alarm channel natively
    if (!application.provider) application.provider = [];
    const packageName = config.android?.package ?? 'com.dimlas.TimerNativeReact';
    const alreadyAdded = (application.provider ?? []).some(
      (p) => p.$?.['android:name'] === '.AlarmChannelProvider'
    );
    if (!alreadyAdded) {
      application.provider.push({
        $: {
          'android:name': '.AlarmChannelProvider',
          'android:authorities': `${packageName}.alarm_channel_provider`,
          'android:exported': 'false',
          'android:initOrder': '100',
        },
      });
    }

    return config;
  });

  // 3. Copy alarm.wav + write AlarmChannelProvider.java
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const platformRoot = config.modRequest.platformProjectRoot;
      const projectRoot = config.modRequest.projectRoot;
      const packageName = config.android?.package ?? 'com.dimlas.TimerNativeReact';

      // Copy alarm.wav to res/raw
      const rawDir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'raw');
      if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });
      const src = path.join(projectRoot, 'assets', 'sounds', 'alarm.wav');
      const dest = path.join(rawDir, 'alarm.wav');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('[withAlarmPermissions] Copied alarm.wav to res/raw');
      } else {
        console.warn('[withAlarmPermissions] alarm.wav not found at', src);
      }

      // Write AlarmChannelProvider.java
      // This ContentProvider runs before the JS bundle and creates the notification
      // channel with AudioAttributes.USAGE_ALARM so all three alarms (40min, 20min,
      // final) use alarm volume. Android ignores audio attribute changes on existing
      // channels, so we must create it here before notifee does.
      const javaDir = path.join(
        platformRoot, 'app', 'src', 'main', 'java',
        ...packageName.split('.')
      );
      if (!fs.existsSync(javaDir)) fs.mkdirSync(javaDir, { recursive: true });

      const javaContent = `package ${packageName};

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

public class AlarmChannelProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager)
                getContext().getSystemService(getContext().NOTIFICATION_SERVICE);
            if (nm == null) return false;

            NotificationChannel channel = new NotificationChannel(
                "timer-alarm-v2",
                "Timer Alarm",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setBypassDnd(true);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{300, 300});

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

            Uri soundUri = Uri.parse(
                "android.resource://" + getContext().getPackageName() + "/raw/alarm"
            );
            channel.setSound(soundUri, audioAttributes);

            nm.createNotificationChannel(channel);
        }
        return false;
    }

    @Override public Cursor query(Uri u, String[] p, String s, String[] sa, String so) { return null; }
    @Override public String getType(Uri u) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] sa) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] sa) { return 0; }
}
`;

      fs.writeFileSync(path.join(javaDir, 'AlarmChannelProvider.java'), javaContent);
      console.log('[withAlarmPermissions] Wrote AlarmChannelProvider.java');

      return config;
    },
  ]);

  return config;
};
