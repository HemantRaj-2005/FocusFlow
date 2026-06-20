import { Schedule, BreakState, OffenseState } from '../types';
import { getAppState, saveAppState, getStorageItem } from '../storage/chromeStorage';
import { getCurrentTask, getRemainingSeconds, formatRemainingTime } from '../utils/time';
import { RuleBasedAnalyzer, AIAnalyzer } from '../services/analyzer';

const ruleAnalyzer = new RuleBasedAnalyzer();
const aiAnalyzer = new AIAnalyzer();

async function analyzeRelevance(
  taskTitle: string,
  taskDescription: string,
  pageTitle: string,
  url: string,
  allowedDomains: string[],
  warningThreshold: number
) {
  const mode = await getStorageItem<'rule' | 'ai'>('analyzerMode', 'rule');
  const activeAnalyzer = mode === 'ai' ? aiAnalyzer : ruleAnalyzer;
  return activeAnalyzer.analyze(taskTitle, taskDescription, pageTitle, url, allowedDomains, warningThreshold);
}

let activeOffenses: OffenseState = {};

// In-memory cache of current break state to avoid reading storage on every tab change
let cachedBreakState: BreakState = { inBreak: false, breakEndTime: 0 };
let cachedSchedules: Schedule[] = [];

// Initialize background service worker
async function initialize() {
  const state = await getAppState();
  cachedBreakState = state.breakState;
  cachedSchedules = state.schedules;

  // Set up periodic alarm for tracking focus hours (1 tick = 1 minute)
  chrome.alarms.get('focus-tracker', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('focus-tracker', { periodInMinutes: 1 });
    }
  });

  console.log('FocusFlow Service Worker initialized.');
}

// Read cache updates when storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.breakState) {
      cachedBreakState = changes.breakState.newValue as BreakState;
    }
    if (changes.schedules) {
      cachedSchedules = changes.schedules.newValue as Schedule[];
    }
  }
});

// Run initialization
initialize();

/**
 * Perform distraction assessment on a given tab
 */
async function checkTabFocus(tabId: number, url: string, title: string) {
  if (!url || cachedBreakState.inBreak) {
    return { isDistraction: false, offenseLevel: 0 };
  }

  const activeTask = getCurrentTask(cachedSchedules);
  if (!activeTask) {
    // Reset offense count since no task is active
    if (activeOffenses[tabId]) {
      delete activeOffenses[tabId];
    }
    return { isDistraction: false, offenseLevel: 0 };
  }

  // Analyze page relevance
  const result = await analyzeRelevance(
    activeTask.title,
    activeTask.description,
    title,
    url,
    activeTask.allowedDomains,
    activeTask.warningThreshold
  );

  if (result.isDistraction) {
    // Check if this tab is already marked for this specific url
    const currentOffense = activeOffenses[tabId] || { offensesCount: 0, lastOffenseUrl: '', lastOffenseTime: 0 };
    
    // If it's a new URL or more than 10 seconds has passed since last check on this distraction
    const now = Date.now();
    let count = currentOffense.offensesCount;

    if (currentOffense.lastOffenseUrl !== url || now - currentOffense.lastOffenseTime > 8000) {
      count++;
      activeOffenses[tabId] = {
        offensesCount: count,
        lastOffenseUrl: url,
        lastOffenseTime: now,
      };

      // Increment total distraction attempts in analytics
      await recordDistractionAttempt();
    }

    if (count >= 3) {
      // 3rd Offense: Redirect!
      console.log(`Tab ${tabId} reached 3rd offense. Redirecting to: ${activeTask.targetUrl}`);
      chrome.tabs.update(tabId, { url: activeTask.targetUrl });
      
      // Reset offense counter
      delete activeOffenses[tabId];

      // Update analytics
      await recordRedirect();

      // Show Chrome Notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon-128.png', // Fallback, will be packaged in public/assets/
        title: 'FocusFlow Redirected You',
        message: `Redirected you back to "${activeTask.title}" study resource. Stay focused!`,
        priority: 2
      });

      return { isDistraction: false, offenseLevel: 0 };
    }

    return {
      isDistraction: true,
      task: activeTask,
      offenseLevel: count,
      remainingTime: formatRemainingTime(getRemainingSeconds(activeTask.endTime)),
    };
  } else {
    // Focused! Reset offense counter for this tab
    if (activeOffenses[tabId]) {
      delete activeOffenses[tabId];
    }
    return { isDistraction: false, offenseLevel: 0 };
  }
}

// Tab navigation monitoring
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Check when page finishes loading or changes URL
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    checkTabFocus(tabId, tab.url, tab.title || '')
      .then((res) => {
        if (res.isDistraction) {
          chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_OVERLAY',
            task: res.task,
            offenseLevel: res.offenseLevel,
            remainingTime: res.remainingTime,
          }).catch(() => {
            // Content script might not be loaded yet; ignore error
          });
        } else {
          chrome.tabs.sendMessage(tabId, { type: 'HIDE_OVERLAY' }).catch(() => {});
        }
      });
  }
});

// Tab switch monitoring
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && tab.url && !tab.url.startsWith('chrome://')) {
      checkTabFocus(activeInfo.tabId, tab.url, tab.title || '')
        .then((res) => {
          if (res.isDistraction) {
            chrome.tabs.sendMessage(activeInfo.tabId, {
              type: 'SHOW_OVERLAY',
              task: res.task,
              offenseLevel: res.offenseLevel,
              remainingTime: res.remainingTime,
            }).catch(() => {});
          } else {
            chrome.tabs.sendMessage(activeInfo.tabId, { type: 'HIDE_OVERLAY' }).catch(() => {});
          }
        });
    }
  });
});

// Listener for runtime messages (IPC channel)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_STATUS') {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url;
    const title = sender.tab?.title;

    if (tabId && url) {
      checkTabFocus(tabId, url, title || '').then((res) => {
        sendResponse(res);
      });
      return true; // Keep message channel open for async response
    } else {
      sendResponse({ isDistraction: false, offenseLevel: 0 });
    }
  }

  if (message.type === 'START_BREAK') {
    const duration = message.durationMinutes || 5;
    const breakEndTime = Date.now() + duration * 60 * 1000;
    const newBreakState: BreakState = { inBreak: true, breakEndTime };

    chrome.alarms.create('break-alarm', { delayInMinutes: duration });
    
    saveAppState({ breakState: newBreakState }).then(() => {
      // Clear offenses
      activeOffenses = {};
      // Broadcast update
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: 'HIDE_OVERLAY' }).catch(() => {});
          }
        }
      });
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon-128.png',
        title: 'Break Started',
        message: `Enjoy your ${duration} minute break! FocusFlow monitoring is paused.`,
        priority: 1
      });

      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CANCEL_BREAK') {
    chrome.alarms.clear('break-alarm');
    const newBreakState: BreakState = { inBreak: false, breakEndTime: 0 };
    saveAppState({ breakState: newBreakState }).then(() => {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon-128.png',
        title: 'Break Cancelled',
        message: 'FocusFlow monitoring has resumed.',
        priority: 1
      });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'IGNORE_DISTRACTION') {
    const tabId = sender.tab?.id;
    if (tabId && activeOffenses[tabId]) {
      // Temporarily lower or reset offense count (allowed if not strict mode)
      delete activeOffenses[tabId];
    }
    sendResponse({ success: true });
  }

  if (message.type === 'REDIRECT_TO_STUDY') {
    const tabId = sender.tab?.id;
    const activeTask = getCurrentTask(cachedSchedules);
    if (tabId && activeTask) {
      chrome.tabs.update(tabId, { url: activeTask.targetUrl });
      delete activeOffenses[tabId];
      recordRedirect();
    }
    sendResponse({ success: true });
  }
});

// Listener for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'break-alarm') {
    const freshBreakState: BreakState = { inBreak: false, breakEndTime: 0 };
    saveAppState({ breakState: freshBreakState }).then(() => {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon-128.png',
        title: 'Break Ended!',
        message: 'Time to get back to work. FocusFlow monitoring is active.',
        priority: 2,
        requireInteraction: true
      });
    });
  }

  if (alarm.name === 'focus-tracker') {
    // 1-minute tick: Accumulate focus hours if user is actively focused on their study
    trackFocusHourMinute();
  }
});

/**
 * Increment focus hours if task is active and user is focused
 */
async function trackFocusHourMinute() {
  const activeTask = getCurrentTask(cachedSchedules);
  if (!activeTask || cachedBreakState.inBreak) return;

  // Find if user has a tab open that is relevant to the task
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs.length === 0) return;
    const activeTab = tabs[0];
    if (!activeTab.url || activeTab.url.startsWith('chrome://')) return;

    // Check if the current active tab is relevant (focused)
    const result = await analyzeRelevance(
      activeTask.title,
      activeTask.description,
      activeTab.title || '',
      activeTab.url,
      activeTask.allowedDomains,
      activeTask.warningThreshold
    );

    if (!result.isDistraction) {
      // User is studying! Add 1 minute (1/60th of an hour) to focus analytics
      await accumulateFocusTime(1 / 60);
    }
  });
}

/**
 * Storage log update helpers
 */
async function recordDistractionAttempt() {
  const state = await getAppState();
  const analytics = state.analytics;
  analytics.distractionAttempts++;
  await saveAppState({ analytics });
}

async function recordRedirect() {
  const state = await getAppState();
  const analytics = state.analytics;
  analytics.redirectCount++;
  await saveAppState({ analytics });
}

async function accumulateFocusTime(hours: number) {
  const state = await getAppState();
  const analytics = state.analytics;
  analytics.focusHours += hours;

  // Process Daily Streak
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (!analytics.lastFocusDate) {
    analytics.dailyStreak = 1;
    analytics.weeklyStreak = 1;
    analytics.lastFocusDate = todayStr;
  } else if (analytics.lastFocusDate === yesterdayStr) {
    analytics.dailyStreak += 1;
    analytics.lastFocusDate = todayStr;
    
    // Simple logic: every 7 daily streak increments the weekly streak
    analytics.weeklyStreak = Math.max(1, Math.ceil(analytics.dailyStreak / 7));
  } else if (analytics.lastFocusDate !== todayStr) {
    // Streak broken!
    analytics.dailyStreak = 1;
    analytics.lastFocusDate = todayStr;
  }

  // Update focus score history
  // Focus Score = Max(0, 100 - (attempts * 5) - (redirects * 15)) but based on performance
  // Let's compute a simple focus score for today
  const todayEntryIdx = analytics.focusScoreHistory.findIndex(entry => entry.date === todayStr);
  
  // Calculate today's focus score:
  // Starts at 100, decays with distraction attempts and redirects, but scales with focus hours.
  // Formula: Math.max(10, Math.min(100, Math.round(100 - (analytics.distractionAttempts * 2) - (analytics.redirectCount * 8) + (analytics.focusHours * 10))))
  // Let's make it a sensible score between 0 and 100
  const scoreRaw = 100 - (analytics.distractionAttempts * 3) - (analytics.redirectCount * 10);
  const score = Math.max(10, Math.min(100, Math.round(scoreRaw)));

  if (todayEntryIdx >= 0) {
    analytics.focusScoreHistory[todayEntryIdx].score = score;
  } else {
    analytics.focusScoreHistory.push({ date: todayStr, score });
    // Keep max 30 entries
    if (analytics.focusScoreHistory.length > 30) {
      analytics.focusScoreHistory.shift();
    }
  }

  await saveAppState({ analytics });
}
