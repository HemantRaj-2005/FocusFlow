import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Schedule } from '../types';
import stylesText from './content.css?inline';
import { getRemainingSeconds, formatRemainingTime } from '../utils/time';

// Root container ID
const CONTAINER_ID = 'focusflow-overlay-container';

interface OverlayProps {
  initialTask: Schedule;
  initialOffenseLevel: number;
  onHide: () => void;
}

const OverlayApp: React.FC<OverlayProps> = ({
  initialTask,
  initialOffenseLevel,
  onHide,
}) => {
  const [task, setTask] = useState<Schedule>(initialTask);
  const [offenseLevel, setOffenseLevel] = useState<number>(initialOffenseLevel);
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    return getRemainingSeconds(initialTask.endTime);
  });
  const [breakConfirm, setBreakConfirm] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Local clock ticking countdown
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onHide(); // Hide overlay when task ends
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  // Sync state if background sends updates
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'SHOW_OVERLAY') {
        setTask(message.task);
        setOffenseLevel(message.offenseLevel);
        setSecondsLeft(getRemainingSeconds(message.task.endTime));
      } else if (message.type === 'HIDE_OVERLAY') {
        onHide();
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [onHide]);

  const handleReturnToStudy = () => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'REDIRECT_TO_STUDY' }, () => {
      setLoading(false);
    });
  };

  const handleStartBreak = (mins: number) => {
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'START_BREAK', durationMinutes: mins }, (response) => {
      setLoading(false);
      if (response?.success) {
        onHide();
      }
    });
  };

  const handleIgnore = () => {
    if (task.strictMode) return; // Strict Mode safety
    setLoading(true);
    chrome.runtime.sendMessage({ type: 'IGNORE_DISTRACTION' }, (response) => {
      setLoading(false);
      if (response?.success) {
        onHide();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-950/85 p-4 select-none">
      <div className="w-full max-w-lg overlay-glass rounded-2xl p-8 border border-white/10 text-white animate-scale-in text-center relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute -top-12 -left-12 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header Warning Icon */}
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-rose-500/10 rounded-full border border-rose-500/20 animate-pulse-slow">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>

        {/* Warning Severity Indicator */}
        <div className="mb-4">
          <span className="px-3 py-1 bg-rose-500/20 text-rose-300 text-xs font-semibold uppercase tracking-wider rounded-full border border-rose-500/30">
            {offenseLevel === 1 ? 'Focus Warning' : 'Final Warning'}
          </span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Focus Reminder</h1>
        
        <p className="text-slate-300 text-sm mb-6 max-w-sm mx-auto leading-relaxed">
          This page appears unrelated to your active study schedule. Your strict accountability partner is monitoring.
        </p>

        {/* Active Task Details Card */}
        <div className="overlay-glass-inner rounded-xl p-5 text-left mb-6 relative border border-white/5">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-indigo-400 text-xs font-medium uppercase tracking-wider">Active Task</span>
              <h2 className="text-lg font-bold text-white mt-0.5">{task.title}</h2>
              {task.description && (
                <p className="text-slate-400 text-xs mt-1 leading-relaxed line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>
            {task.strictMode && (
              <span className="flex items-center gap-1 bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md border border-indigo-500/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Strict
              </span>
            )}
          </div>
          
          <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-xs text-slate-400">
            <span>Remaining Time:</span>
            <span className="font-mono text-base font-semibold text-indigo-400 tracking-wider">
              {formatRemainingTime(secondsLeft)}
            </span>
          </div>
        </div>

        {/* Actions Button Grid */}
        <div className="flex flex-col gap-3">
          {/* Primary Call To Action */}
          <button
            onClick={handleReturnToStudy}
            disabled={loading}
            className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Return to Study Resource
              </>
            )}
          </button>

          {!breakConfirm ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setBreakConfirm(true)}
                disabled={loading}
                className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-slate-200 text-sm font-medium py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
              >
                Take a Break
              </button>
              
              <button
                onClick={handleIgnore}
                disabled={loading || task.strictMode}
                className={`border text-sm font-medium py-2.5 px-4 rounded-xl transition-all active:scale-[0.98] ${
                  task.strictMode
                    ? 'border-white/5 text-slate-500 cursor-not-allowed opacity-40'
                    : 'border-white/10 bg-white/0 hover:bg-white/5 text-slate-300'
                }`}
                title={task.strictMode ? 'Ignore disabled in strict mode' : 'Ignore distraction'}
              >
                Ignore
              </button>
            </div>
          ) : (
            <div className="overlay-glass-inner rounded-xl p-4 border border-white/5 animate-scale-in">
              <div className="text-xs text-slate-300 mb-2.5 font-medium">Select Break Duration:</div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[5, 10, 15].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => handleStartBreak(mins)}
                    disabled={loading}
                    className="bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-300 text-xs font-semibold py-2 px-3 rounded-lg transition-all active:scale-[0.95]"
                  >
                    {mins} Min
                  </button>
                ))}
              </div>
              <button
                onClick={() => setBreakConfirm(false)}
                className="text-slate-400 hover:text-slate-200 text-xs underline"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Root element variables
let overlayRoot: HTMLElement | null = null;
let reactRoot: ReactDOM.Root | null = null;

function showOverlay(task: Schedule, offenseLevel: number) {
  // Check if already injected
  if (document.getElementById(CONTAINER_ID)) {
    return;
  }

  // Create outer host element
  overlayRoot = document.createElement('div');
  overlayRoot.id = CONTAINER_ID;
  
  // High-priority styling for container
  overlayRoot.style.position = 'fixed';
  overlayRoot.style.top = '0';
  overlayRoot.style.left = '0';
  overlayRoot.style.width = '100vw';
  overlayRoot.style.height = '100vh';
  overlayRoot.style.zIndex = '2147483647';
  
  document.documentElement.appendChild(overlayRoot);

  // Attach Shadow DOM for isolation
  const shadow = overlayRoot.attachShadow({ mode: 'open' });

  // Add styles
  const styleEl = document.createElement('style');
  styleEl.textContent = stylesText;
  shadow.appendChild(styleEl);

  // React mounting node
  const reactContainer = document.createElement('div');
  reactContainer.className = 'focusflow-reset';
  shadow.appendChild(reactContainer);

  // Render React App
  reactRoot = ReactDOM.createRoot(reactContainer);
  reactRoot.render(
    <OverlayApp
      initialTask={task}
      initialOffenseLevel={offenseLevel}
      onHide={hideOverlay}
    />
  );
}

function hideOverlay() {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  if (overlayRoot) {
    overlayRoot.remove();
    overlayRoot = null;
  }
}

// Initial status check on document load
function checkInitialStatus() {
  chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (response) => {
    if (response && response.isDistraction) {
      showOverlay(response.task, response.offenseLevel);
    } else {
      hideOverlay();
    }
  });
}

// Listen for push notifications from background to display/remove overlay
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_OVERLAY') {
    showOverlay(message.task, message.offenseLevel);
  } else if (message.type === 'HIDE_OVERLAY') {
    hideOverlay();
  }
});

// Run initial check
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkInitialStatus);
} else {
  checkInitialStatus();
}
