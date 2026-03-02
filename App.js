import 'expo-dev-client';
import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState, Modal } from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidCategory,
  AndroidVisibility,
  TriggerType,
  AlarmType,
  EventType,
} from '@notifee/react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Audio } from 'expo-av';

const DEFAULT_DURATION = 3; // seconds for testing
const CHANNEL_ID = 'timer-alarm';
const NOTIF_ID = 'timer-alarm';

// Runs when alarm fires and the app is killed/backgrounded.
// Full-screen intent will reopen the app — audio starts there.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'dismiss') {
    await notifee.cancelNotification(detail.notification?.id ?? NOTIF_ID);
  }
});

export default function App() {
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [remaining, setRemaining] = useState(DEFAULT_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const endTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const soundRef = useRef(null);

  useEffect(() => {
    setupChannel();
    checkInitialNotification();

    // Foreground event handler (dismiss button tapped while app is open)
    const unsubFg = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'dismiss') {
        stopAlarm();
      }
    });

    // Reconcile timer when app returns to foreground
    const sub = AppState.addEventListener('change', (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        if (endTimeRef.current) {
          const left = Math.round((endTimeRef.current - Date.now()) / 1000);
          if (left <= 0) {
            finish();
          } else {
            setRemaining(left);
          }
        }
      }
      appStateRef.current = nextState;
    });

    return () => {
      sub.remove();
      unsubFg();
    };
  }, []);

  const setupChannel = async () => {
    await notifee.requestPermission();
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Timer Alarm',
      importance: AndroidImportance.HIGH,
      sound: 'alarm',
      vibration: true,
      vibrationPattern: [0, 250, 250, 250],
      bypassDnd: true,
    });
  };

  // If app was launched by tapping the alarm notification (from killed state)
  const checkInitialNotification = async () => {
    const initial = await notifee.getInitialNotification();
    if (initial) {
      finish();
    }
  };

  const start = async () => {
    const endTime = Date.now() + remaining * 1000;
    endTimeRef.current = endTime;
    setIsRunning(true);
    setIsFinished(false);

    await activateKeepAwakeAsync();

    // Schedule alarm using Android AlarmManager (fires even in Doze mode)
    await notifee.createTriggerNotification(
      {
        id: NOTIF_ID,
        title: 'Timer Finished!',
        body: 'Tap Dismiss to stop the alarm.',
        android: {
          channelId: CHANNEL_ID,
          category: AndroidCategory.ALARM,
          visibility: AndroidVisibility.PUBLIC,
          sound: 'alarm',
          // Wakes screen and shows alarm UI on lock screen
          fullScreenAction: { id: 'default' },
          actions: [{ title: 'Dismiss', pressAction: { id: 'dismiss' } }],
          ongoing: true,
          autoCancel: false,
          asForegroundService: false,
        },
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp: endTime,
        alarmManager: {
          allowWhileIdle: true,
          type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
        },
      }
    );

    intervalRef.current = setInterval(() => {
      const left = Math.round((endTimeRef.current - Date.now()) / 1000);
      if (left <= 0) {
        finish();
      } else {
        setRemaining(left);
      }
    }, 500);
  };

  const pause = async () => {
    setIsRunning(false);
    clearInterval(intervalRef.current);
    endTimeRef.current = null;
    deactivateKeepAwake();
    await notifee.cancelTriggerNotification(NOTIF_ID);
  };

  const reset = async () => {
    await pause();
    await stopAlarm();
    setRemaining(duration);
  };

  const finish = async () => {
    clearInterval(intervalRef.current);
    endTimeRef.current = null;
    setRemaining(0);
    setIsRunning(false);
    setIsFinished(true);
    deactivateKeepAwake();

    // Cancel the scheduled trigger — alarm already fired
    await notifee.cancelTriggerNotification(NOTIF_ID);

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Loop alarm sound in-app
    const { sound } = await Audio.Sound.createAsync(
      require('./assets/sounds/alarm.wav'),
      { isLooping: true }
    );
    soundRef.current = sound;
    await sound.playAsync();
  };

  const stopAlarm = async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    await notifee.cancelNotification(NOTIF_ID);
    setIsFinished(false);
    setRemaining(duration);
  };

  const adjustDuration = (deltaSeconds) => {
    if (isRunning) return;
    const next = Math.max(10, duration + deltaSeconds);
    setDuration(next);
    setRemaining(next);
    setIsFinished(false);
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <View style={styles.container}>
      {/* Alarm popup */}
      <Modal visible={isFinished} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Time's up!</Text>
            <TouchableOpacity style={styles.stopBtn} onPress={stopAlarm}>
              <Text style={styles.stopBtnText}>Stop Alarm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Text style={styles.timer}>{formatTime(remaining)}</Text>

      {!isRunning && (
        <View style={styles.adjustRow}>
          <TouchableOpacity style={styles.adjustBtn} onPress={() => adjustDuration(-60)}>
            <Text style={styles.adjustText}>-1m</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.adjustBtn} onPress={() => adjustDuration(60)}>
            <Text style={styles.adjustText}>+1m</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.adjustBtn} onPress={() => adjustDuration(-10)}>
            <Text style={styles.adjustText}>-10s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.adjustBtn} onPress={() => adjustDuration(10)}>
            <Text style={styles.adjustText}>+10s</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.controlRow}>
        {isRunning ? (
          <TouchableOpacity style={[styles.btn, styles.btnPause]} onPress={pause}>
            <Text style={styles.btnText}>Pause</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.btn, styles.btnStart, remaining === 0 && styles.btnDisabled]}
            onPress={start}
            disabled={remaining === 0}
          >
            <Text style={styles.btnText}>Start</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.btn, styles.btnReset]} onPress={reset}>
          <Text style={styles.btnText}>Reset</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  timer: {
    fontSize: 80,
    fontWeight: '200',
    color: '#fff',
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  adjustRow: {
    flexDirection: 'row',
    gap: 12,
  },
  adjustBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  adjustText: {
    color: '#ccc',
    fontSize: 15,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 16,
  },
  btn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 40,
    minWidth: 120,
    alignItems: 'center',
  },
  btnStart: {
    backgroundColor: '#4CAF50',
  },
  btnPause: {
    backgroundColor: '#FF9800',
  },
  btnReset: {
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#555',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBox: {
    backgroundColor: '#1e1e1e',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    gap: 24,
    width: '75%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '600',
  },
  stopBtn: {
    backgroundColor: '#ff6b6b',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 40,
  },
  stopBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
