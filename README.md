# Better Bookmarks

<p align="center">
  <img src="public/favicon.svg" alt="Better Bookmarks logo" width="128" />
</p>

<p align="center">
  <strong>The bookmark manager for people who save everything and find nothing.</strong>
</p>

<p align="center">
  Local-first bookmark triage, cleanup, reminders, and AI-powered organization for Chrome.
</p>

<p align="center">
  Made by a fellow obsessive bookmark hoarder <a href="https://x.com/ai_singhal">@ai_singhal</a>
</p>

I built Better Bookmarks because I was tired of searching through my 500+ bookmarks to find one research paper I bookmarked 2 years ago. It was such a frustrating experience. I knew I had saved the link, but I couldn't remember why I saved it or where it was in my massive list of bookmarks.

Better Bookmarks is a Chrome extension for people whose bookmark bar turned into a Public Storage rental unit. It's designed to help you quickly find the bookmarks you need, without having to manually search through hundreds of links.

The core experience is local-first. Your bookmark tree lives in Chrome, your extension metadata lives in Chrome storage, and the extension is useful before you configure any external service.

## What Makes It Different

- A fast popup for recent bookmarks and quick lookup.
- A full dashboard for browsing, reordering, batch-moving, and cleaning up bookmark folders.
- A "Discover" flow that feels more like triage than folder maintenance.
- Reminder scheduling for links you actually want to come back to.
- Per-bookmark notes, tags, and context stored alongside the bookmark in extension storage.
- An `AI Chat` page that can turn plain-English requests into bookmark actions with bookmark-tree and Chrome history context.
- Right-click AI actions for individual bookmarks, folders, or selections.
- An `Organize` page that combines bookmark structure with recent Chrome history to suggest bookmarks, moves, renames, and cleanup work.

## Current Product Surface

Today, the extension is centered around six pages:

- `Bookmarks`: browse the full tree, create folders, drag items across folders, multi-select with `Cmd/Ctrl` or `Shift`, and right-click to batch move, delete, or ask AI what to do with the selection.
- `AI Chat`: use an OpenAI key to search, rename, move, create folders, preview planned changes, and perform bulk bookmark actions from natural language.
- `Organize`: analyze bookmarks against Chrome history to suggest new bookmarks, better folder placement, folder renames, reorder ideas, and cleanup work.
- `Discover`: review bookmarks one by one, add notes and tags, rename in place, and use bookmark-specific AI while working through them like flashcards.
- `Reminders`: manage bookmark follow-ups and recurring reminders.
- `Settings`: configure local preferences, the optional OpenAI API key and model, and bookmark-tree snapshots for rollback.

On first install, the extension automatically opens the dashboard.

## Local-First By Default

Better Bookmarks is designed to be useful without standing up a backend.

Out of the box, the project already supports:

- reading and managing the Chrome bookmark tree
- reading recent Chrome history to find high-frequency sites and rank organizational relevance
- storing bookmark notes, tags, folder descriptions, and triage history in `chrome.storage.local`
- storing user settings, bookmark-tree snapshots, and the OpenAI API key in `chrome.storage.sync`
- scheduling reminders with Chrome alarms and notifications
- quick popup search with a fallback to Chrome's native bookmark search
- fetching bookmarked page content to improve local context and summaries

## AI Layer

The current command workflow:

- takes your full bookmark tree
- serializes it into a model-readable structure
- sends your prompt and the tree to OpenAI
- receives structured actions back
- executes those actions through the Chrome bookmarks API

The AI Chat page uses your chosen OpenAI text model directly from the extension. The default is `gpt-5.4-mini`, and the picker is curated to current relevant API text models for this workflow. The API key is stored in Chrome sync storage and sent only to OpenAI when you use that feature.

## How To Install And Run

1. Install dependencies:

```bash
npm install
```

2. Build the extension:

```bash
npm run build
```

3. Open Chrome and go to `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the generated `dist` folder from this project.

If you are iterating locally, rebuild with `npm run build` after code changes and click the extension reload button in `chrome://extensions`.

## How To Use The Extension

After loading the extension, Better Bookmarks opens the dashboard on first install. You can also open the popup from the Chrome toolbar at any time.

- Use the popup when you want the fastest path to recent bookmarks and quick search.
- Use `Bookmarks` to browse your full bookmark tree, drag items across folders, multi-select ranges, and run right-click actions or AI on a bookmark, folder, or selection.
- Use `Discover` to review bookmarks one at a time, add notes or tags, rename them, and ask AI what to do with the current bookmark.
- Use `Reminders` to schedule follow-ups for links you want to revisit later.
- Use `Organize` to review suggestions based on your current bookmark tree and recent Chrome history.
- Use `Settings` to configure extension preferences, snapshots, and add an OpenAI API key if you want AI-powered actions.
- Use `AI Chat` after adding your API key if you want to search, rename, move, reorder, or create bookmark structures from natural-language prompts.

## Typical Workflow

1. Load the extension and let it read your existing bookmark tree.
2. Open `Bookmarks` to understand your current folder structure.
3. Use `Discover` to annotate high-value bookmarks with notes and tags.
4. Use `Organize` to review suggested cleanup and folder changes.
5. Add an OpenAI API key in `Settings` if you want to use `AI Chat`.
6. Use `Reminders` for links that should come back into your attention later.

## Tech Stack

- Chrome Extension Manifest V3
- React 19
- TypeScript
- Vite
- `@crxjs/vite-plugin`
- Zustand
- Tailwind CSS v4
