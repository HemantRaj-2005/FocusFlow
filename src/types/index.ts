export interface Schedule {
  id: string;
  title: string;
  description: string;
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format
  targetUrl: string;
  allowedDomains: string[];
  strictMode: boolean;
  warningThreshold: number; // 0 to 100
}

export interface FocusScoreEntry {
  date: string; // YYYY-MM-DD
  score: number;
}

export interface FocusAnalytics {
  focusHours: number;
  distractionAttempts: number;
  redirectCount: number;
  dailyStreak: number;
  weeklyStreak: number;
  lastFocusDate?: string; // YYYY-MM-DD
  focusScoreHistory: FocusScoreEntry[];
}

export interface BreakState {
  inBreak: boolean;
  breakEndTime: number; // Timestamp ms
}

export interface ActiveTaskState {
  active: boolean;
  task?: Schedule;
  remainingTime?: string; // HH:MM:SS format
}

export interface OffenseState {
  [tabId: number]: {
    offensesCount: number;
    lastOffenseUrl: string;
    lastOffenseTime: number;
  };
}

export interface OnboardingState {
  completed: boolean;
  goals: string;
  strictness: 'low' | 'medium' | 'strict';
}

export interface AppState {
  schedules: Schedule[];
  breakState: BreakState;
  analytics: FocusAnalytics;
  onboarding: OnboardingState;
  passwordHash?: string;
}
