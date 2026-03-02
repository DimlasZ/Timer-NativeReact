const { withAndroidManifest } = require('@expo/config-plugins');

// Adds showWhenLocked + turnScreenOn to MainActivity so the alarm
// can wake the screen and display on the lock screen.
module.exports = function withAlarmPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application[0];
    const activity = application.activity[0];

    activity.$['android:showWhenLocked'] = 'true';
    activity.$['android:turnScreenOn'] = 'true';

    return config;
  });
};
