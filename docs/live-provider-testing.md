# Live provider testing

Regression testing for provider, model, API version, or request changes must include real API calls for every provider and model. `npm test` only checks request shapes; it cannot catch a parameter the live API rejects (for example `temperature` on GPT-6), a retired model ID, or a changed streaming event format.

## Running

```bash
npm run test:live
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/live-providers/run.mjs --only gpt-6
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/live-providers/run.mjs --skip-text
```

Options: `--only <provider or model substring>` (`image` and `tts` select those groups), `--skip-text`, `--skip-images`, `--skip-tts`, `--concurrency N` (default 4), `--out <dir>` (default `local/live-providers`, ignored by git). It writes `results.json`, `summary.md`, the translated images, and the TTS audio, and exits 1 if any case fails. A full run makes about 155 calls, takes a few minutes, and costs real credits (mostly the three image edits).

Keys come from `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_VOICE_ID`, or from the git-ignored `agents_secret.md`. Keys are redacted from error output. If every case for one provider fails with an authentication error, the key in `agents_secret.md` is stale; ask Seth to update the file rather than pasting keys into chat.

## What it covers

It imports the extension's own request code (`src/background/api/*`), so a run exercises exactly what the service worker sends:

- Every model in `providerModels` (OpenAI, Anthropic, Gemini): streaming translation with thinking off, streaming translation with thinking on when the toggle changes the request, non-streaming batch translation, and the follow-up chat stream. A translation passes only when the response contains a `<ugt_t1>` tagged segment with no remaining kana.
- Every image translation model (`imageTranslationModels`) through `editImageWithOpenAI` with the size from `chooseImageEditSize`, using `tools/live-providers/fixtures/sign.png` (a Japanese menu sign rendered from `sign.html`). Check the saved images by eye.
- Every ElevenLabs model listed in `options.html`.

Not covered: Google Cloud TTS (no key in `agents_secret.md`), and the offscreen `XMLHttpRequest` upload path (the Node run uses the equivalent `fetch` path with the same form fields).

## Testing in the installed extension

After changing anything under `src/background/`, press Reload for UGTBrowser on `chrome://extensions`. The settings page is loaded fresh from disk each time it opens, but the service worker keeps running the previous code until the extension is reloaded. A new settings page talking to an old worker produces errors such as the 2.3.0 report of `temperature does not support 0.1` for GPT-6 models.
