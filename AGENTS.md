# AGENTS.md

Living developer notes for AI agents and contributors working on UGTBrowser.

This file should be updated whenever an agent or developer changes the project architecture, major flows, API integrations, permissions, packaging, or other details that future agents need to understand quickly. Treat it as the first place to record high-level context that would otherwise be rediscovered by reading the whole repo.

## Project Overview

UGTBrowser is a Chrome Manifest V3 browser extension for language tools on webpages. The main user workflow is right-clicking selected text and using AI providers to translate, create lessons, ask follow-up questions, or play text-to-speech.

The extension intentionally uses direct browser APIs and direct provider HTTP requests. Do not add SDKs, MCP integrations, or framework dependencies unless there is a clear project-level reason and the owner approves it.

## Key Files

- `manifest.json`: MV3 permissions, host permissions, service worker, content script registration, and options page.
- `contentScript.js`: large page-side script. Handles selection translation UI, lesson/chat UI, TTS playback hooks, and image translation overlay/replacement.
- `src/background/main.js`: service worker entry point. Routes messages, handles context-menu clicks, orchestrates provider calls, and coordinates content script messages.
- `src/background/context-menus.js`: creates and updates context menu entries.
- `src/background/api/openai.js`: direct OpenAI HTTP calls for text and image operations.
- `src/background/api/anthropic.js`: direct Anthropic HTTP calls.
- `src/background/api/gemini.js`: direct Gemini HTTP calls.
- `src/background/api/tts.js`: direct ElevenLabs and Google TTS HTTP calls.
- `options.html`, `options.js`, `options.css`: settings UI and local storage for provider keys, models, target language, prompts, and TTS settings.
- `package-extension.js`: packages the extension into `dist/UGTBrowser-v<version>.zip`.

## Permissions Philosophy

Keep permissions minimal. The current image translation implementation was designed to avoid adding arbitrary image-host permissions:

- Existing `activeTab` is used to capture the visible tab after a user gesture.
- Existing `https://api.openai.com/*` host permission is used for direct OpenAI image edit requests.
- The page content script first tries browser-allowed full image reads. If an embedded page blocks that read, the background may briefly open the image source URL in an inactive tab so the content script can read it same-origin, then close that tab. Screenshot cropping remains the final fallback to avoid cross-origin canvas taint and new image-host permissions.
- The OpenAI API key stays in extension-owned contexts (background/service worker and offscreen document) and is not exposed to page JavaScript.

Avoid adding new permissions unless the feature cannot be implemented with existing permissions.

## Image Translation Feature

Image translation was added as a right-click image workflow:

1. `src/background/context-menus.js` creates `Translate image to X` for the `image` context.
2. `contentScript.js` listens for the page `contextmenu` event and remembers the exact `<img>` element that was clicked.
3. `src/background/main.js` handles `CONTEXT_MENU_TRANSLATE_IMAGE`.
4. The background service worker asks the content script for the target image geometry.
5. The content script displays an animated processing overlay on the image and first attempts to read the full image data from the clicked image source.
6. If embedded-page full image access is blocked by browser/CORS rules, the background service worker opens the image source URL in an inactive temporary tab, asks that tab's content script to read the image same-origin, and closes the tab.
7. If the temporary source-tab read also fails, the background service worker falls back to `chrome.tabs.captureVisibleTab` under the user gesture and the content script crops the visible image region from that screenshot.
8. The background service worker sends the prepared PNG data URL to the extension offscreen document and returns from the context-menu handler instead of waiting on the long provider request.
9. The offscreen document converts the data URL to a PNG blob and sends the direct OpenAI `XMLHttpRequest`/`FormData` request to `/v1/images/edits` so upload progress can be reported.
10. The offscreen document sends completion or error back to the background service worker, which forwards the result to the original content-script frame.
11. The content script replaces the original image `src` with the returned `data:image/png;base64,...` result and freezes the displayed dimensions to reduce layout shift. Some sites, notably X/Twitter, render the visible image on a sibling CSS `background-image` layer while keeping the real `<img>` transparent for browser image behavior; replacement must update that matching background layer too.

Relevant code:

- `src/shared/constants.js`: `CONTEXT_MENU_TRANSLATE_IMAGE`
- `src/background/context-menus.js`: `buildImageTranslateTitle`, dynamic hiding of text/link tools on image contexts
- `src/background/api/openai.js`: `editImageWithOpenAI`
- `src/background/main.js`: `handleImageTranslateMenuClick`, `chooseImageEditSize`
- `src/background/offscreen-manager.js`, `offscreen.js`: long-running image edit handoff, upload progress, and completion/error relay
- `contentScript.js`: image target tracking, full-image read/fallback crop, overlay animation/progress, replacement, and X/Twitter-style CSS background image layer handling

Current image edit defaults:

- Model: `gpt-image-2`
- Quality: `low`
- Output format: `png`
- Size: chosen dynamically by `chooseImageEditSize` near the minimum legal pixel budget while preserving the clicked image aspect ratio.

Known limitations:

- The first implementation supports images in the main page frame. Cross-frame image support would need additional frame-aware capture and coordinate handling.
- Full-image capture depends on browser access to the clicked image source or to a temporary direct source tab. When both are blocked, the fallback still translates only the visible screenshot crop.
- The result is generative image localization, so dense document text can still be imperfect.

## Storage And Keys

Provider keys are stored in `chrome.storage.local` by `options.js`. Existing key fields include:

- `openaiApiKey`
- `anthropicApiKey`
- `geminiApiKey`
- `elevenlabsApiKey`
- `googleTtsApiKey`

Do not pass provider keys into page context. Keep provider requests in the background/service worker or another extension-owned context.

## Text Model Defaults

The model catalogs are duplicated in `options.js` and `src/shared/constants.js`; keep them synchronized.

Current text defaults:

- OpenAI defaults to `gpt-5.5`. `gpt-5.5`, GPT-5.4 variants, and `gpt-5.2-pro` use the OpenAI Responses API for text generation and streaming; older supported OpenAI text models remain on Chat Completions. Do not send `temperature` to `gpt-5.5` or GPT-5.4 variants.
- Anthropic defaults to `claude-sonnet-4-6`, with `claude-opus-4-8` selectable for higher-capability work. Do not send non-default sampling parameters such as `temperature` to `claude-opus-4-8`.

## Build And Smoke Checks

Useful checks after edits:

```bash
node --check contentScript.js
node --check options.js
node --check src/shared/constants.js
node --check src/shared/utils.js
node --check src/background/main.js
node --check src/background/context-menus.js
node --check src/background/api/openai.js
node --check src/background/api/anthropic.js
npm run package
```

The package command writes a zip under `dist/`.

## Agent Maintenance Rule

When an AI agent changes important behavior, update this file in the same change. Keep it concise, factual, and useful for the next agent. Do not let this become a changelog of tiny implementation details.
