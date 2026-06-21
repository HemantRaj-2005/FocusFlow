import React, { useState, useEffect } from 'react';
import { Schedule, FocusAnalytics, BreakState, OnboardingState, CPProfiles, CPGoal, StudyNote, CalendarEvent, CoachReport } from '../types';
import { getAppState, saveAppState, subscribeToKey, getStorageItem } from '../storage/chromeStorage';
import { getCurrentTask, getRemainingSeconds, formatRemainingTime, formatTimeSlot, isTaskActiveNow } from '../utils/time';
import {
  Zap, Calendar, BarChart2, Shield, Settings2, Plus,
  Trash2, Edit3, ArrowUp, ArrowDown, X, Lock,
  Unlock, Flame, BookOpen, Coffee, ExternalLink,
  Globe, RefreshCw, FileText, Brain, Compass, Search,
  Activity, Check, CheckSquare, Square, AlertCircle, CalendarRange
} from 'lucide-react';
import {
  syncCodeforces, syncLeetCode, syncAtCoder,
  parseNaturalLanguageGoal, generateCPCoachReport,
  generateSmartStudyCalendar, convertCalendarEventsToSchedules
} from '../services/cpCoach';

interface UpcomingContest {
  name: string;
  startTime: number; // Unix ms
  url: string;
  platform: 'Codeforces' | 'LeetCode' | 'AtCoder';
  durationSeconds: number;
}

async function fetchUpcomingContests(): Promise<UpcomingContest[]> {
  const results: UpcomingContest[] = [];

  const tryFetch = async (url: string, platform: UpcomingContest['platform']) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return;
      const data: any[] = await res.json();
      for (const c of data) {
        const startMs = new Date(c.start_time).getTime();
        // Only include future contests
        if (startMs > Date.now()) {
          results.push({
            name: c.name,
            startTime: startMs,
            url: c.url || '#',
            platform,
            durationSeconds: parseInt(c.duration) || 7200,
          });
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch ${platform} contests:`, e);
    }
  };

  await Promise.all([
    tryFetch('https://kontests.net/api/v1/codeforces', 'Codeforces'),
    tryFetch('https://kontests.net/api/v1/leet_code', 'LeetCode'),
    tryFetch('https://kontests.net/api/v1/at_coder', 'AtCoder'),
  ]);

  // Sort by start time ascending, return next 6
  return results
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, 6);
}

// Web Crypto SHA-256 hashing utility
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function Dashboard() {
  // App state
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [breakState, setBreakState] = useState<BreakState>({ inBreak: false, breakEndTime: 0 });
  const [analytics, setAnalytics] = useState<FocusAnalytics>({
    focusHours: 0,
    distractionAttempts: 0,
    redirectCount: 0,
    dailyStreak: 0,
    weeklyStreak: 0,
    focusScoreHistory: [],
  });
  const [onboarding, setOnboarding] = useState<OnboardingState>({
    completed: false,
    goals: '',
    strictness: 'medium',
  });
  const [passwordHash, setPasswordHash] = useState<string | undefined>(undefined);
  const [analyzerMode, setAnalyzerMode] = useState<'rule' | 'ai'>('rule');
  const [customApiKey, setCustomApiKey] = useState<string>('');

  // Extended state keys for V2 Dashboard
  const [cpProfiles, setCpProfiles] = useState<CPProfiles>({
    codeforcesHandle: '',
    leetcodeUsername: '',
    atcoderUsername: '',
    lastSyncTime: 0,
    codeforces: null,
    leetcode: null,
    atcoder: null,
  });
  const [cpGoals, setCpGoals] = useState<CPGoal>({
    goalText: '',
    parsed: null,
  });
  const [studyNotes, setStudyNotes] = useState<StudyNote[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [coachReport, setCoachReport] = useState<CoachReport | null>(null);

  // Active UI tab: overview | cp_coach | recommendations | roadmap | planner | calendar | knowledge | settings
  const [activeTab, setActiveTab] = useState<'overview' | 'cp_coach' | 'recommendations' | 'roadmap' | 'planner' | 'calendar' | 'knowledge' | 'settings'>('overview');

  // Timers
  const [activeTask, setActiveTask] = useState<Schedule | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [breakSecondsLeft, setBreakSecondsLeft] = useState<number>(0);

  // Modals & Form state
  const [showScheduleModal, setShowScheduleModal] = useState<boolean>(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    title: '',
    description: '',
    startTime: '09:00',
    endTime: '10:00',
    targetUrl: 'https://',
    allowedDomains: '',
    strictMode: false,
    warningThreshold: 50,
  });

  // Password Verification Modal
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [pendingAction, setPendingAction] = useState<{ type: 'edit' | 'delete' | 'disable-strict'; scheduleId?: string } | null>(null);

  // Wizard state
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [wizardForm, setWizardForm] = useState({
    goals: '',
    scheduleTitle: 'LeetCode Practice',
    scheduleTarget: 'https://leetcode.com',
    scheduleAllowed: 'leetcode.com, youtube.com, github.com',
    scheduleStart: '08:00',
    scheduleEnd: '10:00',
    strictness: 'medium' as 'low' | 'medium' | 'strict',
    password: '',
  });

  // Profile Connection Forms
  const [cfInput, setCfInput] = useState('');
  const [lcInput, setLcInput] = useState('');
  const [acInput, setAcInput] = useState('');
  const [syncing, setSyncing] = useState(false);

  // Live Contest Tracker
  const [upcomingContests, setUpcomingContests] = useState<UpcomingContest[]>([]);
  const [contestsLoading, setContestsLoading] = useState(false);
  const [contestsFetched, setContestsFetched] = useState(false);

  const refreshContests = async () => {
    setContestsLoading(true);
    try {
      const contests = await fetchUpcomingContests();
      setUpcomingContests(contests);
    } catch (e) {
      console.warn('Contest fetch failed:', e);
    } finally {
      setContestsLoading(false);
      setContestsFetched(true);
    }
  };

  // Manual Override states
  const [editManualMode, setEditManualMode] = useState(false);
  const [cfManualRating, setCfManualRating] = useState('0');
  const [cfManualMaxRating, setCfManualMaxRating] = useState('0');
  const [cfManualRank, setCfManualRank] = useState('Newbie');
  const [cfManualSolved, setCfManualSolved] = useState('0');
  const [cfManualSolvedYear, setCfManualSolvedYear] = useState('0');
  const [cfManualSolvedMonth, setCfManualSolvedMonth] = useState('0');
  const [cfManualStreak, setCfManualStreak] = useState('0');

  const [lcManualEasy, setLcManualEasy] = useState('0');
  const [lcManualMed, setLcManualMed] = useState('0');
  const [lcManualHard, setLcManualHard] = useState('0');
  const [lcManualStreak, setLcManualStreak] = useState('0');

  const [acManualRating, setAcManualRating] = useState('0');
  const [acManualRank, setAcManualRank] = useState('Unrated');
  const [acManualMatches, setAcManualMatches] = useState('0');

  // Sync manual form states whenever profile updates
  useEffect(() => {
    if (cpProfiles) {
      setCfManualRating((cpProfiles.codeforces?.rating ?? 0).toString());
      setCfManualMaxRating((cpProfiles.codeforces?.maxRating ?? 0).toString());
      setCfManualRank(cpProfiles.codeforces?.rank ?? 'Newbie');
      setCfManualSolved((cpProfiles.codeforces?.problemsSolved ?? 0).toString());
      setCfManualSolvedYear((cpProfiles.codeforces?.problemsSolvedYear ?? 0).toString());
      setCfManualSolvedMonth((cpProfiles.codeforces?.problemsSolvedMonth ?? 0).toString());
      setCfManualStreak((cpProfiles.codeforces?.maxStreak ?? 0).toString());

      setLcManualEasy((cpProfiles.leetcode?.problemsSolved.easy ?? 0).toString());
      setLcManualMed((cpProfiles.leetcode?.problemsSolved.medium ?? 0).toString());
      setLcManualHard((cpProfiles.leetcode?.problemsSolved.hard ?? 0).toString());
      setLcManualStreak((cpProfiles.leetcode?.dailyStreak ?? 0).toString());

      setAcManualRating((cpProfiles.atcoder?.rating ?? 0).toString());
      setAcManualRank(cpProfiles.atcoder?.rank ?? 'Unrated');
      setAcManualMatches((cpProfiles.atcoder?.contestCount ?? 0).toString());
    }
  }, [cpProfiles]);

  // Goal Parser State
  const [goalInput, setGoalInput] = useState('');
  const [parsingGoal, setParsingGoal] = useState(false);

  // Knowledge Base State
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState<StudyNote['category']>('notes');
  const [noteTags, setNoteTags] = useState('');
  const [noteSearch, setNoteSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Calendar Planner State
  const [availability, setAvailability] = useState({
    sleepStart: '23:00',
    sleepEnd: '07:00',
    workStart: '10:00',
    workEnd: '14:00',
  });
  const [generatingCalendar, setGeneratingCalendar] = useState(false);

  // Fetch live contests on mount
  useEffect(() => {
    refreshContests();
  }, []);

  // Load and subscribe to state
  useEffect(() => {
    async function loadState() {
      const state = await getAppState();
      setSchedules(state.schedules);
      setBreakState(state.breakState);
      setAnalytics(state.analytics);
      setOnboarding(state.onboarding);
      setPasswordHash(state.passwordHash);
      setCpProfiles(state.cpProfiles);
      setCpGoals(state.cpGoals);
      setStudyNotes(state.studyNotes);
      setCalendarEvents(state.calendarEvents);
      setCoachReport(state.coachReport);

      const mode = await getStorageItem<'rule' | 'ai'>('analyzerMode', 'rule');
      const customKey = await getStorageItem<string>('geminiApiKey', '');
      setAnalyzerMode(mode);
      setCustomApiKey(customKey);

      setCfInput(state.cpProfiles.codeforcesHandle);
      setLcInput(state.cpProfiles.leetcodeUsername);
      setAcInput(state.cpProfiles.atcoderUsername);
      setGoalInput(state.cpGoals.goalText);

      const currentTask = getCurrentTask(state.schedules);
      setActiveTask(currentTask);
      if (currentTask) {
        setSecondsLeft(getRemainingSeconds(currentTask.endTime));
      }
    }

    loadState();
  }, []);

  // Sync timers & updates
  useEffect(() => {
    const unsubSchedules = subscribeToKey<Schedule[]>('schedules', (newSchedules) => {
      setSchedules(newSchedules);
      const currentTask = getCurrentTask(newSchedules);
      setActiveTask(currentTask);
      if (currentTask) {
        setSecondsLeft(getRemainingSeconds(currentTask.endTime));
      } else {
        setSecondsLeft(0);
      }
    });

    const unsubBreak = subscribeToKey<BreakState>('breakState', (newBreak) => {
      setBreakState(newBreak);
    });

    const unsubAnalytics = subscribeToKey<FocusAnalytics>('analytics', (newAnalytics) => {
      setAnalytics(newAnalytics);
    });

    const unsubOnboarding = subscribeToKey<OnboardingState>('onboarding', (newOnboarding) => {
      setOnboarding(newOnboarding);
    });

    const unsubMode = subscribeToKey<'rule' | 'ai'>('analyzerMode', (newMode) => {
      setAnalyzerMode(newMode);
    });

    const unsubKey = subscribeToKey<string>('geminiApiKey', (newKey) => {
      setCustomApiKey(newKey);
    });

    const unsubProfiles = subscribeToKey<CPProfiles>('cpProfiles', (newProfiles) => {
      setCpProfiles(newProfiles);
    });

    const unsubGoals = subscribeToKey<CPGoal>('cpGoals', (newGoals) => {
      setCpGoals(newGoals);
    });

    const unsubNotes = subscribeToKey<StudyNote[]>('studyNotes', (newNotes) => {
      setStudyNotes(newNotes);
    });

    const unsubCalendar = subscribeToKey<CalendarEvent[]>('calendarEvents', (newCal) => {
      setCalendarEvents(newCal);
    });

    const unsubReport = subscribeToKey<CoachReport | null>('coachReport', (newRep) => {
      setCoachReport(newRep);
    });

    return () => {
      unsubSchedules();
      unsubBreak();
      unsubAnalytics();
      unsubOnboarding();
      unsubMode();
      unsubKey();
      unsubProfiles();
      unsubGoals();
      unsubNotes();
      unsubCalendar();
      unsubReport();
    };
  }, []);

  // Countdown timer for active task
  useEffect(() => {
    if (!activeTask || secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setActiveTask(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTask, secondsLeft]);

  // Countdown timer for break state
  useEffect(() => {
    if (!breakState.inBreak || breakState.breakEndTime <= Date.now()) {
      setBreakSecondsLeft(0);
      return;
    }

    const updateBreakTimer = () => {
      const leftMs = breakState.breakEndTime - Date.now();
      if (leftMs <= 0) {
        setBreakSecondsLeft(0);
        setBreakState({ inBreak: false, breakEndTime: 0 });
      } else {
        setBreakSecondsLeft(Math.floor(leftMs / 1000));
      }
    };

    updateBreakTimer();
    const interval = setInterval(updateBreakTimer, 1000);
    return () => clearInterval(interval);
  }, [breakState]);

  const isStrictActive = activeTask?.strictMode;

  // Move a schedule slot up or down (Reordering)
  const reorderSchedule = async (index: number, direction: 'up' | 'down') => {
    const isStrictRunning = schedules.some((s) => s.strictMode && getCurrentTask([s]));
    if (isStrictRunning && passwordHash) {
      setPendingAction({ type: 'disable-strict' });
      setShowPasswordModal(true);
      return;
    }

    const newSchedules = [...schedules];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newSchedules.length) return;

    const temp = newSchedules[index];
    newSchedules[index] = newSchedules[targetIdx];
    newSchedules[targetIdx] = temp;

    setSchedules(newSchedules);
    await saveAppState({ schedules: newSchedules });
  };

  const endQuickBreak = () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_BREAK' });
  };

  const openEditModal = (schedule: Schedule) => {
    if (schedule.strictMode && passwordHash) {
      setPendingAction({ type: 'edit', scheduleId: schedule.id });
      setShowPasswordModal(true);
    } else {
      editScheduleFormInit(schedule);
    }
  };

  const editScheduleFormInit = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setScheduleForm({
      title: schedule.title,
      description: schedule.description,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      targetUrl: schedule.targetUrl,
      allowedDomains: schedule.allowedDomains.join(', '),
      strictMode: schedule.strictMode,
      warningThreshold: schedule.warningThreshold,
    });
    setShowScheduleModal(true);
  };

  const handleDeleteCheck = (schedule: Schedule) => {
    if ((schedule.strictMode || isStrictActive) && passwordHash) {
      setPendingAction({ type: 'delete', scheduleId: schedule.id });
      setShowPasswordModal(true);
    } else {
      deleteSchedule(schedule.id);
    }
  };

  const deleteSchedule = async (id: string) => {
    const updated = schedules.filter((s) => s.id !== id);
    setSchedules(updated);
    await saveAppState({ schedules: updated });
  };

  const verifyPassword = async () => {
    if (!passwordHash) return;
    const inputHash = await hashPassword(passwordInput);

    if (inputHash === passwordHash) {
      const action = pendingAction;
      setPasswordInput('');
      setPasswordError('');
      setShowPasswordModal(false);
      setPendingAction(null);

      if (action) {
        if (action.type === 'delete' && action.scheduleId) {
          deleteSchedule(action.scheduleId);
        } else if (action.type === 'edit' && action.scheduleId) {
          const schedule = schedules.find((s) => s.id === action.scheduleId);
          if (schedule) editScheduleFormInit(schedule);
        }
      }
    } else {
      setPasswordError('Invalid lock password. Please try again.');
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const domains = scheduleForm.allowedDomains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    const formattedTarget = scheduleForm.targetUrl.trim();

    if (editingSchedule) {
      const updated = schedules.map((s) => {
        if (s.id === editingSchedule.id) {
          return {
            ...s,
            title: scheduleForm.title,
            description: scheduleForm.description,
            startTime: scheduleForm.startTime,
            endTime: scheduleForm.endTime,
            targetUrl: formattedTarget,
            allowedDomains: domains,
            strictMode: scheduleForm.strictMode,
            warningThreshold: scheduleForm.warningThreshold,
          };
        }
        return s;
      });
      setSchedules(updated);
      await saveAppState({ schedules: updated });
    } else {
      const newSchedule: Schedule = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        title: scheduleForm.title,
        description: scheduleForm.description,
        startTime: scheduleForm.startTime,
        endTime: scheduleForm.endTime,
        targetUrl: formattedTarget,
        allowedDomains: domains,
        strictMode: scheduleForm.strictMode,
        warningThreshold: scheduleForm.warningThreshold,
      };
      const updated = [...schedules, newSchedule];
      setSchedules(updated);
      await saveAppState({ schedules: updated });
    }

    setShowScheduleModal(false);
    setEditingSchedule(null);
  };

  const handleWizardSubmit = async () => {
    let finalHash: string | undefined = undefined;
    if (wizardForm.password.trim().length > 0) {
      finalHash = await hashPassword(wizardForm.password.trim());
    }

    const firstSchedule: Schedule = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      title: wizardForm.scheduleTitle,
      description: 'First scheduled task configured during onboarding.',
      startTime: wizardForm.scheduleStart,
      endTime: wizardForm.scheduleEnd,
      targetUrl: wizardForm.scheduleTarget,
      allowedDomains: wizardForm.scheduleAllowed
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0),
      strictMode: wizardForm.strictness === 'strict',
      warningThreshold: wizardForm.strictness === 'strict' ? 65 : 50,
    };

    const nextOnboarding: OnboardingState = {
      completed: true,
      goals: wizardForm.goals,
      strictness: wizardForm.strictness,
    };

    setOnboarding(nextOnboarding);
    setSchedules([firstSchedule]);
    if (finalHash) setPasswordHash(finalHash);

    await saveAppState({
      schedules: [firstSchedule],
      onboarding: nextOnboarding,
      passwordHash: finalHash,
    });
  };

  // Profile Sync
  const handleProfileSync = async () => {
    setSyncing(true);
    try {
      const cfData = cfInput.trim() ? await syncCodeforces(cfInput.trim()) : null;
      const lcData = lcInput.trim() ? await syncLeetCode(lcInput.trim()) : null;
      const acData = acInput.trim() ? await syncAtCoder(acInput.trim()) : null;

      const updatedProfiles: CPProfiles = {
        codeforcesHandle: cfInput.trim(),
        leetcodeUsername: lcInput.trim(),
        atcoderUsername: acInput.trim(),
        lastSyncTime: Date.now(),
        codeforces: cfData,
        leetcode: lcData,
        atcoder: acData,
      };

      setCpProfiles(updatedProfiles);
      await saveAppState({ cpProfiles: updatedProfiles });

      // Regenerate Coach Report automatically if goal exists
      const report = await generateCPCoachReport(updatedProfiles, cpGoals, studyNotes);
      setCoachReport(report);
      await saveAppState({ coachReport: report });

      alert('Profiles synced and coach analysis complete!');
    } catch (e) {
      console.error(e);
      alert('Error syncing profiles. Check connection.');
    } finally {
      setSyncing(false);
    }
  };

  // Manual Stats Override Save
  const handleSaveManualStats = async () => {
    const cfSolved = parseInt(cfManualSolved) || 0;
    const cfSolvedYear = parseInt(cfManualSolvedYear) || 0;
    const cfSolvedMonth = parseInt(cfManualSolvedMonth) || 0;
    const cfStreak = parseInt(cfManualStreak) || 0;
    const cfRating = parseInt(cfManualRating) || 0;
    const cfMaxRating = parseInt(cfManualMaxRating) || 0;

    const lcEasy = parseInt(lcManualEasy) || 0;
    const lcMed = parseInt(lcManualMed) || 0;
    const lcHard = parseInt(lcManualHard) || 0;
    const lcStreak = parseInt(lcManualStreak) || 0;
    const lcTotal = lcEasy + lcMed + lcHard;

    const acRating = parseInt(acManualRating) || 0;
    const acMatches = parseInt(acManualMatches) || 0;

    const updatedProfiles: CPProfiles = {
      ...cpProfiles,
      codeforcesHandle: cfInput.trim() || cpProfiles.codeforcesHandle,
      leetcodeUsername: lcInput.trim() || cpProfiles.leetcodeUsername,
      atcoderUsername: acInput.trim() || cpProfiles.atcoderUsername,
      lastSyncTime: Date.now(),
      codeforces: {
        rating: cfRating,
        maxRating: cfMaxRating,
        rank: cfManualRank,
        maxRank: cfManualRank,
        problemsSolved: cfSolved,
        problemsSolvedYear: cfSolvedYear,
        problemsSolvedMonth: cfSolvedMonth,
        maxStreak: cfStreak,
        contestHistory: cpProfiles.codeforces?.contestHistory || [],
        recentSubmissions: cpProfiles.codeforces?.recentSubmissions || [],
        strengthAnalysis: cpProfiles.codeforces?.strengthAnalysis || {
          strong: ['Implementation', 'Greedy'],
          weak: ['Dynamic Programming', 'Graphs'],
          needsImprovement: ['Constructive Algorithms'],
        },
      },
      leetcode: {
        problemsSolved: { easy: lcEasy, medium: lcMed, hard: lcHard, total: lcTotal },
        contestRating: cpProfiles.leetcode?.contestRating || 1500,
        submissionStats: {
          totalSubmissions: lcTotal * 2,
          acceptedSubmissions: lcTotal,
        },
        dailyStreak: lcStreak,
        topicWiseAnalysis: cpProfiles.leetcode?.topicWiseAnalysis || [
          { topic: 'Arrays', percentage: 75 },
          { topic: 'Strings', percentage: 60 },
          { topic: 'Trees', percentage: 40 },
          { topic: 'Dynamic Programming', percentage: 25 },
          { topic: 'Graphs', percentage: 20 },
        ],
        strengths: cpProfiles.leetcode?.strengths || ['Arrays', 'Strings'],
        weaknesses: cpProfiles.leetcode?.weaknesses || ['Dynamic Programming', 'Graphs'],
      },
      atcoder: {
        rating: acRating,
        rank: acManualRank,
        contestCount: acMatches,
        contestPerformance: cpProfiles.atcoder?.contestPerformance || [],
        submissionHistory: cpProfiles.atcoder?.submissionHistory || [],
        skillDistribution: cpProfiles.atcoder?.skillDistribution || [
          { category: 'Implementation', score: 20 },
          { category: 'Math', score: 15 },
        ],
        beginnerAreas: cpProfiles.atcoder?.beginnerAreas || ['Implementation'],
        advancedAreas: cpProfiles.atcoder?.advancedAreas || [],
        growthOpportunities: cpProfiles.atcoder?.growthOpportunities || ['Dynamic Programming'],
      },
    };

    setCpProfiles(updatedProfiles);
    await saveAppState({ cpProfiles: updatedProfiles });

    // Regenerate Coach Report with updated stats
    try {
      const report = await generateCPCoachReport(updatedProfiles, cpGoals, studyNotes);
      setCoachReport(report);
      await saveAppState({ coachReport: report });
    } catch (e) {
      console.warn('Coach report regeneration failed after manual save:', e);
    }

    setEditManualMode(false);
    alert('Stats saved! Your profile data has been updated with your manual entries.');
  };

  // Goal parsing
  const handleGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setParsingGoal(true);
    try {
      const parsed = await parseNaturalLanguageGoal(goalInput);
      const newGoal: CPGoal = {
        goalText: goalInput,
        parsed,
      };
      setCpGoals(newGoal);
      await saveAppState({ cpGoals: newGoal });

      // Run new Coach analysis with goals
      const report = await generateCPCoachReport(cpProfiles, newGoal, studyNotes);
      setCoachReport(report);
      await saveAppState({ coachReport: report });

      alert('Study goals parsed and roadmap updated!');
    } catch (e) {
      console.error(e);
      alert('Parsing failed. Goal saved as plaintext.');
    } finally {
      setParsingGoal(false);
    }
  };

  // Calendar sync & planner
  const handleGenerateSmartCalendar = async () => {
    setGeneratingCalendar(true);
    try {
      const mergedEvents = await generateSmartStudyCalendar(cpGoals, availability, calendarEvents);
      setCalendarEvents(mergedEvents);
      await saveAppState({ calendarEvents: mergedEvents });
      alert('Smart Study sessions planned around your Sleep & College hours!');
    } catch (e) {
      console.error(e);
      alert('Error generating calendar planner.');
    } finally {
      setGeneratingCalendar(false);
    }
  };

  const handleImportSchedules = async () => {
    const studySchedules = convertCalendarEventsToSchedules(calendarEvents);
    if (studySchedules.length === 0) {
      alert('No study sessions found in your planner calendar. Please run the AI planner first.');
      return;
    }
    const merged = [...schedules, ...studySchedules.filter(ns => !schedules.some(s => s.title === ns.title))];
    setSchedules(merged);
    await saveAppState({ schedules: merged });
    alert(`Successfully synced ${studySchedules.length} study sessions directly to your study blocker schedule!`);
  };

  // Knowledge base CRUD
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim()) return;

    const newNote: StudyNote = {
      id: Math.random().toString(36).substring(2),
      title: noteTitle.trim(),
      content: noteContent.trim(),
      category: noteCategory,
      tags: noteTags.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0),
      createdAt: Date.now(),
    };

    const updated = [newNote, ...studyNotes];
    setStudyNotes(updated);
    await saveAppState({ studyNotes: updated });

    setNoteTitle('');
    setNoteContent('');
    setNoteTags('');
    alert('Note added to Study Knowledge Base!');
  };

  const handleDeleteNote = async (id: string) => {
    const updated = studyNotes.filter(n => n.id !== id);
    setStudyNotes(updated);
    await saveAppState({ studyNotes: updated });
  };

  // Toggle checklist tasks in Daily Sheet
  const togglePracticeTask = async (section: 'warmup' | 'core' | 'challenge' | 'revision', itemId: string) => {
    if (!coachReport || !coachReport.dailyPractice) return;

    const report = { ...coachReport };
    const practice = report.dailyPractice;
    if (!practice) return;

    if (section === 'warmup') {
      practice.warmup = practice.warmup.map(item => item.id === itemId ? { ...item, solved: !item.solved } : item);
    } else if (section === 'core') {
      practice.core = practice.core.map(item => item.id === itemId ? { ...item, solved: !item.solved } : item);
    } else if (section === 'challenge' && practice.challenge.id === itemId) {
      practice.challenge.solved = !practice.challenge.solved;
    } else if (section === 'revision' && practice.revision.id === itemId) {
      practice.revision.solved = !practice.revision.solved;
    }

    setCoachReport(report);
    await saveAppState({ coachReport: report });
  };

  // SVG Area Chart Focus score
  const renderFocusScoreChart = () => {
    const history = analytics.focusScoreHistory;
    if (history.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-slate-500 text-xs">
          No focus data available yet. Keep study sessions active to draw chart logs.
        </div>
      );
    }

    const width = 500;
    const height = 180;
    const padding = 35;
    const maxScore = 100;
    const minScore = 0;

    const getX = (idx: number) => {
      if (history.length <= 1) return padding + (width - padding * 2) / 2;
      return padding + (idx / (history.length - 1)) * (width - padding * 2);
    };

    const getY = (score: number) => {
      return height - padding - ((score - minScore) / (maxScore - minScore)) * (height - padding * 2);
    };

    const points = history.map((h, i) => `${getX(i)},${getY(h.score)}`).join(' ');
    const areaPoints = history.length > 0
      ? `${getX(0)},${height - padding} ${points} ${getX(history.length - 1)},${height - padding}`
      : '';

    return (
      <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="scoreGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((level, i) => {
          const y = getY(level);
          return (
            <g key={i}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4" />
              <text x={padding - 10} y={y + 4} fill="#64748b" fontSize="9" textAnchor="end" className="font-mono">{level}</text>
            </g>
          );
        })}
        {history.length > 1 && <polygon points={areaPoints} fill="url(#scoreGlow)" />}
        {history.length > 1 && (
          <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {history.map((h, i) => (
          <circle key={i} cx={getX(i)} cy={getY(h.score)} r="4" className="fill-indigo-400 stroke-slate-900 stroke-2 cursor-pointer" />
        ))}
      </svg>
    );
  };

  // Dynamic SVG Rating Progress Chart for Codeforces / Leetcode / Atcoder
  const renderRatingProgressChart = () => {
    let cfHistory = cpProfiles.codeforces?.contestHistory || [];
    if (cfHistory.length === 0) {
      cfHistory = [
        { newRating: 1200 }, { newRating: 1240 }, { newRating: 1310 }, { newRating: 1280 }, { newRating: 1390 }, { newRating: 1460 }
      ]; // Demo history
    }

    const width = 500;
    const height = 180;
    const padding = 35;

    const ratings = cfHistory.map(h => h.newRating);
    const maxR = Math.max(...ratings) + 50;
    const minR = Math.min(...ratings) - 50;

    const getX = (idx: number) => {
      if (cfHistory.length <= 1) return padding + (width - padding * 2) / 2;
      return padding + (idx / (cfHistory.length - 1)) * (width - padding * 2);
    };

    const getY = (rating: number) => {
      return height - padding - ((rating - minR) / (maxR - minR)) * (height - padding * 2);
    };

    const points = cfHistory.map((h, i) => `${getX(i)},${getY(h.newRating)}`).join(' ');

    return (
      <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="ratingGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ec4899" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const ratingVal = Math.round(minR + ratio * (maxR - minR));
          const y = getY(ratingVal);
          return (
            <g key={i}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              <text x={padding - 10} y={y + 4} fill="#64748b" fontSize="8" textAnchor="end" className="font-mono">{ratingVal}</text>
            </g>
          );
        })}
        <polygon points={`${getX(0)},${height - padding} ${points} ${getX(cfHistory.length - 1)},${height - padding}`} fill="url(#ratingGrad)" />
        <polyline points={points} fill="none" stroke="#ec4899" strokeWidth="2.5" strokeLinecap="round" />
        {cfHistory.map((h, i) => (
          <circle key={i} cx={getX(i)} cy={getY(h.newRating)} r="3.5" className="fill-pink-400 stroke-slate-950" />
        ))}
      </svg>
    );
  };

  // SVG Progress Prediction Chart (Goal Target Line + Shaded Confidence Area)
  const renderProgressPredictionChart = () => {
    const growth = coachReport?.predictedGrowth || [
      { days: 0, rating: 1200 },
      { days: 30, rating: 1280 },
      { days: 60, rating: 1390 },
      { days: 90, rating: 1510 },
      { days: 120, rating: 1650 }
    ];

    const width = 500;
    const height = 180;
    const padding = 35;

    const ratings = growth.map(g => g.rating);
    const maxR = Math.max(...ratings, cpGoals.parsed?.targetRating || 1600) + 100;
    const minR = Math.min(...ratings) - 50;

    const getX = (idx: number) => {
      return padding + (idx / (growth.length - 1)) * (width - padding * 2);
    };

    const getY = (r: number) => {
      return height - padding - ((r - minR) / (maxR - minR)) * (height - padding * 2);
    };

    const points = growth.map((g, i) => `${getX(i)},${getY(g.rating)}`).join(' ');

    // Calculate confidence boundary points
    const upperPoints = growth.map((g, i) => `${getX(i)},${getY(g.rating + (i * 12))}`).join(' ');
    const lowerPoints = growth.map((g, i) => `${getX(i)},${getY(g.rating - (i * 12))}`).reverse().join(' ');

    return (
      <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="confidenceArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.5, 1].map((ratio, i) => {
          const rVal = Math.round(minR + ratio * (maxR - minR));
          const y = getY(rVal);
          return (
            <line key={i} x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.05)" />
          );
        })}
        {/* Confidence Area */}
        <polygon points={`${upperPoints} ${lowerPoints}`} fill="url(#confidenceArea)" />
        {/* Projected curve */}
        <polyline points={points} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4" />
        {/* Target Rating horizontal indicator */}
        {cpGoals.parsed && (
          <g>
            <line x1={padding} y1={getY(cpGoals.parsed.targetRating)} x2={width - padding} y2={getY(cpGoals.parsed.targetRating)} stroke="#ef4444" strokeWidth="1" strokeDasharray="3" />
            <text x={width - padding} y={getY(cpGoals.parsed.targetRating) - 4} fill="#ef4444" fontSize="8" textAnchor="end">Goal: {cpGoals.parsed.targetRating}</text>
          </g>
        )}
      </svg>
    );
  };

  // Horizontal SVG Bar Chart for topic distribution
  const renderTopicBarChart = () => {
    let topics = cpProfiles.leetcode?.topicWiseAnalysis || [
      { topic: 'Arrays', percentage: 85 },
      { topic: 'Strings', percentage: 70 },
      { topic: 'Trees', percentage: 45 },
      { topic: 'Graphs', percentage: 30 },
      { topic: 'Dynamic Programming', percentage: 20 }
    ];

    return (
      <div className="flex flex-col gap-3">
        {topics.map((t, idx) => (
          <div key={idx} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs font-semibold text-slate-300">
              <span>{t.topic}</span>
              <span className="font-mono text-indigo-400">{t.percentage}%</span>
            </div>
            <div className="w-full bg-slate-900/60 rounded-full h-2 border border-white/5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-pink-500 h-full rounded-full transition-all"
                style={{ width: `${t.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Filter study notes based on search & tags
  const filteredNotes = studyNotes.filter(n => {
    const matchesSearch = n.title.toLowerCase().includes(noteSearch.toLowerCase()) ||
      n.content.toLowerCase().includes(noteSearch.toLowerCase());
    const matchesTag = selectedTag ? n.tags.includes(selectedTag) : true;
    return matchesSearch && matchesTag;
  });

  const allNoteTags = Array.from(new Set(studyNotes.flatMap(n => n.tags)));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 bg-mesh flex relative overflow-hidden">
      {/* 1. Sidebar */}
      <aside className="w-64 bg-slate-900/60 border-r border-white/5 backdrop-blur-xl flex flex-col justify-between shrink-0 z-10">
        <div>
          {/* Sidebar Header */}
          <div className="flex items-center gap-3 px-6 py-6 border-b border-white/5 bg-slate-950/20">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="h-5.5 w-5.5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">FocusFlow</h1>
              <span className="text-[10px] text-pink-400 font-semibold tracking-wider uppercase">CP Coach V2</span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="p-4 flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'overview'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <BarChart2 className="h-4.5 w-4.5" />
              Overview & Analytics
            </button>

            <button
              onClick={() => setActiveTab('cp_coach')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'cp_coach'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Globe className="h-4.5 w-4.5" />
              CP Coach linking
            </button>

            <button
              onClick={() => setActiveTab('recommendations')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'recommendations'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Compass className="h-4.5 w-4.5" />
              AI Recommendations
            </button>

            <button
              onClick={() => setActiveTab('roadmap')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'roadmap'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Brain className="h-4.5 w-4.5" />
              Goals & Roadmap
            </button>

            <button
              onClick={() => setActiveTab('planner')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'planner'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Calendar className="h-4.5 w-4.5" />
              Study Planner
            </button>

            <button
              onClick={() => setActiveTab('calendar')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'calendar'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <CalendarRange className="h-4.5 w-4.5" />
              Smart Calendar
            </button>

            <button
              onClick={() => setActiveTab('knowledge')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'knowledge'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <FileText className="h-4.5 w-4.5" />
              Knowledge Base
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'settings'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Settings2 className="h-4.5 w-4.5" />
              Settings
            </button>
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/5 bg-slate-950/20 text-xs">
          <div className="flex items-center gap-3 px-3 py-2 bg-white/5 rounded-xl border border-white/5">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-300 font-medium">Coach Engine Active</span>
          </div>
        </div>
      </aside>

      {/* 2. Main content container */}
      <main className="flex-1 min-w-0 flex flex-col z-0 overflow-y-auto">
        <header className="px-8 py-5 border-b border-white/5 bg-slate-900/10 backdrop-blur-sm flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white uppercase">
              {activeTab === 'overview' && 'Analytics Overview'}
              {activeTab === 'cp_coach' && 'Competitive Programming Profile Linking'}
              {activeTab === 'recommendations' && 'AI Recommendations & Daily Sheet'}
              {activeTab === 'roadmap' && 'Smart Goals & Roadmap'}
              {activeTab === 'planner' && 'Study Schedule Planner'}
              {activeTab === 'calendar' && 'Smart Calendar Planner'}
              {activeTab === 'knowledge' && 'Study Knowledge Base'}
              {activeTab === 'settings' && 'Extension settings'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeTab === 'overview' && "Track focus scores, streak progress, and daily practice lists."}
              {activeTab === 'cp_coach' && 'Connect platform handles to analyze strengths and ratings.'}
              {activeTab === 'recommendations' && 'Generate daily practice sheets and recommendations.'}
              {activeTab === 'roadmap' && 'Define goals in natural language to compile roadmaps.'}
              {activeTab === 'planner' && 'Customize schedules, strictness triggers, and domain permissions.'}
              {activeTab === 'calendar' && 'Manage availability and synchronize smart conflict-free events.'}
              {activeTab === 'knowledge' && 'Organize coding notes, learnings, templates, and algorithms.'}
              {activeTab === 'settings' && 'Configure API parameters, lock passwords, and analyze architectures.'}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500 animate-bounce" />
              <div className="text-right">
                <div className="text-sm font-bold text-white leading-tight">{analytics.dailyStreak} Days</div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Daily Streak</div>
              </div>
            </div>
          </div>
        </header>

        {/* Tab contents */}
        <div className="flex-1 p-8 overflow-y-auto">

          {/* TAB 1: OVERVIEW & ANALYTICS */}
          {activeTab === 'overview' && (
            <div className="flex flex-col gap-8 animate-slide-up">
              {/* Top Banner for Active Study */}
              {breakState.inBreak ? (
                <div className="glass rounded-2xl p-6 border-indigo-500/20 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4.5">
                    <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/25">
                      <Coffee className="h-7 w-7 text-indigo-400 animate-bounce" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">Break active</h3>
                      <p className="text-xs text-slate-400 mt-1">FocusFlow monitoring is temporarily paused. Get up and stretch!</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <span className="font-mono text-2xl font-extrabold text-indigo-400">{formatRemainingTime(breakSecondsLeft)}</span>
                    <button onClick={endQuickBreak} className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2 px-4 rounded-xl transition-all">Resume Session</button>
                  </div>
                </div>
              ) : activeTask ? (
                <div className="glass rounded-2xl p-6 border-indigo-500/15 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4.5">
                    <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/25">
                      <BookOpen className="h-7 w-7 text-indigo-400" />
                    </div>
                    <div>
                      <span className="text-[10px] text-indigo-400 font-bold uppercase">Study slot active</span>
                      <h3 className="text-lg font-bold text-white mt-0.5">{activeTask.title}</h3>
                      {activeTask.description && <p className="text-xs text-slate-400 mt-0.5">{activeTask.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <div className="text-right">
                      <span className="text-[9px] text-slate-500 block">TIME REMAINING</span>
                      <span className="font-mono text-2xl font-extrabold text-white tracking-widest">{formatRemainingTime(secondsLeft)}</span>
                    </div>
                    <a href={activeTask.targetUrl} target="_blank" rel="noreferrer" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2.5 px-4 rounded-xl flex items-center gap-1">
                      Start Coding <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="glass rounded-2xl p-6 border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Zap className="h-6 w-6 text-slate-400" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-300">No scheduled study session currently active.</h3>
                      <p className="text-xs text-slate-500">Configure time slots in the Schedule Planner or AI Smart Calendar.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Main metrics grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between">
                  <span className="text-xs text-slate-400">Task Focus Hours</span>
                  <div className="text-2xl font-extrabold text-white mt-2">{analytics.focusHours.toFixed(1)} hrs</div>
                </div>
                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between">
                  <span className="text-xs text-slate-400">Distraction Attempts</span>
                  <div className="text-2xl font-extrabold text-white mt-2">{analytics.distractionAttempts}</div>
                </div>
                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between">
                  <span className="text-xs text-slate-400">Strict Redirections</span>
                  <div className="text-2xl font-extrabold text-white mt-2">{analytics.redirectCount}</div>
                </div>
                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between">
                  <span className="text-xs text-slate-400">Connected Platforms</span>
                  <div className="text-lg font-bold text-white mt-2 flex gap-1">
                    {cpProfiles.codeforcesHandle && <span className="bg-red-500/10 text-red-300 border border-red-500/20 text-[9px] px-1.5 py-0.5 rounded">CF</span>}
                    {cpProfiles.leetcodeUsername && <span className="bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 text-[9px] px-1.5 py-0.5 rounded">LC</span>}
                    {cpProfiles.atcoderUsername && <span className="bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[9px] px-1.5 py-0.5 rounded">AC</span>}
                    {!cpProfiles.codeforcesHandle && !cpProfiles.leetcodeUsername && !cpProfiles.atcoderUsername && <span className="text-slate-500 text-xs">None linked</span>}
                  </div>
                </div>
              </div>

              {/* Charts grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Daily Focus Score line graph */}
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2">
                  <h3 className="text-sm font-bold text-white mb-4">Daily Focus Score History</h3>
                  <div className="h-52">{renderFocusScoreChart()}</div>
                </div>

                {/* Upcoming Contests countdown calendar widget — Live data from Kontests API */}
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-white">Contest Tracker</h3>
                      <p className="text-[10px] text-slate-400 mt-0.5">Live upcoming contests across platforms.</p>
                    </div>
                    <button
                      onClick={refreshContests}
                      disabled={contestsLoading}
                      title="Refresh contests"
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 text-slate-400 ${contestsLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {contestsLoading && upcomingContests.length === 0 ? (
                    <div className="flex flex-col gap-2">
                      {[0,1,2].map(i => (
                        <div key={i} className="h-14 bg-white/5 rounded-xl border border-white/5 animate-pulse" />
                      ))}
                    </div>
                  ) : contestsFetched && upcomingContests.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-2">
                      <AlertCircle className="h-6 w-6 text-slate-600" />
                      <p className="text-xs text-slate-500 text-center">No upcoming contests found.<br/>Check your connection or try refreshing.</p>
                      <button onClick={refreshContests} className="text-[10px] text-indigo-400 underline font-semibold mt-1">Retry</button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {upcomingContests.map((c, i) => {
                        const totalMins = Math.round((c.startTime - Date.now()) / (60 * 1000));
                        const days = Math.floor(totalMins / (60 * 24));
                        const hours = Math.floor((totalMins % (60 * 24)) / 60);
                        const mins = totalMins % 60;
                        const timeLabel = days > 0
                          ? `${days}d ${hours}h`
                          : hours > 0
                          ? `${hours}h ${mins}m`
                          : `${mins}m`;
                        const isVeryClose = totalMins <= 60; // within 1 hour

                        return (
                          <div key={i} className="flex justify-between items-center p-2.5 bg-white/5 rounded-xl border border-white/5 hover:bg-white/8 transition-all">
                            <div className="min-w-0 flex-1 pr-2">
                              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                c.platform === 'Codeforces' ? 'bg-red-500/10 text-red-400' :
                                c.platform === 'LeetCode' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
                              }`}>{c.platform}</span>
                              <h4 className="text-[11px] font-semibold text-slate-200 mt-1 leading-tight truncate">{c.name}</h4>
                            </div>
                            <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                              <span className={`text-[10px] font-mono font-bold ${
                                isVeryClose ? 'text-rose-400 animate-pulse' : 'text-indigo-400'
                              }`}>
                                {isVeryClose && '🔴 '}{timeLabel}
                              </span>
                              <div className="flex gap-1.5">
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[8px] text-slate-400 hover:text-white underline font-semibold"
                                >
                                  Open
                                </a>
                                <button
                                  onClick={() => {
                                    const endMs = c.startTime + c.durationSeconds * 1000;
                                    const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(c.name)}&dates=${new Date(c.startTime).toISOString().replace(/-|:|\.\d\d\d/g, '')}/${new Date(endMs).toISOString().replace(/-|:|\.\d\d\d/g, '')}&details=FocusFlow+Contest+Reminder+-+${encodeURIComponent(c.platform)}`;
                                    window.open(calUrl, '_blank');
                                  }}
                                  className="text-[8px] text-indigo-300 hover:text-indigo-200 underline font-semibold"
                                >
                                  + Cal
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Coach accountability alerts & Daily Practice widgets */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-1.5">
                      <Compass className="h-4.5 w-4.5 text-indigo-400" />
                      Daily CP Practice Sheet
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Solve these daily sheet tasks compiled by your CP mentor.</p>
                  </div>
                  {coachReport?.dailyPractice ? (
                    <div className="flex flex-col gap-2 mt-4">
                      {coachReport.dailyPractice.warmup.map(item => (
                        <div key={item.id} className="flex justify-between items-center p-2 bg-slate-900/50 rounded-lg border border-white/5">
                          <button onClick={() => togglePracticeTask('warmup', item.id)} className="flex items-center gap-2 text-xs text-left">
                            {item.solved ? <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" /> : <Square className="h-4 w-4 text-slate-500 shrink-0" />}
                            <span className={item.solved ? 'line-through text-slate-500' : 'text-slate-200'}>[Warmup] {item.name}</span>
                          </button>
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /></a>
                        </div>
                      ))}
                      {coachReport.dailyPractice.core.map(item => (
                        <div key={item.id} className="flex justify-between items-center p-2 bg-slate-900/50 rounded-lg border border-white/5">
                          <button onClick={() => togglePracticeTask('core', item.id)} className="flex items-center gap-2 text-xs text-left">
                            {item.solved ? <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" /> : <Square className="h-4 w-4 text-slate-500 shrink-0" />}
                            <span className={item.solved ? 'line-through text-slate-500' : 'text-slate-200'}>[Core] {item.name}</span>
                          </button>
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /></a>
                        </div>
                      ))}
                      <div className="flex justify-between items-center p-2 bg-slate-900/50 rounded-lg border border-white/5">
                        <button onClick={() => togglePracticeTask('challenge', coachReport.dailyPractice!.challenge.id)} className="flex items-center gap-2 text-xs text-left">
                          {coachReport.dailyPractice.challenge.solved ? <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" /> : <Square className="h-4 w-4 text-slate-500 shrink-0" />}
                          <span className={coachReport.dailyPractice.challenge.solved ? 'line-through text-slate-500' : 'text-slate-200'}>[Challenge] {coachReport.dailyPractice.challenge.name}</span>
                        </button>
                        <a href={coachReport.dailyPractice.challenge.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                      <div className="flex justify-between items-center p-2 bg-slate-900/50 rounded-lg border border-white/5">
                        <button onClick={() => togglePracticeTask('revision', coachReport.dailyPractice!.revision.id)} className="flex items-center gap-2 text-xs text-left">
                          {coachReport.dailyPractice.revision.solved ? <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" /> : <Square className="h-4 w-4 text-slate-500 shrink-0" />}
                          <span className={coachReport.dailyPractice.revision.solved ? 'line-through text-slate-500' : 'text-slate-200'}>[Revision] {coachReport.dailyPractice.revision.name}</span>
                        </button>
                        <a href={coachReport.dailyPractice.revision.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500 text-xs py-8 text-center">
                      Configure your profiles and goals to generate today's practice checklist sheet.
                    </div>
                  )}
                </div>

                {/* AI Accountability Card */}
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col justify-between text-left">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Shield className="h-4.5 w-4.5 text-pink-400" />
                      Accountability Partner
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Coaching advice based on study consistency.</p>
                  </div>
                  <div className="bg-slate-900/60 p-4 rounded-xl border border-white/5 my-4">
                    {analytics.distractionAttempts > 6 ? (
                      <p className="text-xs text-rose-300 leading-relaxed font-semibold">
                        "You planned to solve problems today, but you got distracted {analytics.distractionAttempts} times. You are falling behind your roadmap goals!"
                      </p>
                    ) : analytics.focusHours > 1.5 ? (
                      <p className="text-xs text-emerald-300 leading-relaxed font-semibold">
                        "Incredible work! You logged {analytics.focusHours.toFixed(1)} focused study hours. Keep the streak active!"
                      </p>
                    ) : (
                      <p className="text-xs text-slate-300 leading-relaxed">
                        "Your daily goals are set. Open your practice sheets and avoid distractions to keep your coach happy."
                      </p>
                    )}
                  </div>
                  <button onClick={() => setActiveTab('roadmap')} className="w-full bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5 font-semibold text-xs py-2 px-4 rounded-xl transition-all">
                    View Progress Predictions
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CP COACH PROFILE LINKING */}
          {activeTab === 'cp_coach' && (
            <div className="flex flex-col gap-6 max-w-4xl animate-slide-up">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Profile linking forms */}
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Globe className="h-4.5 w-4.5 text-indigo-400" />
                    Linked Platforms
                  </h3>
                  <p className="text-[10px] text-slate-400">Enter usernames to link profiles. FocusFlow reads public status APIs.</p>

                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-slate-300">Codeforces Handle</label>
                      <input type="text" value={cfInput} onChange={e => setCfInput(e.target.value)} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200" placeholder="e.g. tourist" />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-slate-300">LeetCode Username</label>
                      <input type="text" value={lcInput} onChange={e => setLcInput(e.target.value)} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200" placeholder="e.g. shohei" />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-slate-300">AtCoder Username</label>
                      <input type="text" value={acInput} onChange={e => setAcInput(e.target.value)} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200" placeholder="e.g. chokudai" />
                    </div>

                    <button onClick={handleProfileSync} disabled={syncing} className="w-full bg-gradient-to-r from-indigo-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg mt-2 transition-all flex items-center justify-center gap-2">
                      {syncing ? <RefreshCw className="h-4.5 w-4.5 animate-spin" /> : <RefreshCw className="h-4.5 w-4.5" />}
                      {syncing ? 'Syncing Profiles...' : 'Sync Connected Platforms'}
                    </button>
                  </div>
                </div>

                {/* Profile Sync details & Manual Override Editor */}
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-sm font-bold text-white mb-0.5">Sync Status & Override</h3>
                      <p className="text-[10px] text-slate-400">Last sync: {cpProfiles.lastSyncTime ? new Date(cpProfiles.lastSyncTime).toLocaleString() : 'Never'}</p>
                    </div>
                    <button
                      onClick={() => setEditManualMode(prev => !prev)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                        editManualMode
                          ? 'bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25'
                          : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25'
                      }`}
                    >
                      {editManualMode ? '✕ Cancel Edit' : '✏ Edit Stats'}
                    </button>
                  </div>

                  {!editManualMode ? (
                    /* Read-only sync status view */
                    <div className="flex flex-col gap-2">
                      <div className="p-3 bg-slate-900/60 rounded-xl border border-white/5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide">⬡ Codeforces</span>
                          {cpProfiles.codeforces ? (
                            <span className="text-[10px] text-emerald-400 font-semibold">● Synced</span>
                          ) : <span className="text-[10px] text-slate-500">○ Unlinked</span>}
                        </div>
                        {cpProfiles.codeforces ? (
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Rating</p>
                              <p className="text-sm font-bold font-mono text-red-300">{cpProfiles.codeforces.rating} <span className="text-[9px] text-slate-400 font-normal">({cpProfiles.codeforces.rank})</span></p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Total Solved</p>
                              <p className="text-sm font-bold font-mono text-white">{cpProfiles.codeforces.problemsSolved}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">This Year</p>
                              <p className="text-xs font-bold font-mono text-slate-300">{cpProfiles.codeforces.problemsSolvedYear ?? '—'}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">This Month</p>
                              <p className="text-xs font-bold font-mono text-slate-300">{cpProfiles.codeforces.problemsSolvedMonth ?? '—'}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[9px] text-slate-500 uppercase">Max Streak</p>
                              <p className="text-xs font-bold font-mono text-amber-300">{cpProfiles.codeforces.maxStreak ?? '—'} days 🔥</p>
                            </div>
                          </div>
                        ) : <p className="text-[10px] text-slate-500 mt-1">Enter handle and sync to load data.</p>}
                      </div>

                      <div className="p-3 bg-slate-900/60 rounded-xl border border-white/5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">◈ LeetCode</span>
                          {cpProfiles.leetcode ? (
                            <span className="text-[10px] text-emerald-400 font-semibold">● Synced</span>
                          ) : <span className="text-[10px] text-slate-500">○ Unlinked</span>}
                        </div>
                        {cpProfiles.leetcode ? (
                          <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1">
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Easy</p>
                              <p className="text-sm font-bold font-mono text-emerald-400">{cpProfiles.leetcode.problemsSolved.easy}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Medium</p>
                              <p className="text-sm font-bold font-mono text-amber-400">{cpProfiles.leetcode.problemsSolved.medium}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Hard</p>
                              <p className="text-sm font-bold font-mono text-rose-400">{cpProfiles.leetcode.problemsSolved.hard}</p>
                            </div>
                            <div className="col-span-3">
                              <p className="text-[9px] text-slate-500 uppercase">Total &bull; Streak</p>
                              <p className="text-xs font-bold font-mono text-white">{cpProfiles.leetcode.problemsSolved.total} solved &bull; <span className="text-amber-300">{cpProfiles.leetcode.dailyStreak} days 🔥</span></p>
                            </div>
                          </div>
                        ) : <p className="text-[10px] text-slate-500 mt-1">Enter username and sync to load data.</p>}
                      </div>

                      <div className="p-3 bg-slate-900/60 rounded-xl border border-white/5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">◇ AtCoder</span>
                          {cpProfiles.atcoder ? (
                            <span className="text-[10px] text-emerald-400 font-semibold">● Synced</span>
                          ) : <span className="text-[10px] text-slate-500">○ Unlinked</span>}
                        </div>
                        {cpProfiles.atcoder ? (
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Rating</p>
                              <p className="text-sm font-bold font-mono text-blue-300">{cpProfiles.atcoder.rating}</p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 uppercase">Rank</p>
                              <p className="text-sm font-bold font-mono text-blue-300">{cpProfiles.atcoder.rank || '—'}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[9px] text-slate-500 uppercase">Rated Matches</p>
                              <p className="text-xs font-bold font-mono text-slate-300">{cpProfiles.atcoder.contestCount ?? 0} contests</p>
                            </div>
                          </div>
                        ) : <p className="text-[10px] text-slate-500 mt-1">Enter username and sync to load data.</p>}
                      </div>

                      <p className="text-[10px] text-slate-500 pt-1">APIs may be inaccurate due to CORS/proxy limits. Use ✏ Edit Stats to override with your real numbers.</p>
                    </div>
                  ) : (
                    /* Manual Edit Mode */
                    <div className="flex flex-col gap-4">
                      <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                        <p className="text-[10px] font-bold text-red-300 mb-0.5">⬡ Codeforces — Manual Entry</p>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Rating</label>
                            <input type="number" value={cfManualRating} onChange={e => setCfManualRating(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Max Rating</label>
                            <input type="number" value={cfManualMaxRating} onChange={e => setCfManualMaxRating(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Rank</label>
                            <input type="text" value={cfManualRank} onChange={e => setCfManualRank(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Total Solved</label>
                            <input type="number" value={cfManualSolved} onChange={e => setCfManualSolved(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Solved (Year)</label>
                            <input type="number" value={cfManualSolvedYear} onChange={e => setCfManualSolvedYear(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Solved (Month)</label>
                            <input type="number" value={cfManualSolvedMonth} onChange={e => setCfManualSolvedMonth(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1 col-span-2">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Max Streak (days)</label>
                            <input type="number" value={cfManualStreak} onChange={e => setCfManualStreak(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-red-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                        <p className="text-[10px] font-bold text-amber-300 mb-0.5">◈ LeetCode — Manual Entry</p>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Easy Solved</label>
                            <input type="number" value={lcManualEasy} onChange={e => setLcManualEasy(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-amber-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-emerald-300 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Medium Solved</label>
                            <input type="number" value={lcManualMed} onChange={e => setLcManualMed(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-amber-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Hard Solved</label>
                            <input type="number" value={lcManualHard} onChange={e => setLcManualHard(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-amber-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-rose-300 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Daily Streak (days)</label>
                            <input type="number" value={lcManualStreak} onChange={e => setLcManualStreak(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-amber-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                        <p className="text-[10px] font-bold text-blue-300 mb-0.5">◇ AtCoder — Manual Entry</p>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Rating</label>
                            <input type="number" value={acManualRating} onChange={e => setAcManualRating(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-blue-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-blue-300 font-mono" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Rank</label>
                            <input type="text" value={acManualRank} onChange={e => setAcManualRank(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-blue-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200" />
                          </div>
                          <div className="flex flex-col gap-1 col-span-2">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Rated Matches</label>
                            <input type="number" value={acManualMatches} onChange={e => setAcManualMatches(e.target.value)}
                              className="bg-slate-950 border border-white/10 focus:border-blue-400 outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono" />
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveManualStats}
                          className="flex-1 bg-gradient-to-r from-indigo-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all shadow-lg shadow-indigo-500/20"
                        >
                          ✓ Save Stats & Regenerate Coach
                        </button>
                        <button
                          onClick={() => setEditManualMode(false)}
                          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 border border-white/10 font-semibold text-xs rounded-xl transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced Coach Analysis (Strength chart & topic distribution) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass rounded-2xl p-6 border-white/5">
                  <h3 className="text-sm font-bold text-white mb-2">Rating Progress Timeline</h3>
                  <div className="h-44">{renderRatingProgressChart()}</div>
                </div>

                <div className="glass rounded-2xl p-6 border-white/5">
                  <h3 className="text-sm font-bold text-white mb-4">Topic Mastery (LeetCode)</h3>
                  {renderTopicBarChart()}
                </div>
              </div>

              {/* Strength analysis report */}
              <div className="glass rounded-2xl p-6 border-white/5">
                <h3 className="text-sm font-bold text-white mb-3">AI Strength & Weakness Analysis</h3>
                {coachReport ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20">
                      <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase">
                        <Check className="h-4 w-4" /> Strong topics
                      </h4>
                      <ul className="text-xs text-slate-300 mt-3 flex flex-col gap-1.5">
                        {coachReport.strongTopics.map((topic, i) => <li key={i}>• {topic}</li>)}
                      </ul>
                    </div>
                    <div className="p-4 bg-rose-500/5 rounded-xl border border-rose-500/20">
                      <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5 uppercase">
                        <X className="h-4 w-4" /> Weak topics
                      </h4>
                      <ul className="text-xs text-slate-300 mt-3 flex flex-col gap-1.5">
                        {coachReport.weakTopics.map((topic, i) => <li key={i}>• {topic}</li>)}
                      </ul>
                    </div>
                    <div className="p-4 bg-amber-500/5 rounded-xl border border-amber-500/20">
                      <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5 uppercase">
                        <Activity className="h-4 w-4" /> Needs Improvement
                      </h4>
                      <div className="text-xs text-slate-300 mt-3 leading-relaxed">
                        Goal Rating Target: <strong className="text-white">{cpGoals.parsed?.targetRating || '1600'}</strong>.
                        Suggested focus is prioritizing Dynamic Programming and Graph traversals.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500 text-xs py-4 text-center">
                    Link platform handles and sync profiles to draw AI strength analyses.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: AI RECOMMENDATIONS & DAILY CP SHEET */}
          {activeTab === 'recommendations' && (
            <div className="flex flex-col gap-6 max-w-4xl animate-slide-up">
              <div className="flex justify-between items-center bg-slate-900/20 p-4 rounded-xl border border-white/5">
                <span className="text-xs text-slate-400 font-semibold">Today's Recommended Questions</span>
                <button onClick={handleProfileSync} disabled={syncing} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-4 rounded-xl transition-all active:scale-[0.98]">
                  Regenerate Recommendations
                </button>
              </div>

              {coachReport?.recommendations ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {coachReport.recommendations.map(rec => (
                    <div key={rec.id} className="glass rounded-xl p-5 border border-white/5 flex flex-col justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded ${
                            rec.platform === 'codeforces' ? 'bg-red-500/10 text-red-300' :
                            rec.platform === 'leetcode' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300'
                          }`}>{rec.platform}</span>
                          <span className="text-[10px] text-slate-400 font-mono">#{rec.problemId}</span>
                        </div>
                        <h4 className="text-sm font-bold text-white mt-1.5 leading-tight">{rec.name}</h4>
                        <div className="flex flex-wrap gap-1 mt-3">
                          {rec.tags.map((tag, i) => (
                            <span key={i} className="text-[9px] bg-white/5 border border-white/5 px-2 py-0.5 rounded text-slate-400 font-mono">{tag}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-2 pt-3 border-t border-white/5">
                        <span className="text-xs text-slate-400">Difficulty: <strong className="text-indigo-300">{rec.difficulty}</strong></span>
                        <a href={rec.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline flex items-center gap-1 font-semibold">
                          View Problem <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="glass rounded-2xl p-12 border-white/5 text-center flex flex-col items-center justify-center gap-3">
                  <Compass className="h-10 w-10 text-slate-500" />
                  <h3 className="text-sm font-bold text-white">No recommendations generated</h3>
                  <p className="text-xs text-slate-400 max-w-sm">Connect your competitive programming profiles and study goals to populate recommended questions.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SMART GOAL & ROADMAP GENERATOR */}
          {activeTab === 'roadmap' && (
            <div className="flex flex-col gap-6 max-w-4xl animate-slide-up">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Natural language Goal input */}
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2 flex flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Set Study Goals</h3>
                    <p className="text-[10px] text-slate-400">Explain your study goals in natural language. Gemini will parse targets and topics.</p>
                  </div>
                  <form onSubmit={handleGoalSubmit} className="flex flex-col gap-3">
                    <textarea value={goalInput} onChange={e => setGoalInput(e.target.value)} className="w-full bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl p-4 text-xs font-medium text-slate-200 min-h-[100px] transition-all" placeholder="e.g. I want to reach Codeforces Expert rating in 6 months. I can practice 15 hours weekly, prioritizing Graphs and DP." />
                    <button type="submit" disabled={parsingGoal} className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2.5 px-5 rounded-xl transition-all self-end flex items-center gap-1.5">
                      {parsingGoal && <RefreshCw className="h-4 w-4 animate-spin" />}
                      Parse Goals
                    </button>
                  </form>
                </div>

                {/* Parsed Goal Target Card */}
                <div className="glass rounded-2xl p-6 border-white/5 text-left flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-2">Target Objectives</h3>
                    {cpGoals.parsed ? (
                      <div className="flex flex-col gap-2.5 mt-4 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Target Rating:</span>
                          <span className="font-bold text-white">{cpGoals.parsed.targetRating}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Hours / Week:</span>
                          <span className="font-bold text-white">{cpGoals.parsed.weeklyHours} hrs</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Deadline:</span>
                          <span className="font-bold text-white">{cpGoals.parsed.deadline}</span>
                        </div>
                        <div className="flex flex-col gap-1.5 mt-2">
                          <span className="text-slate-400">Priority Topics:</span>
                          <div className="flex flex-wrap gap-1">
                            {cpGoals.parsed.priorityTopics.map((pt, i) => (
                              <span key={i} className="text-[9px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">{pt}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : <span className="text-xs text-slate-500">No active goals configured.</span>}
                  </div>
                </div>
              </div>

              {/* Progress Prediction curve and roadmap */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2">
                  <h3 className="text-sm font-bold text-white mb-1">Progress Prediction Engine</h3>
                  <p className="text-[10px] text-slate-400 mb-4">Rating growth curve forecast with {coachReport?.predictedConfidence || 75}% confidence range.</p>
                  <div className="h-48">{renderProgressPredictionChart()}</div>
                </div>

                <div className="glass rounded-2xl p-6 border-white/5 text-left">
                  <h3 className="text-sm font-bold text-white mb-3">Roadmap Milestones</h3>
                  {coachReport?.roadmap ? (
                    <div className="flex flex-col gap-3 overflow-y-auto max-h-[220px] pr-2">
                      {coachReport.roadmap.map(rm => (
                        <div key={rm.id} className="p-3 bg-white/5 rounded-xl border border-white/5 text-xs">
                          <div className="flex justify-between items-center">
                            <h4 className="font-bold text-slate-200">{rm.month}</h4>
                            <span className="text-[8px] bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded font-mono uppercase">Mastery Target</span>
                          </div>
                          <p className="text-slate-400 text-[10px] mt-1">{rm.description}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {rm.topics.map((t, idx) => <span key={idx} className="text-[8px] bg-slate-800 text-slate-400 px-1 py-0.5 rounded font-mono">#{t}</span>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <span className="text-xs text-slate-500">A roadmap will generate once you synch profiles and parse goals.</span>}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: STUDY SCHEDULE PLANNER */}
          {activeTab === 'planner' && (
            <div className="flex flex-col gap-6 animate-slide-up">
              <div className="flex justify-between items-center bg-slate-900/20 p-4 rounded-xl border border-white/5">
                <span className="text-xs text-slate-400 font-semibold">{schedules.length} Study Slots Planned</span>
                <div className="flex gap-2">
                  <button onClick={handleImportSchedules} className="bg-white/5 hover:bg-white/10 text-slate-200 border border-white/5 font-semibold text-xs py-2 px-4 rounded-xl transition-all">
                    Sync from Smart Calendar
                  </button>
                  <button
                    onClick={() => {
                      setEditingSchedule(null);
                      setScheduleForm({
                        title: '',
                        description: '',
                        startTime: '09:00',
                        endTime: '10:00',
                        targetUrl: 'https://',
                        allowedDomains: '',
                        strictMode: false,
                        warningThreshold: 50,
                      });
                      setShowScheduleModal(true);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 shadow-md shadow-indigo-600/10 transition-all active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4" />
                    Add Study Slot
                  </button>
                </div>
              </div>

              {/* Schedules Timeline Cards */}
              <div className="flex flex-col gap-4">
                {schedules.length === 0 ? (
                  <div className="glass rounded-2xl p-12 border-white/5 text-center flex flex-col items-center justify-center gap-3">
                    <Calendar className="h-10 w-10 text-slate-500" />
                    <h3 className="text-sm font-bold text-white">No schedules configured</h3>
                    <p className="text-xs text-slate-400 max-w-[280px]">Define your study sessions to automatically block distractions during time blocks.</p>
                  </div>
                ) : (
                  schedules.map((schedule, index) => {
                    const isActive = isTaskActiveNow(schedule);
                    return (
                      <div
                        key={schedule.id}
                        className={`glass rounded-2xl p-5 border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-5 relative overflow-hidden ${
                          isActive
                            ? 'border-indigo-500/25 bg-slate-900/30'
                            : 'border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${
                          isActive ? 'bg-indigo-500' : 'bg-slate-800'
                        }`} />

                        <div className="flex-1 pl-3">
                          <div className="flex items-center gap-2">
                            <h4 className="text-base font-bold text-white">{schedule.title}</h4>
                            {isActive && (
                              <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                              </span>
                            )}
                            {schedule.strictMode && (
                              <span className="bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <Lock className="h-2.5 w-2.5" />
                                Strict
                              </span>
                            )}
                          </div>

                          {schedule.description && (
                            <p className="text-xs text-slate-400 mt-1 line-clamp-1 max-w-xl">{schedule.description}</p>
                          )}

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-slate-400">
                            <span className="font-mono text-slate-300 font-medium">
                              {formatTimeSlot(schedule.startTime, schedule.endTime)}
                            </span>
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-700 hidden md:inline" />
                            <span className="flex items-center gap-1">
                              Target URL:
                              <a href={schedule.targetUrl} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline flex items-center gap-0.5">
                                {schedule.targetUrl.substring(0, 30)}...
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                            <span className="text-[10px] text-slate-500 font-semibold mr-1.5">ALLOWED DOMAINS:</span>
                            {schedule.allowedDomains.map((d, i) => (
                              <span key={i} className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded-md text-slate-300 font-mono">
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto border-t md:border-t-0 pt-4 md:pt-0 w-full md:w-auto justify-end">
                          <div className="flex gap-1 border-r border-white/5 pr-2 mr-2">
                            <button
                              onClick={() => reorderSchedule(index, 'up')}
                              disabled={index === 0}
                              className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-all border border-white/5"
                              title="Move Up"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => reorderSchedule(index, 'down')}
                              disabled={index === schedules.length - 1}
                              className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white disabled:opacity-30 transition-all border border-white/5"
                              title="Move Down"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </div>

                          <button
                            onClick={() => openEditModal(schedule)}
                            className="p-2 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 hover:text-white border border-indigo-500/20 transition-all"
                            title="Edit"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => handleDeleteCheck(schedule)}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-white border border-rose-500/20 transition-all"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 6: SMART CALENDAR & GOOGLE CALENDAR SYNC */}
          {activeTab === 'calendar' && (
            <div className="flex flex-col gap-6 max-w-4xl animate-slide-up">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Availability Configurations */}
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Availability Limits</h3>
                    <p className="text-[10px] text-slate-400">Configure hours to avoid scheduling study blocks inside them.</p>
                  </div>
                  <div className="flex flex-col gap-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">Sleep Start</label>
                        <input type="time" value={availability.sleepStart} onChange={e => setAvailability({ ...availability, sleepStart: e.target.value })} className="w-full bg-slate-950 border border-white/10 outline-none rounded-lg p-2 font-mono" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">Sleep End</label>
                        <input type="time" value={availability.sleepEnd} onChange={e => setAvailability({ ...availability, sleepEnd: e.target.value })} className="w-full bg-slate-950 border border-white/10 outline-none rounded-lg p-2 font-mono" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">College/Work Start</label>
                        <input type="time" value={availability.workStart} onChange={e => setAvailability({ ...availability, workStart: e.target.value })} className="w-full bg-slate-950 border border-white/10 outline-none rounded-lg p-2 font-mono" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">College/Work End</label>
                        <input type="time" value={availability.workEnd} onChange={e => setAvailability({ ...availability, workEnd: e.target.value })} className="w-full bg-slate-950 border border-white/10 outline-none rounded-lg p-2 font-mono" />
                      </div>
                    </div>
                  </div>
                  <button onClick={handleGenerateSmartCalendar} disabled={generatingCalendar} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 px-4 rounded-xl transition-all mt-2">
                    {generatingCalendar ? 'Planning slots...' : 'Run AI Calendar Planner'}
                  </button>
                </div>

                {/* Conflict Warnings & Google Calendar Sync actions */}
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-1">
                      <AlertCircle className="h-4.5 w-4.5 text-amber-400" /> Conflict Management
                    </h3>
                    <p className="text-[10px] text-slate-400 mb-4 font-medium">Clashes detected against work, sleep, or college slots are automatically resolved.</p>
                  </div>
                  <div className="bg-slate-900/60 p-4 rounded-xl border border-white/5 text-xs text-slate-300 leading-relaxed my-2">
                    <strong>Synced Status:</strong> Clashes avoided for 7 study sessions scheduled around lectures (10:00 - 14:00) and sleep blocks (23:00 - 07:00).
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleImportSchedules} className="flex-1 bg-gradient-to-r from-indigo-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white font-semibold text-xs py-3 px-4 rounded-xl transition-all shadow-md">
                      Sync Study Blocks to Blocker Schedules
                    </button>
                  </div>
                </div>
              </div>

              {/* Calendar Timeline display */}
              <div className="glass rounded-2xl p-6 border-white/5 text-left">
                <h3 className="text-sm font-bold text-white mb-4">Study Planner Calendar (Next 7 Days)</h3>
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2">
                  {calendarEvents.map((evt, idx) => (
                    <div key={evt.id || idx} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-white/5 text-xs">
                      <div>
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase mr-2 ${
                          evt.category === 'sleep' ? 'bg-slate-800 text-slate-400' :
                          evt.category === 'class' ? 'bg-blue-500/10 text-blue-300' :
                          evt.category === 'study' ? 'bg-indigo-500/10 text-indigo-300' : 'bg-emerald-500/10 text-emerald-300'
                        }`}>{evt.category || 'Event'}</span>
                        <strong className="text-slate-100">{evt.title}</strong>
                      </div>
                      <div className="text-right font-mono text-[10px] text-slate-400">
                        {new Date(evt.start).toLocaleString()} - {new Date(evt.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: STUDY KNOWLEDGE BASE */}
          {activeTab === 'knowledge' && (
            <div className="flex flex-col gap-6 max-w-4xl animate-slide-up">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Notes Input / Addition */}
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-1 flex flex-col justify-between gap-4 self-start">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Create Note / Mistake</h3>
                    <p className="text-[10px] text-slate-400">Log mistakes, contest observations, templates, or algorithm codes.</p>
                  </div>

                  <form onSubmit={handleAddNote} className="flex flex-col gap-3 text-xs">
                    <div className="flex flex-col gap-1">
                      <label className="text-slate-300 font-medium">Title</label>
                      <input type="text" required value={noteTitle} onChange={e => setNoteTitle(e.target.value)} className="bg-slate-950 border border-white/10 outline-none rounded-lg p-2 text-white" placeholder="e.g. Dijkstra TLE Mistake" />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-slate-300 font-medium">Category</label>
                      <select value={noteCategory} onChange={e => setNoteCategory(e.target.value as any)} className="bg-slate-950 border border-white/10 outline-none rounded-lg p-2 text-white">
                        <option value="notes">Notes</option>
                        <option value="learnings">Learnings</option>
                        <option value="mistakes">Mistakes Log</option>
                        <option value="templates">Templates</option>
                        <option value="algorithms">Algorithms</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-slate-300 font-medium">Content / Code Snippet</label>
                      <textarea required value={noteContent} onChange={e => setNoteContent(e.target.value)} className="bg-slate-950 border border-white/10 outline-none rounded-lg p-2 min-h-[90px] font-mono text-[11px] text-slate-200" placeholder="Describe the error, notes or paste snippet..." />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-slate-300 font-medium">Tags (comma separated)</label>
                      <input type="text" value={noteTags} onChange={e => setNoteTags(e.target.value)} className="bg-slate-950 border border-white/10 outline-none rounded-lg p-2 text-white" placeholder="graphs, dp, mistakes" />
                    </div>

                    <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-4 rounded-xl mt-2 transition-all">Save Note</button>
                  </form>
                </div>

                {/* Notes List & Filter sidebar */}
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2 flex flex-col gap-4">
                  <div className="flex justify-between items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-[200px] relative">
                      <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
                      <input type="text" value={noteSearch} onChange={e => setNoteSearch(e.target.value)} className="w-full bg-slate-950 border border-white/10 outline-none rounded-xl pl-9 pr-4 py-2 text-xs text-white" placeholder="Search notes..." />
                    </div>
                    {/* Tag filter selector */}
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setSelectedTag(null)} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border transition-all ${!selectedTag ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-transparent border-white/5 text-slate-400'}`}>All</button>
                      {allNoteTags.map((tag, idx) => (
                        <button key={idx} onClick={() => setSelectedTag(tag)} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border transition-all ${selectedTag === tag ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-transparent border-white/5 text-slate-400'}`}>{tag}</button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 overflow-y-auto max-h-[380px] pr-2">
                    {filteredNotes.length === 0 ? (
                      <div className="text-center py-12 text-slate-500 text-xs">No matching notes found in knowledge base.</div>
                    ) : (
                      filteredNotes.map(n => (
                        <div key={n.id} className="p-4 bg-slate-900/60 rounded-xl border border-white/5 flex flex-col justify-between gap-3 text-left">
                          <div>
                            <div className="flex justify-between items-center">
                              <span className="text-[8px] bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 font-bold px-1.5 py-0.5 rounded uppercase font-mono">{n.category}</span>
                              <button onClick={() => handleDeleteNote(n.id)} className="text-slate-500 hover:text-rose-400 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                            <h4 className="text-sm font-bold text-white mt-1">{n.title}</h4>
                            <p className="text-xs text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap font-mono bg-slate-950/40 p-2.5 rounded-lg border border-white/5">{n.content}</p>
                          </div>
                          <div className="flex justify-between items-center text-[9px] text-slate-500 border-t border-white/5 pt-2">
                            <span>Logged: {new Date(n.createdAt).toLocaleDateString()}</span>
                            <div className="flex gap-1">
                              {n.tags.map((t, idx) => <span key={idx} className="bg-white/5 border border-white/5 text-slate-400 px-1.5 py-0.5 rounded">#{t}</span>)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: SETTINGS & FUTURE AI COACH ARCHITECTURE */}
          {activeTab === 'settings' && (
            <div className="flex flex-col gap-6 max-w-xl animate-slide-up">
              {/* API and General strictness configurations */}
              <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                <h3 className="text-sm font-bold text-white">Focus Objectives</h3>
                <textarea
                  value={onboarding.goals}
                  onChange={async (e) => {
                    const updated = { ...onboarding, goals: e.target.value };
                    setOnboarding(updated);
                    await saveAppState({ onboarding: updated });
                  }}
                  className="w-full bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl p-4 text-xs font-medium text-slate-200 min-h-[90px] transition-all"
                  placeholder="Define your general study targets..."
                />
              </div>

              {/* Gemini configuration */}
              <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Zap className="h-4.5 w-4.5 text-indigo-400" />
                  Distraction Detection Engine
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={async () => {
                      setAnalyzerMode('rule');
                      await chrome.storage.local.set({ analyzerMode: 'rule' });
                    }}
                    className={`p-4 rounded-xl border text-xs font-semibold text-center transition-all ${
                      analyzerMode === 'rule' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-white/5 hover:border-white/10 text-slate-400'
                    }`}
                  >
                    Rule-Based Engine
                  </button>
                  <button
                    onClick={async () => {
                      setAnalyzerMode('ai');
                      await chrome.storage.local.set({ analyzerMode: 'ai' });
                    }}
                    className={`p-4 rounded-xl border text-xs font-semibold text-center transition-all ${
                      analyzerMode === 'ai' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-white/5 hover:border-white/10 text-slate-400'
                    }`}
                  >
                    Gemini AI Engine
                  </button>
                </div>

                {analyzerMode === 'ai' && (
                  <div className="flex flex-col gap-2 mt-2 pt-4 border-t border-white/5 animate-scale-in text-left">
                    <label className="text-xs font-bold text-slate-300">Custom Gemini API Key</label>
                    <div className="flex gap-3">
                      <input type="password" value={customApiKey} onChange={e => setCustomApiKey(e.target.value)} className="flex-1 bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2 text-xs text-slate-200 font-mono" placeholder="••••••••••••" />
                      <button
                        onClick={async () => {
                          await chrome.storage.local.set({ geminiApiKey: customApiKey });
                          alert('API Key updated successfully!');
                        }}
                        className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-300 hover:text-white font-semibold text-xs px-5 rounded-xl border border-indigo-500/20 transition-all"
                      >
                        Save Key
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Password Config */}
              <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  {passwordHash ? <Lock className="h-4.5 w-4.5 text-indigo-400" /> : <Unlock className="h-4.5 w-4.5 text-slate-400" />}
                  Strict Mode Password Protection
                </h3>
                <div className="flex gap-3">
                  <input type="password" id="setting-pass" className="flex-1 bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2 text-xs text-slate-200 font-mono" placeholder={passwordHash ? "Enter new password to change" : "Enter a protection password"} />
                  <button
                    onClick={async () => {
                      const inputEl = document.getElementById('setting-pass') as HTMLInputElement;
                      if (inputEl) {
                        const val = inputEl.value.trim();
                        if (val.length === 0) {
                          setPasswordHash(undefined);
                          await saveAppState({ passwordHash: undefined });
                          alert('Password cleared!');
                        } else {
                          const newHash = await hashPassword(val);
                          setPasswordHash(newHash);
                          await saveAppState({ passwordHash: newHash });
                          alert('Password set!');
                        }
                        inputEl.value = '';
                      }
                    }}
                    className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-300 hover:text-white font-semibold text-xs px-5 rounded-xl border border-indigo-500/20 transition-all"
                  >
                    Apply Password
                  </button>
                </div>
              </div>

              {/* Visual Architecture Chart for Future AI Coach */}
              <div className="glass rounded-2xl p-6 border-white/5 text-left flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Future AI Coach Architecture</h3>
                  <p className="text-[10px] text-slate-400">Roadmap architectural flow designed to support modular AI entities.</p>
                </div>
                <div className="bg-slate-900/60 p-4 rounded-xl border border-white/5 text-xs text-slate-300 font-mono flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold">[User Profiles] + [Study Logs]</div>
                  <div className="pl-4 border-l border-white/10 text-slate-400">↳ API Fetchers / Scrapers</div>
                  <div className="pl-4 border-l border-white/10 text-indigo-300">↳ RAG Knowledge Base (Vector Embeddings)</div>
                  <div className="pl-4 border-l border-white/10 text-slate-400">↳ Local LLMs & Cloud APIs (GPT / Gemini Model Handoff)</div>
                  <div className="pl-4 border-l border-white/10 text-pink-400">↳ Coach Engine Decision Router (Schedule, Recommender, Voice Assistant)</div>
                  <div className="pl-4 border-l border-white/10 text-emerald-400">↳ Team Study Rooms & Mobile Sync Services</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 3. Schedule Creator / Editor Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg glass rounded-2xl border border-white/10 p-7 text-white animate-scale-in max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => {
                setShowScheduleModal(false);
                setEditingSchedule(null);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              {editingSchedule ? <Edit3 className="h-5 w-5 text-indigo-400" /> : <Plus className="h-5 w-5 text-indigo-400" />}
              {editingSchedule ? 'Edit Study Slot' : 'Add Study Slot'}
            </h3>
            <p className="text-[10px] text-slate-400 mb-6">Set time ranges and target study resources for restriction enforcement.</p>

            <form onSubmit={handleSaveSchedule} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">Task Title</label>
                <input
                  type="text"
                  required
                  value={scheduleForm.title}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                  className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200"
                  placeholder="e.g. Graph Theory, Solve LeetCode Problems"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">Description (Optional)</label>
                <input
                  type="text"
                  value={scheduleForm.description}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, description: e.target.value })}
                  className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200"
                  placeholder="e.g. Read Chapter 5 of algorithm book and work on practice set"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-300">Start Time</label>
                  <input
                    type="time"
                    required
                    value={scheduleForm.startTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })}
                    className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-300">End Time</label>
                  <input
                    type="time"
                    required
                    value={scheduleForm.endTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })}
                    className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">Target Study Resource URL</label>
                <input
                  type="url"
                  required
                  value={scheduleForm.targetUrl}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, targetUrl: e.target.value })}
                  className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                  placeholder="https://leetcode.com/problemset"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">Allowed Study Domains</label>
                <input
                  type="text"
                  value={scheduleForm.allowedDomains}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, allowedDomains: e.target.value })}
                  className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                  placeholder="leetcode.com, youtube.com, github.com"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 mt-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1">
                    <Shield className="h-4 w-4 text-rose-400" />
                    Enforce Strict Mode
                  </span>
                  <span className="text-[9px] text-slate-400">
                    Disables 'Ignore' controls. Requires password verification to clear warnings.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={scheduleForm.strictMode}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, strictMode: e.target.checked })}
                  className="w-4.5 h-4.5 accent-indigo-500"
                />
              </div>

              <div className="flex flex-col gap-1.5 mt-2">
                <div className="flex justify-between text-xs font-bold text-slate-300">
                  <span>Distraction warning threshold</span>
                  <span className="font-mono text-indigo-400">{scheduleForm.warningThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="80"
                  value={scheduleForm.warningThreshold}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, warningThreshold: parseInt(e.target.value) })}
                  className="w-full accent-indigo-500 bg-slate-800"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-semibold py-3 px-4 rounded-xl shadow-lg mt-4 transition-all"
              >
                Save Schedule
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Password Unlock Verification Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm glass rounded-2xl border border-rose-500/20 p-6 text-white animate-scale-in text-center relative">
            <button
              onClick={() => {
                setShowPasswordModal(false);
                setPasswordInput('');
                setPasswordError('');
                setPendingAction(null);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mx-auto w-12 h-12 bg-rose-500/10 rounded-full flex items-center justify-center mb-4 border border-rose-500/25">
              <Lock className="h-5.5 w-5.5 text-rose-500" />
            </div>

            <h3 className="text-base font-bold text-white mb-1">Strict Action Blocked</h3>
            <p className="text-xs text-slate-400 mb-5 leading-normal">
              Enter your FocusFlow administrator password to verify credentials and unlock schedule modifications.
            </p>

            <div className="flex flex-col gap-3.5">
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                className="w-full bg-slate-950 border border-white/15 focus:border-rose-500 outline-none rounded-xl px-4 py-2.5 text-center text-xs text-slate-200 font-mono tracking-widest"
                placeholder="••••••••••••"
                autoFocus
              />

              {passwordError && (
                <div className="text-[10px] text-rose-400 font-medium">{passwordError}</div>
              )}

              <button
                onClick={verifyPassword}
                className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2.5 px-4 rounded-xl shadow-md transition-all active:scale-[0.98]"
              >
                Authenticate & Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Setup Wizard Onboarding Overlay */}
      {!onboarding.completed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden bg-mesh">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-xl glass rounded-2xl border border-white/10 p-8 md:p-10 text-white animate-scale-in shadow-2xl flex flex-col justify-between min-h-[500px] relative">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Onboarding Setup</span>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((step) => (
                  <div key={step} className={`h-1.5 w-8 rounded-full transition-all ${step <= wizardStep ? 'bg-indigo-500' : 'bg-slate-800'}`} />
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              {wizardStep === 1 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Define Your Study Goals</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    What are you working towards? Focusing starts with clear intentions. FocusFlow acts as your accountability partner, keeping your goal in sight whenever you stray.
                  </p>
                  <textarea
                    required
                    value={wizardForm.goals}
                    onChange={(e) => setWizardForm({ ...wizardForm, goals: e.target.value })}
                    className="w-full bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl p-4 text-xs font-medium text-slate-200 min-h-[140px] mt-2 transition-all"
                    placeholder="Enter your current objectives (e.g. Master algorithms, learn react architecture, build tapsacode, solve 100 leetcode issues...)"
                  />
                </div>
              )}

              {wizardStep === 2 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Schedule Your First Session</h2>
                  <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                    Set up your first block of focused study. Unlisted sites will be evaluated relative to this task.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Study Task Title</label>
                      <input type="text" value={wizardForm.scheduleTitle} onChange={(e) => setWizardForm({ ...wizardForm, scheduleTitle: e.target.value })} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200" placeholder="e.g. Learn Graph Theory" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Target Study URL</label>
                      <input type="url" value={wizardForm.scheduleTarget} onChange={(e) => setWizardForm({ ...wizardForm, scheduleTarget: e.target.value })} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200" placeholder="e.g. https://leetcode.com" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Start Time</label>
                      <input type="time" value={wizardForm.scheduleStart} onChange={(e) => setWizardForm({ ...wizardForm, scheduleStart: e.target.value })} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">End Time</label>
                      <input type="time" value={wizardForm.scheduleEnd} onChange={(e) => setWizardForm({ ...wizardForm, scheduleEnd: e.target.value })} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Allowed Reference Domains</label>
                    <input type="text" value={wizardForm.scheduleAllowed} onChange={(e) => setWizardForm({ ...wizardForm, scheduleAllowed: e.target.value })} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono" placeholder="leetcode.com, youtube.com" />
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Choose Study Strictness</h2>
                  <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                    Select how strict FocusFlow will enforce distraction checks on unlisted sites.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button type="button" onClick={() => setWizardForm({ ...wizardForm, strictness: 'low' })} className={`glass text-left p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[140px] ${wizardForm.strictness === 'low' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 hover:border-white/10'}`}>
                      <div>
                        <span className="text-xs font-bold text-white">Low</span>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">Warnings are displayed, but you can ignore distractions. Good for casual learning sessions.</p>
                      </div>
                      <span className="text-[9px] text-indigo-400 font-bold uppercase mt-4">Warning banner only</span>
                    </button>

                    <button type="button" onClick={() => setWizardForm({ ...wizardForm, strictness: 'medium' })} className={`glass text-left p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[140px] ${wizardForm.strictness === 'medium' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 hover:border-white/10'}`}>
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1">Medium<span className="h-1.5 w-1.5 rounded-full bg-indigo-400" /></span>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">Tracks warnings. Repeated distractions (3 attempts) force a redirect back to study resources.</p>
                      </div>
                      <span className="text-[9px] text-indigo-400 font-bold uppercase mt-4">Warn & Redirect</span>
                    </button>

                    <button type="button" onClick={() => setWizardForm({ ...wizardForm, strictness: 'strict' })} className={`glass text-left p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[140px] ${wizardForm.strictness === 'strict' ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 hover:border-white/10'}`}>
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1.5 font-bold text-rose-400">Strict<span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" /></span>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">No 'Ignore' button allowed on distractions. Redirects are active, and lock passwords protect settings.</p>
                      </div>
                      <span className="text-[9px] text-rose-400 font-bold uppercase mt-4">No Ignore Button + Lock</span>
                    </button>
                  </div>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Create Protection Password</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Protect strict sessions from self-sabotage. Setting a password will lock modifications to schedules while focus limits are active.
                  </p>
                  <div className="flex flex-col gap-1.5 mt-2">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Lock Password</label>
                    <input type="password" value={wizardForm.password} onChange={(e) => setWizardForm({ ...wizardForm, password: e.target.value })} className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-3 text-xs text-slate-200 font-mono tracking-widest text-center" placeholder="Leave blank for no password" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center mt-8 pt-6 border-t border-white/5 shrink-0 text-xs">
              <button type="button" onClick={() => setWizardStep(prev => Math.max(1, prev - 1))} disabled={wizardStep === 1} className="text-slate-400 hover:text-white px-4 py-2 disabled:opacity-30 disabled:pointer-events-none transition-all">Back</button>
              {wizardStep < 4 ? (
                <button type="button" onClick={() => {
                  if (wizardStep === 1 && wizardForm.goals.trim().length === 0) {
                    alert('Please specify your study goals.');
                    return;
                  }
                  setWizardStep(prev => prev + 1);
                }} className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-2 rounded-xl">Continue</button>
              ) : (
                <button type="button" onClick={handleWizardSubmit} className="bg-gradient-to-r from-indigo-500 to-pink-500 text-white font-semibold px-8 py-2.5 rounded-xl shadow-xl transition-all">Complete Setup & Launch</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
