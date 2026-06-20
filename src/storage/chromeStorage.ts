import { AppState, Schedule, BreakState, FocusAnalytics, OnboardingState } from '../types';

const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

// Default initial states
const defaultAnalytics: FocusAnalytics = {
  focusHours: 0,
  distractionAttempts: 0,
  redirectCount: 0,
  dailyStreak: 0,
  weeklyStreak: 0,
  focusScoreHistory: [],
};

const defaultBreakState: BreakState = {
  inBreak: false,
  breakEndTime: 0,
};

const defaultOnboarding: OnboardingState = {
  completed: false,
  goals: '',
  strictness: 'medium',
};

export const INITIAL_STATE: AppState = {
  schedules: [],
  breakState: defaultBreakState,
  analytics: defaultAnalytics,
  onboarding: defaultOnboarding,
};

export async function getStorageItem<T>(key: string, defaultValue: T): Promise<T> {
  if (isChromeExtension) {
    return new Promise<T>((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] !== undefined ? (result[key] as T) : defaultValue);
      });
    });
  } else {
    const val = localStorage.getItem(key);
    if (val === null) return defaultValue;
    try {
      return JSON.parse(val) as T;
    } catch {
      return defaultValue;
    }
  }
}

export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (isChromeExtension) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    });
  } else {
    localStorage.setItem(key, JSON.stringify(value));
    // Dispatch custom event for same-window context notifications
    window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { key, value } }));
  }
}

export async function getAppState(): Promise<AppState> {
  const schedules = await getStorageItem<Schedule[]>('schedules', INITIAL_STATE.schedules);
  const breakState = await getStorageItem<BreakState>('breakState', INITIAL_STATE.breakState);
  const analytics = await getStorageItem<FocusAnalytics>('analytics', INITIAL_STATE.analytics);
  const onboarding = await getStorageItem<OnboardingState>('onboarding', INITIAL_STATE.onboarding);
  const passwordHash = await getStorageItem<string | undefined>('passwordHash', undefined);

  return {
    schedules,
    breakState,
    analytics,
    onboarding,
    passwordHash,
  };
}

export async function saveAppState(state: Partial<AppState>): Promise<void> {
  if (state.schedules !== undefined) await setStorageItem('schedules', state.schedules);
  if (state.breakState !== undefined) await setStorageItem('breakState', state.breakState);
  if (state.analytics !== undefined) await setStorageItem('analytics', state.analytics);
  if (state.onboarding !== undefined) await setStorageItem('onboarding', state.onboarding);
  if (state.passwordHash !== undefined) await setStorageItem('passwordHash', state.passwordHash);
}

export function subscribeToKey<T>(key: string, callback: (newValue: T) => void): () => void {
  if (isChromeExtension) {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes[key]) {
        callback(changes[key].newValue as T);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  } else {
    const storageListener = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          callback(JSON.parse(e.newValue) as T);
        } catch {}
      }
    };
    const localListener = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: any }>;
      if (customEvent.detail.key === key) {
        callback(customEvent.detail.value as T);
      }
    };
    window.addEventListener('storage', storageListener);
    window.addEventListener('local-storage-update', localListener);
    return () => {
      window.removeEventListener('storage', storageListener);
      window.removeEventListener('local-storage-update', localListener);
    };
  }
}
