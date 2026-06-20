import { GoogleGenAI } from '@google/genai';

const DEFAULT_GEMINI_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';

export interface AnalysisResult {
  score: number;       // 0 to 100
  isDistraction: boolean;
  reason: string;
}

export interface RelevanceAnalyzer {
  analyze(
    taskTitle: string,
    taskDescription: string,
    pageTitle: string,
    url: string,
    allowedDomains: string[],
    warningThreshold: number
  ): Promise<AnalysisResult>;
}

/**
 * Extracts the clean hostname from a URL.
 * e.g., "https://www.youtube.com/watch?v=123" -> "youtube.com"
 */
export function getDomain(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname;
  } catch {
    return '';
  }
}

/**
 * Checks if a hostname matches or is a subdomain of an allowed pattern.
 * e.g., "youtube.com" allows "music.youtube.com" or "youtube.com"
 */
export function isDomainAllowed(hostname: string, allowedPatterns: string[]): boolean {
  const cleanHost = hostname.toLowerCase();
  return allowedPatterns.some((pattern) => {
    const cleanPattern = pattern.toLowerCase().trim();
    if (cleanHost === cleanPattern) return true;
    if (cleanHost.endsWith('.' + cleanPattern)) return true;
    return false;
  });
}

// Common known distraction domains
const KNOWN_DISTRACTIONS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'reddit.com',
  'netflix.com',
  'twitch.tv',
  'pinterest.com',
  'tumblr.com',
  'linkedin.com', // Can be a distraction during heavy study
  'buzzfeed.com',
  'amazon.com',
  'ebay.com',
  'aliexpress.com',
  'netflix.com',
  'disneyplus.com',
  'hulu.com',
];

const MIXED_CONTENT_DOMAINS = [
  'youtube.com',
  'google.com',
  'wikipedia.org',
  'github.com',
  'reddit.com',
  'medium.com',
  'quora.com',
  'stackexchange.com',
  'bing.com',
  'yahoo.com'
];

export class RuleBasedAnalyzer implements RelevanceAnalyzer {
  async analyze(
    taskTitle: string,
    taskDescription: string,
    pageTitle: string,
    url: string,
    allowedDomains: string[],
    warningThreshold: number
  ): Promise<AnalysisResult> {
    const hostname = getDomain(url);

    // 1. If empty or invalid URL
    if (!hostname) {
      return { score: 100, isDistraction: false, reason: 'Local or system page' };
    }

    // 2. Check explicitly allowed domains
    if (isDomainAllowed(hostname, allowedDomains)) {
      const isMixedContent = MIXED_CONTENT_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith('.' + domain)
      );

      if (isMixedContent) {
        // For shared platforms, check if there is at least one study keyword match in the title/URL
        const cleanTaskTitle = taskTitle.toLowerCase();
        const cleanTaskDesc = taskDescription.toLowerCase();
        const cleanPageTitle = pageTitle.toLowerCase();
        const cleanUrl = url.toLowerCase();

        const getWords = (str: string) =>
          str
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length >= 3);

        const taskKeywords = [...getWords(cleanTaskTitle), ...getWords(cleanTaskDesc)];
        const uniqueKeywords = Array.from(new Set(taskKeywords));

        if (uniqueKeywords.length > 0) {
          const pageWords = [...getWords(cleanPageTitle), ...getWords(cleanUrl)];
          const hasKeywordMatch = uniqueKeywords.some(
            (kw) => pageWords.includes(kw) || cleanPageTitle.includes(kw)
          );

          if (!hasKeywordMatch) {
            return {
              score: 30,
              isDistraction: true,
              reason: `Domain ${hostname} is allowed, but this specific page contains zero keywords matching your study task.`,
            };
          }
        }
      }

      return { score: 100, isDistraction: false, reason: 'Domain explicitly allowed in task settings.' };
    }

    // 3. Check for chrome:// and local extension pages (always allowed)
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return { score: 100, isDistraction: false, reason: 'Extension or Chrome settings page.' };
    }

    // 4. Check known distraction list
    const isBlacklisted = KNOWN_DISTRACTIONS.some(
      (dist) => hostname === dist || hostname.endsWith('.' + dist)
    );

    if (isBlacklisted) {
      return {
        score: 15,
        isDistraction: 15 < warningThreshold,
        reason: `Social media or entertainment site (${hostname}) marked as distraction.`,
      };
    }

    // 5. Keyword analysis
    const cleanTaskTitle = taskTitle.toLowerCase();
    const cleanTaskDesc = taskDescription.toLowerCase();
    const cleanPageTitle = pageTitle.toLowerCase();
    const cleanUrl = url.toLowerCase();

    // Extract searchable words (minimum 3 chars)
    const getWords = (str: string) =>
      str
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 3);

    const taskKeywords = [...getWords(cleanTaskTitle), ...getWords(cleanTaskDesc)];
    const pageWords = [...getWords(cleanPageTitle), ...getWords(cleanUrl)];

    // Unique task keywords
    const uniqueKeywords = Array.from(new Set(taskKeywords));
    if (uniqueKeywords.length === 0) {
      // No keywords defined, default to neutral score
      const score = 55;
      return {
        score,
        isDistraction: score < warningThreshold,
        reason: 'No study keywords defined to verify page relevance.',
      };
    }

    // Find matches
    let matchesCount = 0;
    const matchedWords: string[] = [];
    for (const kw of uniqueKeywords) {
      if (pageWords.includes(kw) || cleanPageTitle.includes(kw)) {
        matchesCount++;
        matchedWords.push(kw);
      }
    }

    // Calculate score based on matches
    // Baseline score is 35 (neutral-low). Every match increases score by 25 points.
    const baseline = 35;
    const matchBonus = matchesCount * 25;
    const score = Math.min(100, baseline + matchBonus);

    const isDistraction = score < warningThreshold;
    const reason = isDistraction
      ? `Relevance score is ${score}/100. Keywords do not align with current task.`
      : `Relevance score is ${score}/100. Keywords match task topic: [${matchedWords.join(', ')}].`;

    return { score, isDistraction, reason };
  }
}

/**
 * Extensible AI-based Analyzer.
 * Can be plugged in with chrome.experimental.aiOriginTrial or cloud APIs.
 */
export class AIAnalyzer implements RelevanceAnalyzer {
  private fallback = new RuleBasedAnalyzer();

  async analyze(
    taskTitle: string,
    taskDescription: string,
    pageTitle: string,
    url: string,
    allowedDomains: string[],
    warningThreshold: number
  ): Promise<AnalysisResult> {
    const hostname = getDomain(url);

    // 1. Bypass AI calls for local system and explicitly allowed pages to conserve quota
    if (!hostname) {
      return { score: 100, isDistraction: false, reason: 'Local or system page' };
    }
    if (isDomainAllowed(hostname, allowedDomains)) {
      const isMixedContent = MIXED_CONTENT_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith('.' + domain)
      );
      // Skip AI calls only for purely educational whitelisted platforms (like leetcode.com)
      if (!isMixedContent) {
        return { score: 100, isDistraction: false, reason: 'Domain explicitly allowed.' };
      }
    }
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return { score: 100, isDistraction: false, reason: 'Extension or settings page.' };
    }

    try {
      // Fetch custom API key if user configured one, otherwise default to user key
      let apiKey = DEFAULT_GEMINI_KEY;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const stored = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['geminiApiKey'], (res) => resolve(res));
        });
        if (stored?.geminiApiKey) {
          apiKey = stored.geminiApiKey;
        }
      }

      // Initialize GoogleGenAI client
      const ai = new GoogleGenAI({ apiKey });

      // Build structured context prompt
      const prompt = `You are a focus enforcement agent deciding if the current browser page is relevant to the active study schedule.

Active Study Task: "${taskTitle}"
Task Details: "${taskDescription}"
Allowed domains: ${allowedDomains.join(', ') || 'None specified'}

Current Browsed Website Host: "${hostname}"
Current Page Title: "${pageTitle}"
Current Page URL: "${url}"
Strictness warning threshold: ${warningThreshold}

Analyze topic relevance. If the page is a distraction (like social media, games, entertainment, or completely unrelated to the study task), score it low. If it's a documentation page, tutorial, educational resource, or related tool, score it high.
Note: Even if the domain is listed as an allowed domain (such as youtube.com or wikipedia.org), evaluate the semantic relevance of this specific page's video, article, or query content.
You MUST output exactly a JSON object matching this schema, without code block backticks or any markdown formatting:
{
  "score": <number from 0 to 100>,
  "isDistraction": <boolean based on whether score is below warning threshold>,
  "reason": "<one sentence reason explaining why this page is relevant or distracted>"
}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Received empty response text from Gemini API.');
      }

      const parsed = JSON.parse(responseText.trim()) as {
        score: number;
        isDistraction: boolean;
        reason: string;
      };

      return {
        score: typeof parsed.score === 'number' ? parsed.score : 50,
        isDistraction: typeof parsed.isDistraction === 'boolean' ? parsed.isDistraction : parsed.score < warningThreshold,
        reason: parsed.reason || 'AI relevance analysis complete.',
      };
    } catch (e) {
      console.warn('Gemini AI check failed. Falling back to Rule-Based checks:', e);
      return this.fallback.analyze(
        taskTitle,
        taskDescription,
        pageTitle,
        url,
        allowedDomains,
        warningThreshold
      );
    }
  }
}
