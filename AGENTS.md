# AGENTS.md

Living developer notes for AI agents and contributors working on UGTBrowser.

This file should be updated whenever an agent or developer changes the project architecture, major flows, API integrations, permissions, packaging, or other details that future agents need to understand quickly. Treat it as the first place to record high-level context that would otherwise be rediscovered by reading the whole repo.

## Project Overview

UGTBrowser is a Chrome Manifest V3 browser extension for language tools on webpages. The main user workflow is right-clicking selected text and using AI providers to translate, create lessons, ask follow-up questions, or play text-to-speech. In the selected-text context menu, the plain `Translate to X with Y` entry is translate-only; the `Translate to X with Y (With Notes)` entry uses the configured custom instructions and enables follow-up notes/chat behavior. Context menus are initialized on install/update and Chrome startup.

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
11. The content script replaces the original image `src`/paint layer with the returned `data:image/png;base64,...` result and freezes the displayed dimensions to reduce layout shift. Some sites, notably X/Twitter, render the visible image on a sibling CSS `background-image` layer while keeping the real `<img>` transparent for browser image behavior; replacement must update that matching background layer too.
12. After a successful replacement, the content script keeps a compact collapsed action control on the image. Hovering/focusing/clicking it reveals magnifier and flip actions. The magnifier action opens the translated data URL in a normal Chrome window; the flip action toggles the page image between original and translated states, including X/Twitter CSS background layers.

Still-image translations are tracked by request ID and may have multiple OpenAI image edit jobs in flight at once. The background registers the clicked image target before waiting on storage/settings reads so quick consecutive image translations are less likely to bind to a later right-click target. For normal image elements, the content script locks one translated display size from the original rendered rect and restores the page's original inline sizing when the user flips back to the original image; avoid reintroducing logic that bases each flip on the current mutated rect.

Image translation errors should be visible to the user on the page. The content script keeps the inline failed overlay on the image when possible and also shows the normal UGTBrowser alert with the underlying error text. If the page/frame can no longer be reached, the background falls back to a Chrome notification instead of throwing after recording the debug error.

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
- Prompt: default template in `src/shared/constants.js` and `options.js`, with `{{target}}` replaced by the selected target language. The settings Image tab can override it via `chrome.storage.local.imageTranslationPromptTemplate`.
- Prompt constraints explicitly preserve numeric values, prices, currency units/symbols, measurements, and quantities, and tell the model not to overlap translated text with decorative rules, borders, icons, photos, hands, or other non-text graphics.

Known limitations:

- The first implementation supports images in the main page frame. Cross-frame image support would need additional frame-aware capture and coordinate handling.
- Full-image capture depends on browser access to the clicked image source or to a temporary direct source tab. When both are blocked, the fallback still translates only the visible screenshot crop.
- The result is generative image localization, so dense document text can still be imperfect.

## Video Frame Translation Feature

Video frame translation is a still-frame workflow, not live video translation. The context menu exposes `Translate video frame to X` on `video` and `page` contexts so direct HTML5 video right-clicks can work, and page-context fallback can select the largest visible/playing top-frame video when sites such as YouTube use custom player menus.

The feature intentionally avoids direct video stream access and does not add `tabCapture` or new host permissions. The background service worker uses the existing `activeTab`-compatible `chrome.tabs.captureVisibleTab` path after the content script temporarily hides UGT overlays and common YouTube player chrome/context menus. The content script crops the visible tab screenshot to the selected video rect, then pauses the video only after the screenshot crop succeeds. The cropped PNG is sent through the same offscreen OpenAI image-edit pipeline as still-image translation with a video-frame-specific prompt.

The translated result is rendered as a fixed-position still overlay on top of the paused video; the original video `src` is never replaced. The compact action control supports opening the translated frame, toggling translated/original frame visibility, and closing the overlay. Closing resumes playback only if UGTBrowser paused the video for this translation.

Relevant code:

- `src/shared/constants.js`: `CONTEXT_MENU_TRANSLATE_VIDEO_FRAME`
- `src/background/context-menus.js`: video frame menu title and visibility behavior
- `src/background/main.js`: `handleVideoFrameTranslateMenuClick`, video-frame prompt, screenshot capture handoff
- `contentScript.js`: video target tracking, YouTube UI hiding during capture, screenshot crop, pause/resume state, translated frame overlay/actions

## Storage And Keys

Provider keys are stored in `chrome.storage.local` by `options.js`. Existing key fields include:

- `openaiApiKey`
- `anthropicApiKey`
- `geminiApiKey`
- `elevenlabsApiKey`
- `googleTtsApiKey`
- `imageTranslationPromptTemplate`

Do not pass provider keys into page context. Keep provider requests in the background/service worker or another extension-owned context.

The settings UI separates `Text Translation LLM` from `API Keys`. The text provider/model controls choose the LLM for selected-text translation, notes, lessons, and follow-up chat. The API Keys section shows OpenAI, Anthropic, and Gemini credentials together so each key is entered once. Image and video-frame translation always use OpenAI image editing and require `openaiApiKey` regardless of the selected text provider.

The still-image translation prompt can be customized from the settings page's Image tab. The source default is duplicated in `options.js` and `src/shared/constants.js`; keep both copies synchronized. User customizations are stored only in `chrome.storage.local` under `imageTranslationPromptTemplate`, so they are not committed to the repo.

## Text Model Defaults

The model catalogs are duplicated in `options.js` and `src/shared/constants.js`; keep them synchronized.

Current text defaults:

- OpenAI defaults to `gpt-5.5`. `gpt-5.5`, GPT-5.4 variants, and `gpt-5.2-pro` use the OpenAI Responses API for text generation and streaming; older supported OpenAI text models remain on Chat Completions. Do not send `temperature` to `gpt-5.5` or GPT-5.4 variants.
- Anthropic defaults to `claude-sonnet-4-6`, with `claude-opus-4-8` selectable for higher-capability work. Do not send non-default sampling parameters such as `temperature` to `claude-opus-4-8`.
- Gemini defaults to `gemini-3.5-flash-medium`, shown in settings as `Gemini 3.5 Flash (Medium)`. The three Gemini 3.5 Flash dropdown entries use internal values `gemini-3.5-flash-low`, `gemini-3.5-flash-medium`, and `gemini-3.5-flash-high`; all normalize to the API model ID `gemini-3.5-flash` with `thinkingConfig.thinkingLevel` set to `low`, `medium`, or `high`. Do not send `temperature` to these entries. Older Gemini 2.5 and 3-series models still use the Gemini thinking checkbox.

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

## README Screenshot Refresh Workflow

Most README/store media is generated from deterministic local fixtures so screenshots can be refreshed without exposing provider keys. The image-translation before/after is the exception: its two photos must come from a real UGTBrowser image translation run so the README never shows a fake translated image. The current capture scaffolding lives under ignored `local/readme-capture/` in this workspace. If the folder is missing in a fresh checkout, recreate equivalent fixtures rather than using random live sites.

Fidelity rule (do not skip): a fixture is acceptable only when it reproduces the REAL UI - same markup, same labels, same styling the shipped extension actually renders - not a hand-drawn approximation. A screenshot that merely "looks like" the feature is a fake and will be rejected. Two concrete cases below: the settings shot loads the real `options.js` so the page renders itself; the translation-notes shot hardcodes the exact inline styles `contentScript.js` applies, because that UI is built in JS with no CSS file. Whenever `options.html`/`options.js`/`options.css` or the `contentScript.js` translation/notes/chat rendering changes, re-sync the corresponding fixture and re-capture.

ONE image set: the four `media/ugtbrowser_*.png` screenshots embedded in the README ARE the same four images uploaded to the Chrome Web Store. They are all exactly `1280x800`, 24-bit, no alpha, and are produced by `python local/readme-capture/generate_store_screenshots.py`. There is no separate store-only set. See "Chrome Web Store Screenshot Set" below for the strict format rules and how each is built.

Current README assets:

- `media/ugtbrowser_context_menu.png`: real native Chrome right-click menu over highlighted Japanese text, framed to 1280x800 by the store generator. It should show `UGTBrowser Language Tools` and the submenu options clearly. Do not use fabricated submenu icons; Chrome does not show icons on UGTBrowser child context-menu items. The raw full-resolution native capture (1850x695) is preserved at `local/readme-capture/context-menu-native-raw.png` and is the generator's source - keep it; if it is ever lost, a fresh native menu capture is required (see the capture steps below).
- `media/ugtbrowser_image_translation_compare.png`: 1280x800 before/after card for the README and Chrome Web Store. `build_compare()` in `generate_store_screenshots.py` crops the same fixed photo region (`PHOTO_CROP`) out of the two real capture frames (`frames-complex-real/social-mp4-first.png` original and `social-mp4-final.png` translated), lays them side by side with a red arrow, and fills the rest of the frame with title, BEFORE/AFTER labels and feature pills. It must use the real extension output, never the synthetic painted `demo-original.png`/`demo-translated.png` fixtures. If the source frames change size, re-check `PHOTO_CROP`.
- `media/ugtbrowser_translation_notes.png`: inline text translation with cultural notes and follow-up chat affordance. Captured from `local/readme-capture/text-translation-fixture.html`. The page chrome (browser bar, article) is illustrative, but the UGTBrowser-injected elements must match the REAL `contentScript.js` output exactly, because that UI is built with inline JS styles and has no CSS file. Mirror these from `contentScript.js`: translated text replaces the original IN PLACE with no highlight background; the toggle pill reads `⇄ Show Original` (`createToggleAllButton`); the notes panel is `.ugt-cultural-nuances` with a left blue border and `✕` close (`createCulturalNuancesContainer`); the notes body is `simpleMarkdownToHtml` output (headers become styled `div`s, not `<h3>`); the action row is `📋` copy + `↗` open-in-new-tab icon buttons (`createMessageActionButtons`), NOT text buttons; the chat row is an `Ask a follow-up question...` input plus a blue `Send` button (`createChatInterface`). To produce the final 1280x800 image: serve the repo, capture the fixture at 2x to `local/readme-capture/frames-v2/notes-2x.png` (`chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1080,900 --screenshot=...`), then run `generate_store_screenshots.py` (it trims and fills the frame width).
- `media/ugtbrowser_settings.png`: settings page focused on language, provider/model, thinking, and API key controls. This must be a REAL render of `options.html` + `options.js` + `options.css`, not a hand-drawn mockup. Capture it from `local/readme-capture/options-capture.html`, which embeds the real `options.html` markup, loads the actual `/options.js` and `/options.css`, and supplies a tiny `chrome.storage`/`chrome.runtime` shim (empty storage plus one fake masked OpenAI key) so the unmodified `options.js` runs and populates the model dropdown, defaults, prompt template, and thinking control exactly like the installed extension. To produce the final 1280x800 image: serve the repo, capture at 2x to `local/readme-capture/frames-v2/settings-2x.png` (`chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=840,1700 --virtual-time-budget=1500 --screenshot=...`), then run `generate_store_screenshots.py` (it trims and fills the frame width, showing header/tabs through the language picker). Keep the embedded markup in `options-capture.html` in sync with `options.html` whenever the settings page changes.

Recommended process when asked to "take new screenshots":

1. Update or recreate the local fixtures in `local/readme-capture/` to match current UI and copy. Keep fixtures deterministic and representative for normal screenshots. Before capturing, diff each fixture against the real source (`options.html`/`options.js` for settings, `contentScript.js` for translation notes, `context-menus.js` for the menu labels) and fix any drift - per the fidelity rule above, the fixture must reproduce the real UI, not approximate it. Headless capture uses the local Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` with `--headless=new`; Pillow handles cropping. No Playwright/Puppeteer is installed.
2. For the image-translation before/after, generate a fresh realistic source photo with an image-generation model and put the Japanese text directly in the generation prompt. Do not manually add, copy, warp, or perspective-map source or translated text afterward. The current example uses a street/cafe photo with an angled sign, shirt text, and an overhead banner so the result demonstrates in-situ text replacement on mixed photo content. The credit line on the compare card is added by `build_compare()`.
3. The image-translation before/after photos must come from the real extension workflow, not a manually overlaid translated frame. Open the real capture fixture in the Dalen Chrome profile, right-click the source image, choose `UGTBrowser Language Tools` -> `Translate image to English`, wait for the actual OpenAI image-edit result, and save fixed-crop screenshots of the real original and final states as `frames-complex-real/social-mp4-first.png` and `social-mp4-final.png` (the inputs to `build_compare()`).
4. Serve the repo locally with `python -m http.server 8765 --bind 127.0.0.1` from the repo root.
5. Capture fixtures in Chrome. For normal page fixtures, browser automation screenshots are fine. For browser-level context-menu imagery, use a real native Chrome/Windows context-menu capture from the Dalen Chrome profile. Stable Chrome no longer accepts `--load-extension` for this workflow, so use a disposable profile such as `local/readme-capture/dalen-chrome-profile-manual`, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select the repo root containing `manifest.json`. Verify Chrome actually loaded UGTBrowser by checking for a DevTools target like `chrome-extension://<id>/src/background/main.js`; default/component extension workers such as `service_worker.js` are not UGTBrowser. The ignored `local/readme-capture/native-context-menu-fixture.html` fixture auto-selects Japanese text on load; recreate an equivalent fixture if missing. Open it from the local server, right-click the selected text, hover `UGTBrowser Language Tools`, and capture the desktop/native menu. If using all-screen capture on a multi-monitor desktop, crop strictly to the Chrome window and native menus so VS Code status bars, terminals, taskbars, account info, or other private desktop data do not leak. Do not replace this with a styled HTML simulation unless the README explicitly labels it as a mockup.
6. Build the final 1280x800 set with `python local/readme-capture/generate_store_screenshots.py` (see "Chrome Web Store Screenshot Set" below).
7. Inspect every final asset visually with `view_image` before editing README. Check for clipped menu labels, hidden submenu options, stray black bars, text overflow, bad machine edits such as currency conversion, and text colliding with graphics.
8. Update README references and run `rg` checks so there are no stale references to removed media names.

## Chrome Web Store Screenshot Set

The four `media/ugtbrowser_*.png` screenshots serve double duty: the README embeds them AND they are uploaded to the Chrome Web Store. ONE set, so there is only one set to review. The store dashboard enforces STRICT format rules (uploads fail otherwise):

- Dimensions must be EXACTLY `1280x800` (preferred) or `640x400`. "At least this big" is not enough; off-by-one or any other size is rejected. The store downscales 1280x800 to 640x400 for display.
- Format: JPEG or 24-bit PNG with NO alpha channel (PNG color type 2, 8-bit). RGBA/indexed PNGs are rejected.
- Up to 5 images; at least 1 required (we ship 4).

Build/refresh all four with `python local/readme-capture/generate_store_screenshots.py`. It writes directly to the canonical `media/ugtbrowser_*.png` files and never touches its own inputs. First re-capture the two HTML fixtures at 2x to `local/readme-capture/frames-v2/{settings-2x,notes-2x}.png` (served repo, headless Chrome, `--force-device-scale-factor=2`) so the script has crisp sources. Sources the script reads (all preserved, never overwritten): `local/readme-capture/context-menu-native-raw.png`, the two `frames-complex-real/social-mp4-*.png`, and the two `frames-v2/*-2x.png`.

Key principle: FILL the 1280x800 frame with content rendered/composed natively at that size; do NOT scale a small source up into a big canvas or letterbox with dead bars. Always preserve aspect ratio (never stretch). How each is handled:

- `ugtbrowser_context_menu.png`: real native OS capture, ~2.66:1, so it genuinely cannot fill 1.6:1 without cutting a menu. Crop the empty left page and right margin to enlarge both menus, fill width, accept slim white bars top/bottom. This is the only one with unavoidable bars.
- `ugtbrowser_image_translation_compare.png`: composed natively at 1280x800 by `build_compare()`. The real capture frames are only 760x496, so the photo crops are ~513px wide -- keep them near 1:1 scale (crisp, side by side) and fill the rest of the frame with title, BEFORE/AFTER labels and a feature pill row, NOT with bars. If you ever want razor-sharp larger photos, re-capture the real image-translation run at higher resolution first.
- `ugtbrowser_translation_notes.png` / `ugtbrowser_settings.png`: 2x HTML-fixture captures scaled to fill the full 1280 width (downscale = crisp), then height cropped to 800. Settings shows header/tabs through the language picker; that is the high-impact region.

After generating, validate each file is exactly 1280x800 and its PNG IHDR is color type 2 / depth 8 (24-bit, no alpha) before uploading.

## Writing Style

Do not use em-dashes (or en-dashes used as em-dashes) anywhere: README, docs, commit messages, PRs, and on-image screenshot text. They read as AI-generated. Use a colon, a comma, parentheses, or two sentences instead.

## Agent Maintenance Rule

When an AI agent changes important behavior, update this file in the same change. Keep it concise, factual, and useful for the next agent. Do not let this become a changelog of tiny implementation details.

This project does not use the Claude file-based memory system. Record durable knowledge here in `AGENTS.md` so every AI tool (Claude, Cursor, Copilot, etc.) shares it.
