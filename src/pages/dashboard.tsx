import React, { useState, useEffect } from 'react';
import { Schedule, FocusAnalytics, BreakState, OnboardingState } from '../types';
import { getAppState, saveAppState, subscribeToKey, getStorageItem } from '../storage/chromeStorage';
import { getCurrentTask, getRemainingSeconds, formatRemainingTime, formatTimeSlot, isTaskActiveNow } from '../utils/time';
import { 
  Zap, Calendar, BarChart2, Shield, Settings2, Plus, 
  Trash2, Edit3, ArrowUp, ArrowDown, X, Lock, 
  Unlock, Flame, Award, ShieldAlert, BookOpen, Coffee, ExternalLink
} from 'lucide-react';

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

  // Active UI tab
  const [activeTab, setActiveTab] = useState<'dashboard' | 'planner' | 'settings'>('dashboard');

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

  // Load and subscribe to state
  useEffect(() => {
    async function loadState() {
      const state = await getAppState();
      setSchedules(state.schedules);
      setBreakState(state.breakState);
      setAnalytics(state.analytics);
      setOnboarding(state.onboarding);
      setPasswordHash(state.passwordHash);

      const mode = await getStorageItem<'rule' | 'ai'>('analyzerMode', 'rule');
      const customKey = await getStorageItem<string>('geminiApiKey', '');
      setAnalyzerMode(mode);
      setCustomApiKey(customKey);

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

    return () => {
      unsubSchedules();
      unsubBreak();
      unsubAnalytics();
      unsubOnboarding();
      unsubMode();
      unsubKey();
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

  // Check if a strict schedule is active
  const isStrictActive = activeTask?.strictMode;

  // Move a schedule slot up or down (Reordering)
  const reorderSchedule = async (index: number, direction: 'up' | 'down') => {
    const isStrictRunning = schedules.some((s) => s.strictMode && getCurrentTask([s]));
    if (isStrictRunning && passwordHash) {
      // Prompt for password if any strict schedule is currently active
      setPendingAction({ type: 'disable-strict' });
      setShowPasswordModal(true);
      return;
    }

    const newSchedules = [...schedules];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newSchedules.length) return;

    // Swap
    const temp = newSchedules[index];
    newSchedules[index] = newSchedules[targetIdx];
    newSchedules[targetIdx] = temp;

    setSchedules(newSchedules);
    await saveAppState({ schedules: newSchedules });
  };

  // Trigger quick break
  const triggerQuickBreak = (mins: number) => {
    chrome.runtime.sendMessage({ type: 'START_BREAK', durationMinutes: mins });
  };

  const endQuickBreak = () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_BREAK' });
  };

  // Open Edit Schedule modal (safeguarded by password if strict)
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

  // Open Delete Schedule verification (safeguarded by password if strict)
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

  // Verify management password
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

  // Save Schedule form
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const domains = scheduleForm.allowedDomains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    const formattedTarget = scheduleForm.targetUrl.trim();

    if (editingSchedule) {
      // Modify
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
      // Create new
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

  // Onboarding wizard triggers
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

  // SVG Chart Calculations
  const renderFocusScoreChart = () => {
    const history = analytics.focusScoreHistory;
    if (history.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-slate-500 text-xs">
          No focus data available yet. Keep study sessions active to draw chart logs.
        </div>
      );
    }

    // Chart dimensions
    const width = 500;
    const height = 180;
    const padding = 35;

    // Find min/max values
    const maxScore = 100;
    const minScore = 0;

    const getX = (idx: number) => {
      if (history.length <= 1) return padding + (width - padding * 2) / 2;
      return padding + (idx / (history.length - 1)) * (width - padding * 2);
    };

    const getY = (score: number) => {
      return height - padding - ((score - minScore) / (maxScore - minScore)) * (height - padding * 2);
    };

    // Construct SVG path points
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

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((level, i) => {
          const y = getY(level);
          return (
            <g key={i}>
              <line 
                x1={padding} 
                y1={y} 
                x2={width - padding} 
                y2={y} 
                stroke="rgba(255,255,255,0.05)" 
                strokeWidth="1" 
                strokeDasharray="4"
              />
              <text 
                x={padding - 10} 
                y={y + 4} 
                fill="#64748b" 
                fontSize="9" 
                textAnchor="end"
                className="font-mono"
              >
                {level}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        {history.length > 1 && (
          <polygon points={areaPoints} fill="url(#scoreGlow)" />
        )}

        {/* Line */}
        {history.length > 1 && (
          <polyline 
            points={points} 
            fill="none" 
            stroke="#6366f1" 
            strokeWidth="3" 
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Value nodes */}
        {history.map((h, i) => (
          <g key={i} className="group">
            <circle 
              cx={getX(i)} 
              cy={getY(h.score)} 
              r="4" 
              className="fill-indigo-400 stroke-slate-900 stroke-2 hover:r-6 cursor-pointer transition-all"
            />
            {/* Tooltip */}
            <title>{`${h.date}: ${h.score}% Focus`}</title>
          </g>
        ))}

        {/* Date labels */}
        {history.map((h, i) => {
          // Render only first, middle, last to avoid crowding
          const shouldRender = i === 0 || i === history.length - 1 || (history.length > 5 && i === Math.floor(history.length / 2));
          if (!shouldRender) return null;
          return (
            <text
              key={i}
              x={getX(i)}
              y={height - 10}
              fill="#64748b"
              fontSize="9"
              textAnchor="middle"
              className="font-mono"
            >
              {h.date.substring(5)} {/* MM-DD */}
            </text>
          );
        })}
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 bg-mesh flex relative overflow-hidden">
      {/* 1. Sidebar */}
      <aside className="w-64 bg-slate-900/60 border-r border-white/5 backdrop-blur-xl flex flex-col justify-between shrink-0 z-10">
        <div>
          {/* Sidebar Header */}
          <div className="flex items-center gap-3 px-6 py-6 border-b border-white/5 bg-slate-950/20">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="h-5.5 w-5.5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white">FocusFlow</h1>
              <span className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Pro Dashboard</span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="p-4 flex flex-col gap-1.5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <BarChart2 className="h-4.5 w-4.5" />
              Overview & Analytics
            </button>

            <button
              onClick={() => setActiveTab('planner')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'planner'
                  ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Calendar className="h-4.5 w-4.5" />
              Schedule Planner
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
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
        <div className="p-4 border-t border-white/5 bg-slate-950/20">
          <div className="flex items-center gap-3 px-3 py-2 bg-white/5 rounded-xl border border-white/5">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-300 font-medium">Protection Status Active</span>
          </div>
        </div>
      </aside>

      {/* 2. Main content container */}
      <main className="flex-1 min-w-0 flex flex-col z-0 overflow-y-auto">
        <header className="px-8 py-5 border-b border-white/5 bg-slate-900/10 backdrop-blur-sm flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">
              {activeTab === 'dashboard' && 'Analytics Overview'}
              {activeTab === 'planner' && 'Study Schedule Planner'}
              {activeTab === 'settings' && 'Extension Settings'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeTab === 'dashboard' && "Track focus hours, streaks, and distraction patterns."}
              {activeTab === 'planner' && 'Plan study tasks and customize resource restrictions.'}
              {activeTab === 'settings' && 'Configure custom parameters, strict mode passwords, and goals.'}
            </p>
          </div>

          {/* Quick Stats in top bar */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500 animate-bounce" />
              <div className="text-right">
                <div className="text-sm font-bold text-white leading-tight">{analytics.dailyStreak} Days</div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Daily Streak</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-indigo-400" />
              <div className="text-right">
                <div className="text-sm font-bold text-white leading-tight">{analytics.weeklyStreak} Weeks</div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Weekly Streak</div>
              </div>
            </div>
          </div>
        </header>

        {/* Tab contents */}
        <div className="flex-1 p-8 overflow-y-auto">
          {/* TAB 1: OVERVIEW & ANALYTICS */}
          {activeTab === 'dashboard' && (
            <div className="flex flex-col gap-8 animate-slide-up">
              {/* Active Task / Break Banner */}
              {breakState.inBreak ? (
                <div className="glass rounded-2xl p-6 border-indigo-500/20 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
                  <div className="flex items-center gap-4.5">
                    <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/25">
                      <Coffee className="h-7 w-7 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        Break Active
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-md">FocusFlow enforcement is currently paused. Use this time to rest and re-energize.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5">
                    <div className="text-center font-mono text-2xl font-extrabold text-indigo-400 tracking-wider">
                      {formatRemainingTime(breakSecondsLeft)}
                    </div>
                    <button
                      onClick={endQuickBreak}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2.5 px-5 rounded-xl shadow-lg transition-all"
                    >
                      Resume Study Session
                    </button>
                  </div>
                </div>
              ) : activeTask ? (
                <div className="glass rounded-2xl p-6 border-indigo-500/15 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/10 rounded-full blur-xl pointer-events-none" />
                  <div className="flex items-center gap-4.5">
                    <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/25">
                      <BookOpen className="h-7 w-7 text-indigo-400" />
                    </div>
                    <div>
                      <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">Currently Focused Task</span>
                      <h3 className="text-lg font-bold text-white mt-0.5">{activeTask.title}</h3>
                      {activeTask.description && <p className="text-xs text-slate-400 mt-1 line-clamp-1">{activeTask.description}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-0.5">Remaining Time</div>
                      <div className="font-mono text-2xl font-extrabold text-white tracking-widest bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-400">
                        {formatRemainingTime(secondsLeft)}
                      </div>
                    </div>
                    
                    <a
                      href={activeTask.targetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2.5 px-5 rounded-xl shadow-lg flex items-center gap-1.5 transition-all"
                    >
                      Go to Resource
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4.5">
                    <div className="p-3 bg-white/5 rounded-2xl border border-white/5">
                      <Zap className="h-7 w-7 text-slate-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-300">No Scheduled Task Running</h3>
                      <p className="text-xs text-slate-400 mt-1 max-w-md">FocusFlow is waiting. Fill out your schedule calendar inside the planner to start blocking distractions.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('planner')}
                    className="bg-white/5 hover:bg-white/10 text-white font-semibold text-xs py-2.5 px-6 rounded-xl border border-white/5 transition-all"
                  >
                    Open Daily Planner
                  </button>
                </div>
              )}

              {/* Main metrics grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between min-h-[110px]">
                  <span className="text-xs text-slate-400 font-medium">Accumulated Study Hours</span>
                  <div className="text-3xl font-extrabold text-white mt-2 leading-none">
                    {analytics.focusHours.toFixed(1)} hrs
                  </div>
                  <span className="text-[10px] text-indigo-400 font-medium mt-1">Direct task-focused time</span>
                </div>

                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between min-h-[110px]">
                  <span className="text-xs text-slate-400 font-medium">Distraction Intercepts</span>
                  <div className="text-3xl font-extrabold text-white mt-2 leading-none">
                    {analytics.distractionAttempts}
                  </div>
                  <span className="text-[10px] text-pink-400 font-medium mt-1">Browsing attempts blocked</span>
                </div>

                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between min-h-[110px]">
                  <span className="text-xs text-slate-400 font-medium">Strict Redirections</span>
                  <div className="text-3xl font-extrabold text-white mt-2 leading-none">
                    {analytics.redirectCount}
                  </div>
                  <span className="text-[10px] text-rose-400 font-medium mt-1">Automatic study resets triggered</span>
                </div>

                <div className="glass rounded-2xl p-5 border-white/5 flex flex-col justify-between min-h-[110px]">
                  <span className="text-xs text-slate-400 font-medium">Active Focus Streak</span>
                  <div className="text-3xl font-extrabold text-white mt-2 leading-none flex items-center gap-1.5">
                    {analytics.dailyStreak}
                    <Flame className="h-6 w-6 text-amber-500 fill-amber-500/10" />
                  </div>
                  <span className="text-[10px] text-emerald-400 font-medium mt-1">Consecutive days focused</span>
                </div>
              </div>

              {/* Focus Scores SVG Line Chart */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass rounded-2xl p-6 border-white/5 md:col-span-2 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">Daily Focus Score History</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Calculated score evaluating distraction rate during active schedules.</p>
                  </div>
                  <div className="h-52 w-full mt-4 flex justify-center">
                    {renderFocusScoreChart()}
                  </div>
                </div>

                {/* Quick Breaks Control Panel */}
                <div className="glass rounded-2xl p-6 border-white/5 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">Study Break Controller</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Start temporary pauses to stretch, drink water, or rest.</p>
                  </div>
                  
                  <div className="flex flex-col gap-3 my-4">
                    <button
                      onClick={() => triggerQuickBreak(5)}
                      disabled={breakState.inBreak}
                      className="w-full bg-white/5 hover:bg-white/10 text-slate-200 border border-white/5 font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-between transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <Coffee className="h-4 w-4 text-indigo-400" />
                        Quick Recharge Break
                      </span>
                      <span>5 Mins</span>
                    </button>
                    
                    <button
                      onClick={() => triggerQuickBreak(15)}
                      disabled={breakState.inBreak}
                      className="w-full bg-white/5 hover:bg-white/10 text-slate-200 border border-white/5 font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-between transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <Coffee className="h-4 w-4 text-indigo-400" />
                        Standard Refresh Break
                      </span>
                      <span>15 Mins</span>
                    </button>
                  </div>

                  <div className="p-3 bg-slate-900/40 rounded-xl border border-white/5 text-[10px] text-slate-400 leading-relaxed">
                    <strong>Note:</strong> In Strict Mode, starting a break is disabled once a schedule overlay blocks you. Take breaks in-between study blocks!
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SCHEDULE PLANNER */}
          {activeTab === 'planner' && (
            <div className="flex flex-col gap-6 animate-slide-up">
              {/* List Actions */}
              <div className="flex justify-between items-center bg-slate-900/20 p-4 rounded-xl border border-white/5">
                <span className="text-xs text-slate-400 font-semibold">{schedules.length} Study Slots Planned</span>
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
                        {/* Left edge indicator */}
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${
                          isActive ? 'bg-indigo-500' : 'bg-slate-800'
                        }`} />

                        {/* Title & Info */}
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

                        {/* Controls */}
                        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto border-t md:border-t-0 pt-4 md:pt-0 w-full md:w-auto justify-end">
                          {/* Reordering actions */}
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

          {/* TAB 3: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="flex flex-col gap-6 max-w-xl animate-slide-up">
              {/* Study Goals */}
              <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Focus Objectives</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Your core motivation, logged during onboarding, keeps you accountable.</p>
                </div>
                <textarea
                  value={onboarding.goals}
                  onChange={async (e) => {
                    const updated = { ...onboarding, goals: e.target.value };
                    setOnboarding(updated);
                    await saveAppState({ onboarding: updated });
                  }}
                  className="w-full bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl p-4 text-xs font-medium text-slate-200 min-h-[90px] transition-all"
                  placeholder="Define your daily goals, e.g., study graph structures, finish Leetcode assignments..."
                />
              </div>

              {/* Gemini AI Relevance Settings */}
              <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4 animate-slide-up">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Zap className="h-4.5 w-4.5 text-indigo-400" />
                    Distraction Detection Engine
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Choose the evaluation engine used by FocusFlow to check website relevance.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={async () => {
                      setAnalyzerMode('rule');
                      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        await chrome.storage.local.set({ analyzerMode: 'rule' });
                      } else {
                        localStorage.setItem('analyzerMode', 'rule');
                      }
                    }}
                    className={`p-4 rounded-xl border text-xs font-semibold text-center transition-all ${
                      analyzerMode === 'rule'
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                        : 'border-white/5 hover:border-white/10 text-slate-400'
                    }`}
                  >
                    Rule-Based Engine (Default)
                  </button>

                  <button
                    onClick={async () => {
                      setAnalyzerMode('ai');
                      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        await chrome.storage.local.set({ analyzerMode: 'ai' });
                      } else {
                        localStorage.setItem('analyzerMode', 'ai');
                      }
                    }}
                    className={`p-4 rounded-xl border text-xs font-semibold text-center transition-all ${
                      analyzerMode === 'ai'
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                        : 'border-white/5 hover:border-white/10 text-slate-400'
                    }`}
                  >
                    Gemini AI Engine
                  </button>
                </div>

                {analyzerMode === 'ai' && (
                  <div className="flex flex-col gap-2 mt-2 pt-4 border-t border-white/5 animate-scale-in text-left">
                    <label className="text-xs font-bold text-slate-300">Custom Gemini API Key</label>
                    <div className="flex gap-3">
                      <input
                        type="password"
                        value={customApiKey}
                        onChange={(e) => setCustomApiKey(e.target.value)}
                        className="flex-1 bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                        placeholder="•••••••••••• (Default key active)"
                      />
                      <button
                        onClick={async () => {
                          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            await chrome.storage.local.set({ geminiApiKey: customApiKey });
                          } else {
                            localStorage.setItem('geminiApiKey', customApiKey);
                          }
                          alert('API Key updated successfully!');
                        }}
                        className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-300 hover:text-white font-semibold text-xs px-5 rounded-xl border border-indigo-500/20 hover:border-indigo-500/0 transition-all"
                      >
                        Save Key
                      </button>
                    </div>
                    <span className="text-[9px] text-slate-500 leading-normal">
                      Defaults to the provided system API key. Powered by the <strong>gemini-2.5-flash</strong> model.
                    </span>
                  </div>
                )}
              </div>

              {/* Password Config */}
              <div className="glass rounded-2xl p-6 border-white/5 flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    {passwordHash ? <Lock className="h-4.5 w-4.5 text-indigo-400" /> : <Unlock className="h-4.5 w-4.5 text-slate-400" />}
                    Strict Mode Password Protection
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Requires verification before editing/deleting strict tasks. Leaving password blank leaves it unlocked.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <input
                      type="password"
                      id="setting-pass"
                      className="flex-1 bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 transition-all font-mono"
                      placeholder={passwordHash ? "Enter new password to change" : "Enter a protection password"}
                    />
                    <button
                      onClick={async () => {
                        const inputEl = document.getElementById('setting-pass') as HTMLInputElement;
                        if (inputEl) {
                          const val = inputEl.value.trim();
                          if (val.length === 0) {
                            setPasswordHash(undefined);
                            await saveAppState({ passwordHash: undefined });
                            alert('Password cleared successfully!');
                          } else {
                            const newHash = await hashPassword(val);
                            setPasswordHash(newHash);
                            await saveAppState({ passwordHash: newHash });
                            alert('Password set successfully!');
                          }
                          inputEl.value = '';
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-50 text-indigo-600 hover:text-white bg-indigo-500/10 hover:bg-indigo-500 text-indigo-300 font-semibold text-xs px-5 rounded-xl border border-indigo-500/20 hover:border-indigo-500/0 transition-all"
                    >
                      Apply Password
                    </button>
                  </div>
                </div>
              </div>

              {/* Strict Mode Notice */}
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 leading-relaxed">
                  <strong className="text-white block mb-0.5">Notice on Strict Mode Locks:</strong>
                  If a Strict task is currently running, FocusFlow blocks all schedules reordering, modifications, and dashboard configuration settings until either the session ends or you verify your protection password. This stops quick self-sabotaging edits!
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
                <span className="text-[9px] text-slate-500 leading-normal">
                  List host domains allowed for reference research, separated by commas. (e.g. stackoverflow.com)
                </span>
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
                <span className="text-[9px] text-slate-500 leading-normal">
                  Higher threshold is stricter, requiring stronger keyword alignments on unlisted sites.
                </span>
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
          {/* Glowing backdrops */}
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-xl glass rounded-2xl border border-white/10 p-8 md:p-10 text-white animate-scale-in shadow-2xl flex flex-col justify-between min-h-[500px] relative">
            
            {/* Step progress indicators */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-indigo-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Onboarding Setup</span>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((step) => (
                  <div 
                    key={step} 
                    className={`h-1.5 w-8 rounded-full transition-all ${
                      step <= wizardStep ? 'bg-indigo-500' : 'bg-slate-800'
                    }`} 
                  />
                ))}
              </div>
            </div>

            {/* Step Content */}
            <div className="flex-1 flex flex-col justify-center">
              {/* STEP 1: Enter Goals */}
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

              {/* STEP 2: Create First Schedule */}
              {wizardStep === 2 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Schedule Your First Session</h2>
                  <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                    Set up your first block of focused study. Unlisted sites will be evaluated relative to this task.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Study Task Title</label>
                      <input
                        type="text"
                        value={wizardForm.scheduleTitle}
                        onChange={(e) => setWizardForm({ ...wizardForm, scheduleTitle: e.target.value })}
                        className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200"
                        placeholder="e.g. Learn Graph Theory"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Target Study URL</label>
                      <input
                        type="url"
                        value={wizardForm.scheduleTarget}
                        onChange={(e) => setWizardForm({ ...wizardForm, scheduleTarget: e.target.value })}
                        className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200"
                        placeholder="e.g. https://leetcode.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Start Time</label>
                      <input
                        type="time"
                        value={wizardForm.scheduleStart}
                        onChange={(e) => setWizardForm({ ...wizardForm, scheduleStart: e.target.value })}
                        className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase text-slate-400">End Time</label>
                      <input
                        type="time"
                        value={wizardForm.scheduleEnd}
                        onChange={(e) => setWizardForm({ ...wizardForm, scheduleEnd: e.target.value })}
                        className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Allowed Reference Domains</label>
                    <input
                      type="text"
                      value={wizardForm.scheduleAllowed}
                      onChange={(e) => setWizardForm({ ...wizardForm, scheduleAllowed: e.target.value })}
                      className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-2.5 text-xs text-slate-200 font-mono"
                      placeholder="leetcode.com, youtube.com"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: Choose Strictness */}
              {wizardStep === 3 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Choose Study Strictness</h2>
                  <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                    Select how strict FocusFlow will enforce distraction checks on unlisted sites.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Low */}
                    <button
                      type="button"
                      onClick={() => setWizardForm({ ...wizardForm, strictness: 'low' })}
                      className={`glass text-left p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[140px] ${
                        wizardForm.strictness === 'low' 
                          ? 'border-indigo-500 bg-indigo-500/10' 
                          : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div>
                        <span className="text-xs font-bold text-white">Low</span>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                          Warnings are displayed, but you can ignore distractions. Good for casual learning sessions.
                        </p>
                      </div>
                      <span className="text-[9px] text-indigo-400 font-bold uppercase mt-4">Warning banner only</span>
                    </button>

                    {/* Medium */}
                    <button
                      type="button"
                      onClick={() => setWizardForm({ ...wizardForm, strictness: 'medium' })}
                      className={`glass text-left p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[140px] ${
                        wizardForm.strictness === 'medium' 
                          ? 'border-indigo-500 bg-indigo-500/10' 
                          : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1">
                          Medium
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        </span>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                          Tracks warnings. Repeated distractions (3 attempts) force a redirect back to study resources.
                        </p>
                      </div>
                      <span className="text-[9px] text-indigo-400 font-bold uppercase mt-4">Warn & Redirect</span>
                    </button>

                    {/* Strict */}
                    <button
                      type="button"
                      onClick={() => setWizardForm({ ...wizardForm, strictness: 'strict' })}
                      className={`glass text-left p-5 rounded-2xl border transition-all flex flex-col justify-between min-h-[140px] ${
                        wizardForm.strictness === 'strict' 
                          ? 'border-indigo-500 bg-indigo-500/10' 
                          : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div>
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          Strict
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                        </span>
                        <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                          No 'Ignore' button allowed on distractions. Redirects are active, and lock passwords protect settings.
                        </p>
                      </div>
                      <span className="text-[9px] text-rose-400 font-bold uppercase mt-4">No Ignore Button + Lock</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: Password Setup */}
              {wizardStep === 4 && (
                <div className="flex flex-col gap-4 animate-scale-in">
                  <h2 className="text-2xl font-bold text-white tracking-tight">Create Protection Password</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Protect strict sessions from self-sabotage. Setting a password will lock modifications to schedules while focus limits are active.
                  </p>
                  <div className="flex flex-col gap-1.5 mt-2">
                    <label className="text-[10px] font-bold uppercase text-slate-400">Lock Password</label>
                    <input
                      type="password"
                      value={wizardForm.password}
                      onChange={(e) => setWizardForm({ ...wizardForm, password: e.target.value })}
                      className="bg-slate-950 border border-white/15 focus:border-indigo-500 outline-none rounded-xl px-4 py-3 text-xs text-slate-200 font-mono tracking-widest text-center"
                      placeholder="Leave blank for no password"
                    />
                    <span className="text-[9px] text-slate-500 leading-normal text-center mt-1">
                      Highly recommended for accountability. You'll need this to override strict warnings or delete tasks.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Step Controls */}
            <div className="flex justify-between items-center mt-8 pt-6 border-t border-white/5 shrink-0">
              <button
                type="button"
                onClick={() => setWizardStep(prev => Math.max(1, prev - 1))}
                disabled={wizardStep === 1}
                className="text-slate-400 hover:text-white text-xs font-semibold px-4 py-2 disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                Back
              </button>

              {wizardStep < 4 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (wizardStep === 1 && wizardForm.goals.trim().length === 0) {
                      alert('Please specify your study goals before proceeding.');
                      return;
                    }
                    setWizardStep(prev => prev + 1);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-6 py-2.5 rounded-xl shadow-lg transition-all active:scale-[0.98]"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleWizardSubmit}
                  className="bg-gradient-to-r from-indigo-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white font-semibold text-xs px-8 py-2.5 rounded-xl shadow-xl transition-all active:scale-[0.98]"
                >
                  Complete Setup & Launch
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
