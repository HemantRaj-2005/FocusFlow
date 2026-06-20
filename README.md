# FocusFlow ⚡

FocusFlow is a production-ready, task-aware study enforcement Chrome Extension built with **React**, **TypeScript**, **Tailwind CSS**, and **Vite** under **Manifest V3**. 

Unlike a simple website blocker, FocusFlow acts as a strict accountability partner. It checks your active tab content against your scheduled task's topic and whitelisted domains. If you get distracted, it shows a glassmorphic warning overlay, lock options in Strict Mode, and eventually redirects your tab back to your target study resource after the 3rd infraction.

FocusFlow features a **Rule-Based Engine** as well as a **Gemini AI Relevance Engine** (using `@google/genai` and the `gemini-2.5-flash` model) to verify semantic relevance and intercept entertainment loops on whitelisted domains (like watching unrelated videos on YouTube).

---

## 🚀 Getting Started

Follow these steps to set up, build, and load FocusFlow on your system.

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **NPM** (v10 or higher)

### 1. Install Dependencies
Open your terminal in the `FocusFlow` root directory and run:
```bash
npm install
```

### 2. Build the Extension
Compile the React source files, bundle assets, and compile the background script and content scripts into the unified `dist/` bundle:
```bash
npm run build
```
*Note: This executes our programmatic sequential bundler (`build.js`), which type-checks TypeScript and compiles the background script and content scripts in library mode to ensure they are self-contained.*

### 3. Load the Extension in Google Chrome
1. Open Google Chrome and go to **`chrome://extensions/`**.
2. Toggle the **"Developer mode"** switch in the top-right corner to **ON**.
3. Click the **"Load unpacked"** button in the top-left toolbar.
4. Select the compiled **`dist/`** directory located in the root of the project (`FocusFlow/dist`).
5. Pin **FocusFlow** to your Chrome toolbar by clicking the puzzle icon.

---

## ⚡ Core Features

### 📅 Onboarding Setup Wizard & Planner
On first launching the extension, an onboarding wizard guides you through:
1. Entering your study objectives.
2. Creating your first schedule slot.
3. Choosing your enforcement strictness.
4. Configuring your password.

Once completed, you can manage, add, edit, delete, and reorder daily schedule slots in a SaaS-style **Schedule Planner**.

### 🔒 Password-Protected Strict Mode
If a task is scheduled in **Strict Mode**:
- The **Ignore** option is disabled on the warning overlays.
- Reordering or editing the active task in the Planner is locked.
- You must verify your password (hashed securely using the native browser Web Crypto SHA-256 API) before unlocking settings or making adjustments.

### ☕ Timer & Study Break Controller
If you need a quick rest, trigger a **5, 10, or 15-minute break** from the popup or overlay. FocusFlow uses the `chrome.alarms` API to schedule a wakeup call that automatically resumes monitoring when the break ends, accompanied by a native Chrome notification.

### 📊 SaaS Analytics & SVG Charts
Track your productivity metrics inside the Dashboard:
- Focus Hours tracked per task.
- Blocked distraction attempts.
- Redirection history.
- Daily and weekly streaks.
- Interactive custom SVG area charts showing daily focus score trends.

---

## 🤖 Activating and Testing the Gemini AI Engine

FocusFlow has a built-in Gemini API client initialized with a preconfigured system API key to allow instant testing.

### How to Enable:
1. Open the FocusFlow dashboard (navigate to `chrome-extension://<EXTENSION_ID>/dashboard.html` or click the **Settings** gear in the popup).
2. Go to the **Settings** tab.
3. Under **Distraction Detection Engine**, select **Gemini AI Engine**.
4. *(Optional)* If you wish to use your own API key, paste it into the **Custom Gemini API Key** input and click **Save Key**.

### How to Test:
1. Create a schedule block starting now (e.g. *Learn Graph Theory*), whitelisting `youtube.com`.
2. Open a tab on YouTube:
   - Search for and play a semantically related video (e.g. *"Depth First Search Tutorial"*). FocusFlow **permits access** because it matches your study goals.
   - Go to a gaming video (e.g. *"GTA 6 trailer"*). The AI Engine analyzes the title, scores it low, and **displays the warning overlay**, preventing you from wandering off!


---

## 📦 Deploying & Publishing

### Safe GitHub Publishing (No Key Leaks)
This project uses Vite environment variables to prevent API keys from leaking on GitHub:
1. Copy the `.env.example` file and rename it to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your Gemini API key:
   ```text
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Because `.env` is listed in `.gitignore`, it will **never** be committed to Git or pushed to GitHub.

### Packing for Chrome Web Store (Deployment)
To generate the distribution archive for submission to the Chrome Web Store Developer Console:
1. Build the production package:
   ```bash
   npm run build
   ```
2. Package into a zip archive:
   ```bash
   npm run zip
   ```
This generates an **`extension.zip`** file in the root directory. You can upload this zip directly to the Chrome Web Store Developer Console to publish it!

---

## 📁 Folder Structure

- `public/`: Manifest V3 files, logos, and icons copied directly to `dist/`.
- `src/background/`: Service Worker handling tab events, alarms, and redirection logic.
- `src/content/`: Shadow DOM isolated overlay code and CSS styling.
- `src/popup/`: Main dropdown popup panel.
- `src/pages/`: Option Dashboard views, planner modules, and SVG graphs.
- `src/storage/`: Storage adapters wrapping `chrome.storage.local` with `localStorage` dev fallbacks.
- `src/utils/`: Time, date, and countdown format converters.
- `src/services/`: Rule-Based and Gemini AI Relevance scoring code.
- `build.js`: Compiles the different parts of the extension programmatically.
- `tailwind.config.js` & `postcss.config.js`: Tailwind directives.
