import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Schedule, BreakState, CPProfiles, CoachReport } from '../types';
import { getAppState, saveAppState, subscribeToKey } from '../storage/chromeStorage';
import { getCurrentTask, getRemainingSeconds, formatRemainingTime } from '../utils/time';
import { Zap, BookOpen, Coffee, Settings, Timer, CheckCircle2, Award, ExternalLink, Brain, RefreshCw } from 'lucide-react';
import { syncCodeforces, syncLeetCode, syncAtCoder, generateCPCoachReport } from '../services/cpCoach';
import '../index.css';

// Mock contests matching background worker
const MOCK_UPCOMING_CONTESTS = [
  { name: "Codeforces Round #960 (Div. 2)", startTime: Date.now() + 25 * 60 * 1000, platform: "Codeforces" },
  { name: "LeetCode Biweekly Contest 134", startTime: Date.now() + 15 * 3600 * 1000, platform: "LeetCode" },
  { name: "AtCoder Beginner Contest 360", startTime: Date.now() + 32 * 3600 * 1000, platform: "AtCoder" }
];

const Popup: React.FC = () => {
  const [activeTask, setActiveTask] = useState<Schedule | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [breakState, setBreakState] = useState<BreakState>({ inBreak: false, breakEndTime: 0 });
  const [breakSecondsLeft, setBreakSecondsLeft] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [focusScore, setFocusScore] = useState<number>(100);
  const [loading, setLoading] = useState<boolean>(false);

  // CP states inside popup
  const [cpProfiles, setCpProfiles] = useState<CPProfiles>({
    codeforcesHandle: '',
    leetcodeUsername: '',
    atcoderUsername: '',
    lastSyncTime: 0,
    codeforces: null,
    leetcode: null,
    atcoder: null,
  });
  const [coachReport, setCoachReport] = useState<CoachReport | null>(null);
  const [nearestContest, setNearestContest] = useState<any>(null);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      const state = await getAppState();
      setBreakState(state.breakState);
      setCpProfiles(state.cpProfiles);
      setCoachReport(state.coachReport);
      
      const currentTask = getCurrentTask(state.schedules);
      setActiveTask(currentTask);
      if (currentTask) {
        setSecondsLeft(getRemainingSeconds(currentTask.endTime));
      }

      setStreak(state.analytics.dailyStreak);
      
      // Calculate today's focus score
      const todayStr = new Date().toISOString().split('T')[0];
      const todayScore = state.analytics.focusScoreHistory.find(e => e.date === todayStr)?.score ?? 100;
      setFocusScore(todayScore);

      // Find nearest upcoming contest
      const now = Date.now();
      const nextC = MOCK_UPCOMING_CONTESTS.find(c => c.startTime > now);
      if (nextC) {
        setNearestContest(nextC);
      }
    }
    loadData();
  }, []);

  // Subscribe to changes in schedules, break state, analytics, profiles, and coach reports
  useEffect(() => {
    const unsubBreak = subscribeToKey<BreakState>('breakState', (newValue) => {
      setBreakState(newValue);
    });

    const unsubSchedules = subscribeToKey<Schedule[]>('schedules', (schedules) => {
      const currentTask = getCurrentTask(schedules);
      setActiveTask(currentTask);
      if (currentTask) {
        setSecondsLeft(getRemainingSeconds(currentTask.endTime));
      } else {
        setSecondsLeft(0);
      }
    });

    const unsubProfiles = subscribeToKey<CPProfiles>('cpProfiles', (profiles) => {
      setCpProfiles(profiles);
    });

    const unsubReport = subscribeToKey<CoachReport | null>('coachReport', (report) => {
      setCoachReport(report);
    });

    return () => {
      unsubBreak();
      unsubSchedules();
      unsubProfiles();
      unsubReport();
    };
  }, []);

  // Active Task timer countdown
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

  // Break state timer countdown
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

  const handleStartBreak = (mins: number) => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'START_BREAK', durationMinutes: mins }, (response) => {
      setLoading(false);
      if (response?.success) {
        const breakEndTime = Date.now() + mins * 60 * 1000;
        setBreakState({ inBreak: true, breakEndTime });
      }
    });
  };

  const handleCancelBreak = () => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'CANCEL_BREAK' }, (response) => {
      setLoading(false);
      if (response?.success) {
        setBreakState({ inBreak: false, breakEndTime: 0 });
      }
    });
  };

  // Quick manual sync trigger
  const handleQuickSync = async () => {
    setSyncing(true);
    try {
      const state = await getAppState();
      const cfHandle = state.cpProfiles.codeforcesHandle;
      const lcUser = state.cpProfiles.leetcodeUsername;
      const acUser = state.cpProfiles.atcoderUsername;

      const cfData = cfHandle ? await syncCodeforces(cfHandle) : null;
      const lcData = lcUser ? await syncLeetCode(lcUser) : null;
      const acData = acUser ? await syncAtCoder(acUser) : null;

      const updatedProfiles: CPProfiles = {
        codeforcesHandle: cfHandle,
        leetcodeUsername: lcUser,
        atcoderUsername: acUser,
        lastSyncTime: Date.now(),
        codeforces: cfData,
        leetcode: lcData,
        atcoder: acData,
      };

      setCpProfiles(updatedProfiles);
      await saveAppState({ cpProfiles: updatedProfiles });

      const report = await generateCPCoachReport(updatedProfiles, state.cpGoals, state.studyNotes);
      setCoachReport(report);
      await saveAppState({ coachReport: report });
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const openDashboard = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('dashboard.html', '_blank');
    }
  };

  // Compute Daily practice progress ratio
  const getPracticeProgress = () => {
    if (!coachReport || !coachReport.dailyPractice) return null;
    const dp = coachReport.dailyPractice;
    const items = [
      ...dp.warmup,
      ...dp.core,
      dp.challenge,
      dp.revision
    ];
    const solved = items.filter(i => i.solved).length;
    return { solved, total: items.length };
  };

  const practiceProg = getPracticeProgress();
  const hasLinkedProfiles = cpProfiles.codeforcesHandle || cpProfiles.leetcodeUsername || cpProfiles.atcoderUsername;

  return (
    <div className="w-[380px] min-h-[520px] bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden bg-mesh">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-slate-900/40 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Zap className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white">FocusFlow</h1>
            <span className="text-[10px] text-pink-400 font-semibold uppercase tracking-wider">CP Coach Engine</span>
          </div>
        </div>

        <button
          onClick={openDashboard}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 hover:border-white/10 transition-all"
          title="Open Options Dashboard"
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-5 flex flex-col gap-4 overflow-y-auto">
        {/* Break State Active */}
        {breakState.inBreak ? (
          <div className="glass rounded-xl p-5 border border-indigo-500/20 text-center animate-slide-up relative">
            <div className="absolute top-3 right-3 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </div>
            
            <Coffee className="h-8 w-8 text-indigo-400 mx-auto mb-2 animate-bounce" />
            <h3 className="text-sm font-semibold text-white">Break in Progress</h3>
            <p className="text-xs text-slate-400 mt-1 mb-3">Monitoring is temporarily paused.</p>
            
            <div className="font-mono text-2xl font-bold text-indigo-400 tracking-wider mb-4">
              {formatRemainingTime(breakSecondsLeft)}
            </div>

            <button
              onClick={handleCancelBreak}
              disabled={loading}
              className="w-full bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 hover:border-indigo-500/40 text-indigo-300 text-xs font-semibold py-2 px-4 rounded-lg transition-all"
            >
              Resume Focus Mode
            </button>
          </div>
        ) : activeTask ? (
          /* Active Schedule Task Card */
          <div className="glass rounded-xl p-5 border border-indigo-500/10 animate-slide-up flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 pr-2">
                <span className="flex items-center gap-1.5 text-indigo-400 text-[10px] font-semibold uppercase tracking-wider">
                  <BookOpen className="h-3 w-3" />
                  Studying Now
                </span>
                <h3 className="text-base font-bold text-white mt-1 leading-tight">{activeTask.title}</h3>
                {activeTask.description && (
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {activeTask.description}
                  </p>
                )}
              </div>
              {activeTask.strictMode && (
                <span className="flex items-center gap-1 bg-rose-500/10 text-rose-300 text-[9px] font-bold uppercase px-2 py-0.5 rounded border border-rose-500/20">
                  Strict
                </span>
              )}
            </div>

            {/* Countdown widget */}
            <div className="bg-slate-950/45 rounded-lg p-4 border border-white/5 flex flex-col items-center justify-center">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">Time Remaining</span>
              <div className="font-mono text-3xl font-extrabold text-white tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-400">
                {formatRemainingTime(secondsLeft)}
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
              <a
                href={activeTask.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/10 transition-all active:scale-[0.98]"
              >
                Go to Resource
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              
              <button
                onClick={() => handleStartBreak(5)}
                disabled={loading}
                className="bg-white/5 hover:bg-white/10 text-slate-200 border border-white/5 hover:border-white/10 py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <Coffee className="h-3.5 w-3.5" />
                5 Min Break
              </button>
            </div>
          </div>
        ) : (
          /* No Active Task Scheduled */
          <div className="glass rounded-xl p-5 border border-white/5 text-center flex flex-col items-center gap-3.5 animate-slide-up">
            <div className="p-3 bg-indigo-500/10 rounded-full border border-indigo-500/25">
              <Timer className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">No Active Task Scheduled</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-[240px] mx-auto leading-relaxed">
                Start study timeline or sync study blocks from Smart Calendar Planner.
              </p>
            </div>
            <button
              onClick={openDashboard}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2.5 px-6 rounded-xl transition-all active:scale-[0.98] shadow-md shadow-indigo-600/15 flex items-center gap-1.5"
            >
              Open Daily Planner
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* CP Coach Overview Panel */}
        <div className="glass rounded-xl p-4.5 border border-white/5 flex flex-col gap-3.5 text-left text-xs animate-slide-up">
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1 text-[10px] text-pink-400 uppercase font-bold tracking-wider">
              <Brain className="h-3.5 w-3.5" />
              CP Coach Assistant
            </span>
            {hasLinkedProfiles && (
              <button
                onClick={handleQuickSync}
                disabled={syncing}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
            )}
          </div>

          {hasLinkedProfiles ? (
            <div className="flex flex-col gap-2.5">
              {/* Daily Practice progress indicator */}
              {practiceProg ? (
                <div className="flex justify-between items-center p-2 bg-slate-900/50 rounded-lg border border-white/5">
                  <span className="text-slate-300">Daily Practice sheet:</span>
                  <strong className="text-emerald-400 font-mono">{practiceProg.solved} / {practiceProg.total} Solved</strong>
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">Syncing profiles to compile daily worksheets...</div>
              )}

              {/* Upcoming Contest reminder */}
              {nearestContest ? (
                <div className="flex justify-between items-center p-2 bg-slate-900/50 rounded-lg border border-white/5">
                  <div>
                    <span className="text-[8px] bg-red-500/15 text-red-300 px-1 py-0.5 rounded font-bold uppercase mr-1">{nearestContest.platform}</span>
                    <span className="text-slate-300 font-semibold">{nearestContest.name.substring(0, 18)}...</span>
                  </div>
                  <strong className="text-indigo-400 font-mono text-[10px]">
                    {Math.round((nearestContest.startTime - Date.now()) / (60 * 1000))}m
                  </strong>
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 text-center">No upcoming contests scheduled.</div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 leading-relaxed">
              Link your Codeforces / LeetCode / AtCoder handles in settings to generate daily CP worksheets and track contest countdowns.
            </div>
          )}
        </div>

        {/* Stats Summary Widgets */}
        <div className="grid grid-cols-2 gap-3.5">
          <div className="glass-light rounded-xl p-3.5 flex flex-col gap-1 border border-white/5">
            <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              Focus Score
            </span>
            <div className="text-xl font-bold text-white mt-1">
              {focusScore}%
            </div>
            <span className="text-[9px] text-slate-500">Today's score rating</span>
          </div>

          <div className="glass-light rounded-xl p-3.5 flex flex-col gap-1 border border-white/5">
            <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider flex items-center gap-1">
              <Award className="h-3 w-3 text-amber-400" />
              Daily Streak
            </span>
            <div className="text-xl font-bold text-white mt-1">
              {streak} {streak === 1 ? 'day' : 'days'}
            </div>
            <span className="text-[9px] text-slate-500">Keep the streak alive!</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-5 py-3 border-t border-white/5 bg-slate-900/20 text-center flex items-center justify-between text-[10px] text-slate-500">
        <span>Version 1.0.0</span>
        <button 
          onClick={openDashboard} 
          className="text-indigo-400 hover:text-indigo-300 font-medium hover:underline flex items-center gap-0.5"
        >
          View Analytics
        </button>
      </footer>
    </div>
  );
};

// Render Popup Root
const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
