import 'expo-dev-client';
import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, AppState, Modal, KeyboardAvoidingView } from 'react-native';
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
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const DEFAULT_DURATION = 65 * 60; // 1:05:00
const CHANNEL_ID = 'timer-alarm-v2';
const NOTIF_ID_FINAL = 'timer-alarm';
const NOTIF_ID_WARN_40 = 'timer-warn-40';
const NOTIF_ID_WARN_20 = 'timer-warn-20';
const WARN_40 = 40 * 60; // seconds
const WARN_20 = 20 * 60;

// Runs when alarm fires and the app is killed/backgrounded.
// Full-screen intent will reopen the app — audio starts there.
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'dismiss') {
    await notifee.cancelNotification(detail.notification?.id ?? NOTIF_ID_FINAL);
  }
});

export default function App() {
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [remaining, setRemaining] = useState(DEFAULT_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputH, setInputH] = useState('1');
  const [inputM, setInputM] = useState('05');
  const [inputS, setInputS] = useState('00');

  const endTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const soundRef = useRef(null);
  const isFinishedRef = useRef(false); // guard against double-firing

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
      vibrationPattern: [300, 300],
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

    const alarmTrigger = (id, timestamp, label) => notifee.createTriggerNotification(
      {
        id,
        title: label,
        body: '',
        android: {
          channelId: CHANNEL_ID,
          category: AndroidCategory.ALARM,
          visibility: AndroidVisibility.PUBLIC,
          sound: 'alarm',
          fullScreenAction: { id: 'default' },
          autoCancel: true,
        },
      },
      { type: TriggerType.TIMESTAMP, timestamp, alarmManager: { allowWhileIdle: true, type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE } }
    );

    // 40-min warning
    if (remaining > WARN_40) {
      await alarmTrigger(NOTIF_ID_WARN_40, endTime - WARN_40 * 1000, '40 minutes remaining');
    }

    // 20-min warning
    if (remaining > WARN_20) {
      await alarmTrigger(NOTIF_ID_WARN_20, endTime - WARN_20 * 1000, '20 minutes remaining');
    }

    // Final alarm — wakes screen, loops until dismissed
    await notifee.createTriggerNotification(
      {
        id: NOTIF_ID_FINAL,
        title: 'Timer Finished!',
        body: 'Tap Dismiss to stop the alarm.',
        android: {
          channelId: CHANNEL_ID,
          category: AndroidCategory.ALARM,
          visibility: AndroidVisibility.PUBLIC,
          sound: 'alarm',
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
        clearInterval(intervalRef.current);
        // Only call finish() if app is in foreground — otherwise let
        // the AlarmManager / full-screen intent bring the app forward,
        // which triggers AppState 'active' → finish() there.
        if (appStateRef.current === 'active') {
          finish();
        }
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
    await notifee.cancelTriggerNotification(NOTIF_ID_FINAL);
    await notifee.cancelTriggerNotification(NOTIF_ID_WARN_40);
    await notifee.cancelTriggerNotification(NOTIF_ID_WARN_20);
  };

  const reset = async () => {
    await pause();
    await stopAlarm();
    setRemaining(duration);
  };

  const finish = async () => {
    if (isFinishedRef.current) return; // guard against double-firing
    isFinishedRef.current = true;

    clearInterval(intervalRef.current);
    endTimeRef.current = null;
    setRemaining(0);
    setIsRunning(false);
    setIsFinished(true);
    deactivateKeepAwake();

    // Cancel all scheduled triggers — alarm already fired or we're in foreground
    await notifee.cancelTriggerNotification(NOTIF_ID_FINAL);
    await notifee.cancelTriggerNotification(NOTIF_ID_WARN_40);
    await notifee.cancelTriggerNotification(NOTIF_ID_WARN_20);

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Small delay to let the app fully foreground before acquiring audio focus
    await new Promise(resolve => setTimeout(resolve, 300));

    // Loop alarm sound in-app
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer(require('./assets/sounds/alarm.wav'));
    player.loop = true;
    player.play();
    soundRef.current = player;
  };

  const stopAlarm = async () => {
    isFinishedRef.current = false; // reset guard for next alarm
    if (soundRef.current) {
      soundRef.current.pause();
      soundRef.current.remove();
      soundRef.current = null;
    }
    await notifee.cancelNotification(NOTIF_ID_FINAL);
    await notifee.cancelNotification(NOTIF_ID_WARN_40);
    await notifee.cancelNotification(NOTIF_ID_WARN_20);
    setIsFinished(false);
    setRemaining(duration);
  };

  const openEdit = () => {
    const h = Math.floor(duration / 3600);
    const m = Math.floor((duration % 3600) / 60);
    const s = duration % 60;
    setInputH(h.toString());
    setInputM(m.toString().padStart(2, '0'));
    setInputS(s.toString().padStart(2, '0'));
    setIsEditing(true);
  };

  const confirmEdit = () => {
    const h = Math.min(99, Math.max(0, parseInt(inputH) || 0));
    const m = Math.min(59, Math.max(0, parseInt(inputM) || 0));
    const s = Math.min(59, Math.max(0, parseInt(inputS) || 0));
    const total = Math.max(10, h * 3600 + m * 60 + s);
    setDuration(total);
    setRemaining(total);
    setIsEditing(false);
  };

  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
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

      {/* Time edit modal */}
      <Modal visible={isEditing} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior="padding">
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Set Time</Text>
            <View style={styles.inputRow}>
              <View style={styles.inputGroup}>
                <TextInput
                  style={styles.timeInput}
                  value={inputH}
                  onChangeText={setInputH}
                  keyboardType="number-pad"
                  maxLength={2}
                  selectTextOnFocus
                />
                <Text style={styles.inputLabel}>h</Text>
              </View>
              <Text style={styles.inputSep}>:</Text>
              <View style={styles.inputGroup}>
                <TextInput
                  style={styles.timeInput}
                  value={inputM}
                  onChangeText={setInputM}
                  keyboardType="number-pad"
                  maxLength={2}
                  selectTextOnFocus
                />
                <Text style={styles.inputLabel}>m</Text>
              </View>
              <Text style={styles.inputSep}>:</Text>
              <View style={styles.inputGroup}>
                <TextInput
                  style={styles.timeInput}
                  value={inputS}
                  onChangeText={setInputS}
                  keyboardType="number-pad"
                  maxLength={2}
                  selectTextOnFocus
                />
                <Text style={styles.inputLabel}>s</Text>
              </View>
            </View>
            <View style={styles.controlRow}>
              <TouchableOpacity style={[styles.btn, styles.btnReset]} onPress={() => setIsEditing(false)}>
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnStart]} onPress={confirmEdit}>
                <Text style={styles.btnText}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Timer display — tap to edit when not running */}
      <TouchableOpacity onPress={!isRunning ? openEdit : undefined} activeOpacity={isRunning ? 1 : 0.6}>
        <Text style={styles.timer}>{formatTime(remaining)}</Text>
        {!isRunning && <Text style={styles.tapHint}>tap to edit</Text>}
      </TouchableOpacity>

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
    fontSize: 72,
    fontWeight: '200',
    color: '#fff',
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  tapHint: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputGroup: {
    alignItems: 'center',
    gap: 4,
  },
  timeInput: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    fontSize: 36,
    fontWeight: '300',
    width: 70,
    textAlign: 'center',
    borderRadius: 10,
    paddingVertical: 10,
  },
  inputLabel: {
    color: '#666',
    fontSize: 13,
  },
  inputSep: {
    color: '#555',
    fontSize: 32,
    fontWeight: '200',
    marginBottom: 18,
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
