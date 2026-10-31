# Page corpus testing

`tools/page-corpus/` checks the selected-text features of `contentScript.js` (translate, Show Original toggle, notes panel, Ask panel) against real websites without calling any provider API.

## Running

```bash
npm run test:pages
node tools/page-corpus/run.mjs --only youtube --concurrency 2 --shots all
node tools/page-corpus/run.mjs --content-script path/to/old/contentScript.js --out local/page-corpus-old
```

Options: `--only <url substring>`, `--cases drag-within,ask`, `--concurrency N` (default 3), `--content-script <path>` (compare another build), `--shots all` (screenshot every case; by default only failures and warnings), `--out <dir>` (default `local/page-corpus`, ignored by git). Results land in `<out>/results.json`, `<out>/summary.md`, and `<out>/screenshots/`. A full run of the corpus takes about 15 minutes. Live sites change, so it is a manual check, not part of `npm test`.

## How it works

- `run.mjs` launches the local Chrome headless with a throwaway profile and drives it over the DevTools protocol with Node's built-in `WebSocket` (no npm dependencies).
- For each page and case it opens a fresh tab, creates an isolated world (like Chrome does for content scripts), and evaluates `probe.js` and then `contentScript.js` in it. `Page.setBypassCSP` is on because real content scripts are exempt from page CSP and Trusted Types, while a DevTools-created isolated world is not. Without it, every Trusted Types page (YouTube, Google sites) shows false `TrustedHTML` failures.
- `probe.js` stubs `chrome.runtime` (`onMessage`, `onConnect`, `sendMessage`), answers `FETCH_TRANSLATION` by replaying a fake `translation_stream` port (`[T] <original>` per segment plus a notes section), and exposes inspection helpers.
- Selections are made with real mouse events (`Input.dispatchMouseEvent`): a drag inside one text node, a drag across two blocks, a triple-click, a drag inside an open shadow root, and an Ask panel case. A right-click follows each, then the runner delivers `TRANSLATE_SELECTION` / `ASK_ABOUT` exactly as the background would.
- Checks: a request was sent; every segment shows the translation; no selected text was left out; no segment landed in `<script>`, `<style>`, `<noscript>`, `<template>`, `<textarea>`, `<title>`, or `<option>`; one working Show Original button; the notes and Ask panels are visible (cut off by a height-limited ancestor is a failure, covered by another element only a warning); no exceptions in the content script.

## Corpus

`tools/page-corpus/pages.json` lists URLs or objects:

- `{ "url": "fixture:regressions.html", "label", "within", "cases" }` runs a local page from `tools/page-corpus/fixtures/`. `regressions.html` reproduces each bug class found so far, and each case was confirmed to fail on a build without the matching fix and pass with it: a collapsed "Read more" comment (YouTube), a fixed-height card the notes panel outgrows only after its action and chat rows are added (CNN), a custom-scrollbar dialog whose `overflow:hidden` mask collapses if a panel is moved out of the scroller (NHK), a multi-line block whose page collapses the selection to a caret on right-click (YouTube comments), a shadow DOM description (Yahoo! Auctions), and inline `<style>` plus `display:none` text between paragraphs (Wikipedia, Amazon).
- `{ "url", "scrollTo", "ready", "within" }` handles lazy content: the runner scrolls toward `scrollTo` until `ready` matches text, and limits selections to `within` (used for YouTube comments).

## Known limitations

- Headless Chrome is bot-blocked or shown consent walls on some sites (for example NYTimes, MSN); those cases skip. Headless also fails to play some video, so players can show error text that normal Chrome never renders.
- Text covered by another element (card-wide link overlays, banners) is skipped, as is text whose click or drag navigates away; a user could not select it either.
- `scrollIntoView` in the probe also scrolls `overflow:hidden` boxes, so element and ancestor rectangles in a failure message can be offset from the page's normal layout.
- Sites that set `user-select: none` or have no selectable prose skip with a reason.
- Dragging that starts on a link begins a native link drag, so there is no link case; selections start in plain text.
- The fake stream never exercises provider-specific parsing; that is covered by `npm test`.
- To confirm a finding in the real extension (not the harness), load an unpacked build with `Extensions.loadUnpacked` over `--remote-debugging-pipe` with `--enable-unsafe-extension-debugging`, then send `TRANSLATE_SELECTION` from the extension's service worker target with `chrome.tabs.sendMessage`. The extension has no `tabs` permission, so pick the tab by ID rather than querying by URL.
