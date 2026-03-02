import 'expo-dev-client';
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AppState,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const DEFAULT_DURATION = 5 * 60; // 5 minutes in seconds

export default function App() {
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [remaining, setRemaining] = useState(DEFAULT_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const endTimeRef = useRef(null);    // absolute timestamp when timer ends
  const intervalRef = useRef(null);
  const notifIdRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // Request notification permissions on mount
  useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Notification permission not granted');
      }
    })();

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

    return () => sub.remove();
  }, []);

  const start = async () => {
    const endTime = Date.now() + remaining * 1000;
    endTimeRef.current = endTime;
    setIsRunning(true);
    setIsFinished(false);

    await activateKeepAwakeAsync();

    // Schedule a local notification for when the timer ends
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Timer finished!',
        body: 'Your countdown is done.',
        sound: true,
      },
      trigger: { type: 'timeInterval', seconds: remaining, repeats: false },
    });
    notifIdRef.current = id;

    // Tick every 500ms to keep display smooth
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

    if (notifIdRef.current) {
      await Notifications.cancelScheduledNotificationAsync(notifIdRef.current);
      notifIdRef.current = null;
    }
  };

  const reset = async () => {
    await pause();
    setRemaining(duration);
    setIsFinished(false);
  };

  const finish = async () => {
    clearInterval(intervalRef.current);
    endTimeRef.current = null;
    setRemaining(0);
    setIsRunning(false);
    setIsFinished(true);
    deactivateKeepAwake();

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      {/* Timer display */}
      <Text style={[styles.timer, isFinished && styles.timerFinished]}>
        {formatTime(remaining)}
      </Text>

      {isFinished && <Text style={styles.doneText}>Time's up!</Text>}

      {/* Time adjustment buttons (only when not running) */}
      {!isRunning && !isFinished && (
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

      {/* Controls */}
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
            <Text style={styles.btnText}>{isFinished ? 'Restart' : 'Start'}</Text>
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
  timerFinished: {
    color: '#ff6b6b',
  },
  doneText: {
    color: '#ff6b6b',
    fontSize: 18,
    fontWeight: '500',
    marginTop: -16,
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
});
