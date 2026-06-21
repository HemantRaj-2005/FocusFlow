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
  cpProfiles: CPProfiles;
  cpGoals: CPGoal;
  studyNotes: StudyNote[];
  calendarEvents: CalendarEvent[];
  coachReport: CoachReport | null;
}

export interface CPProfiles {
  codeforcesHandle: string;
  leetcodeUsername: string;
  atcoderUsername: string;
  lastSyncTime: number; // timestamp
  codeforces: {
    rating: number;
    maxRating: number;
    rank: string;
    maxRank: string;
    problemsSolved: number;
    problemsSolvedYear?: number;
    problemsSolvedMonth?: number;
    maxStreak?: number;
    contestHistory: any[];
    recentSubmissions: any[];
    strengthAnalysis: {
      strong: string[];
      weak: string[];
      needsImprovement: string[];
    };
  } | null;
  leetcode: {
    problemsSolved: {
      easy: number;
      medium: number;
      hard: number;
      total: number;
    };
    contestRating: number;
    submissionStats: {
      totalSubmissions: number;
      acceptedSubmissions: number;
    };
    dailyStreak: number;
    topicWiseAnalysis: {
      topic: string;
      percentage: number;
    }[];
    strengths: string[];
    weaknesses: string[];
  } | null;
  atcoder: {
    rating: number;
    contestPerformance: any[];
    submissionHistory: any[];
    skillDistribution: {
      category: string;
      score: number;
    }[];
    beginnerAreas: string[];
    advancedAreas: string[];
    growthOpportunities: string[];
    rank?: string;
    contestCount?: number;
  } | null;
}

export interface CPGoal {
  goalText: string;
  parsed: {
    targetRating: number;
    deadline: string; // YYYY-MM-DD
    weeklyHours: number;
    priorityTopics: string[];
  } | null;
}

export interface StudyNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category: 'notes' | 'learnings' | 'mistakes' | 'templates' | 'algorithms';
  createdAt: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string;   // ISO string
  isStudySession: boolean;
  category?: 'study' | 'class' | 'work' | 'sleep' | 'contest' | 'break' | 'exercise';
}

export interface CoachReport {
  currentLevel: string;
  strongTopics: string[];
  weakTopics: string[];
  ratingPotential: string;
  roadmap: {
    id: string;
    month: string;
    topics: string[];
    description: string;
    completed: boolean;
  }[];
  recommendations: {
    id: string;
    platform: 'codeforces' | 'leetcode' | 'atcoder';
    problemId: string;
    name: string;
    difficulty: string;
    url: string;
    tags: string[];
    solved: boolean;
  }[];
  dailyPractice: {
    date: string;
    warmup: { id: string; name: string; url: string; solved: boolean }[];
    core: { id: string; name: string; url: string; solved: boolean }[];
    challenge: { id: string; name: string; url: string; solved: boolean };
    revision: { id: string; name: string; url: string; solved: boolean };
  } | null;
  predictedGrowth: {
    days: number;
    rating: number;
  }[];
  predictedConfidence: number;
}
