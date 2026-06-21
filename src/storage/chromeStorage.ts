import { AppState, Schedule, BreakState, FocusAnalytics, OnboardingState, CPProfiles, CPGoal, StudyNote, CalendarEvent, CoachReport } from '../types';

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

const defaultCPProfiles: CPProfiles = {
  codeforcesHandle: '',
  leetcodeUsername: '',
  atcoderUsername: '',
  lastSyncTime: 0,
  codeforces: null,
  leetcode: null,
  atcoder: null,
};

const defaultCPGoal: CPGoal = {
  goalText: '',
  parsed: null,
};

// Helper to generate mock calendar events for the next 7 days
function generateDefaultCalendarEvents(): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const now = new Date();
  
  for (let i = 0; i < 7; i++) {
    const day = new Date();
    day.setDate(now.getDate() + i);
    
    // 1. Sleep (Daily 11 PM to 7 AM next day)
    const sleepStart = new Date(day);
    sleepStart.setHours(23, 0, 0, 0);
    const sleepEnd = new Date(day);
    sleepEnd.setDate(sleepEnd.getDate() + 1);
    sleepEnd.setHours(7, 0, 0, 0);
    events.push({
      id: `sleep-${i}`,
      title: 'Sleep & Rest',
      start: sleepStart.toISOString(),
      end: sleepEnd.toISOString(),
      isStudySession: false,
      category: 'sleep',
    });

    // 2. College / Work (Monday - Friday 10 AM to 2 PM)
    const dayOfWeek = day.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const classStart = new Date(day);
      classStart.setHours(10, 0, 0, 0);
      const classEnd = new Date(day);
      classEnd.setHours(14, 0, 0, 0);
      events.push({
        id: `college-${i}`,
        title: 'College Lectures',
        start: classStart.toISOString(),
        end: classEnd.toISOString(),
        isStudySession: false,
        category: 'class',
      });
    }

    // 3. Exercise (Daily 6 PM to 7 PM)
    const exStart = new Date(day);
    exStart.setHours(18, 0, 0, 0);
    const exEnd = new Date(day);
    exEnd.setHours(19, 0, 0, 0);
    events.push({
      id: `ex-${i}`,
      title: 'Workout & Jogging',
      start: exStart.toISOString(),
      end: exEnd.toISOString(),
      isStudySession: false,
      category: 'exercise',
    });
  }
  return events;
}

export const INITIAL_STATE: AppState = {
  schedules: [],
  breakState: defaultBreakState,
  analytics: defaultAnalytics,
  onboarding: defaultOnboarding,
  cpProfiles: defaultCPProfiles,
  cpGoals: defaultCPGoal,
  studyNotes: [],
  calendarEvents: generateDefaultCalendarEvents(),
  coachReport: null,
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
  const cpProfiles = await getStorageItem<CPProfiles>('cpProfiles', INITIAL_STATE.cpProfiles);
  const cpGoals = await getStorageItem<CPGoal>('cpGoals', INITIAL_STATE.cpGoals);
  const studyNotes = await getStorageItem<StudyNote[]>('studyNotes', INITIAL_STATE.studyNotes);
  const calendarEvents = await getStorageItem<CalendarEvent[]>('calendarEvents', INITIAL_STATE.calendarEvents);
  const coachReport = await getStorageItem<CoachReport | null>('coachReport', INITIAL_STATE.coachReport);

  return {
    schedules,
    breakState,
    analytics,
    onboarding,
    passwordHash,
    cpProfiles,
    cpGoals,
    studyNotes,
    calendarEvents,
    coachReport,
  };
}

export async function saveAppState(state: Partial<AppState>): Promise<void> {
  if (state.schedules !== undefined) await setStorageItem('schedules', state.schedules);
  if (state.breakState !== undefined) await setStorageItem('breakState', state.breakState);
  if (state.analytics !== undefined) await setStorageItem('analytics', state.analytics);
  if (state.onboarding !== undefined) await setStorageItem('onboarding', state.onboarding);
  if (state.passwordHash !== undefined) await setStorageItem('passwordHash', state.passwordHash);
  if (state.cpProfiles !== undefined) await setStorageItem('cpProfiles', state.cpProfiles);
  if (state.cpGoals !== undefined) await setStorageItem('cpGoals', state.cpGoals);
  if (state.studyNotes !== undefined) await setStorageItem('studyNotes', state.studyNotes);
  if (state.calendarEvents !== undefined) await setStorageItem('calendarEvents', state.calendarEvents);
  if (state.coachReport !== undefined) await setStorageItem('coachReport', state.coachReport);
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
