import { useEffect } from 'react';
import { beginReadingActivity, observeReadingActivity } from '../../lib/tauri';
import type { ReadingActivityReceipt, ReadingActivityState } from '../../types/models';

const READING_ACTIVITY_HEARTBEAT_MS = 30_000;

interface UseReadingActivityOptions {
  bookId: string;
  isReady: boolean;
}

function utcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function isReaderForeground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function useReadingActivity({ bookId, isReady }: UseReadingActivityOptions) {
  useEffect(() => {
    if (!isReady) return;

    let disposed = false;
    let starting = false;
    let session: ReadingActivityReceipt | null = null;
    let requestedState: ReadingActivityState | null = null;
    let startTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let commandQueue: Promise<void> = Promise.resolve();

    const reportError = (stage: string, error: unknown) => {
      console.warn(`Reading activity ${stage} failed`, error);
    };

    const enqueueObservation = (
      activityState: ReadingActivityState,
      force = false,
    ) => {
      if (!session || session.state === 'ended') return;
      if (!force && requestedState === activityState) return;
      requestedState = activityState;

      commandQueue = commandQueue.then(async () => {
        const activeSession = session;
        if (!activeSession || activeSession.state === 'ended') return;
        try {
          session = await observeReadingActivity({
            sessionId: activeSession.session_id,
            sequence: activeSession.sequence + 1,
            activityState,
            utcOffsetMinutes: utcOffsetMinutes(),
          });
          requestedState = session.state;
        } catch (error) {
          requestedState = session?.state ?? null;
          reportError('observation', error);
        }
      });
    };

    const beginIfForeground = () => {
      if (disposed || starting || session || !isReaderForeground()) return;
      starting = true;
      beginReadingActivity({ bookId, utcOffsetMinutes: utcOffsetMinutes() })
        .then((receipt) => {
          session = receipt;
          requestedState = receipt.state;
          if (disposed) {
            enqueueObservation('ended');
          } else if (!isReaderForeground()) {
            enqueueObservation('paused');
          }
        })
        .catch((error: unknown) => reportError('start', error))
        .finally(() => {
          starting = false;
        });
    };

    const syncForegroundState = () => {
      if (isReaderForeground()) {
        if (session) enqueueObservation('visible');
        else beginIfForeground();
      } else if (session) {
        enqueueObservation('paused');
      }
    };

    const pauseForPageHide = () => enqueueObservation('paused');

    document.addEventListener('visibilitychange', syncForegroundState);
    window.addEventListener('focus', syncForegroundState);
    window.addEventListener('blur', syncForegroundState);
    window.addEventListener('pagehide', pauseForPageHide);

    // Deferring the first begin avoids a development-only zero-duration session
    // when React StrictMode immediately replays effect setup and cleanup.
    startTimer = window.setTimeout(() => {
      startTimer = null;
      syncForegroundState();
    }, 0);
    heartbeatTimer = window.setInterval(() => {
      if (!isReaderForeground()) return;
      if (session) enqueueObservation('visible', true);
      else beginIfForeground();
    }, READING_ACTIVITY_HEARTBEAT_MS);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', syncForegroundState);
      window.removeEventListener('focus', syncForegroundState);
      window.removeEventListener('blur', syncForegroundState);
      window.removeEventListener('pagehide', pauseForPageHide);
      if (startTimer !== null) window.clearTimeout(startTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (session) enqueueObservation('ended');
    };
  }, [bookId, isReady]);
}
