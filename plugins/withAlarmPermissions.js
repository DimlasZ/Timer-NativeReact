const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withAlarmPermissions(config) {
  // 1. Add showWhenLocked + turnScreenOn to MainActivity
  config = withAndroidManifest(config, (config) => {
    const activity = config.modResults.manifest.application[0].activity[0];
    activity.$['android:showWhenLocked'] = 'true';
    activity.$['android:turnScreenOn'] = 'true';
    return config;
  });

  // 2. Copy alarm.wav into res/raw so notifee can reference it by name
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const rawDir = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'raw'
      );
      if (!fs.existsSync(rawDir)) {
        fs.mkdirSync(rawDir, { recursive: true });
      }
      const src = path.join(config.modRequest.projectRoot, 'assets', 'sounds', 'alarm.wav');
      const dest = path.join(rawDir, 'alarm.wav');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('[withAlarmPermissions] Copied alarm.wav to res/raw');
      } else {
        console.warn('[withAlarmPermissions] alarm.wav not found at', src);
      }
      return config;
    },
  ]);

  return config;
};
