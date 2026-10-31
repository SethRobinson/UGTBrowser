// tools/live-providers/run.mjs
// Live regression test: calls every provider model in the catalog, every image
// translation model, and every ElevenLabs model through the extension's own
// request code (src/background/api/*). Costs real API credits.
//
// Usage:
//   npm run test:live
//   node tools/live-providers/run.mjs [--only <provider|model substring>] [--skip-text] [--skip-images] [--skip-tts]
//     [--concurrency 4] [--out local/live-providers]
//
// Keys come from environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY,
// GEMINI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID) or, failing that, from
// the git-ignored agents_secret.md in the repo root. Keys are never printed.
// Results: <out>/results.json, <out>/summary.md, image and audio outputs.
// Exit code 1 if any case fails.

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultImageTranslationPromptTemplate,
  imageTranslationModels,
  providerModels,
  unifiedDefaultPrompt
} from '../../src/shared/constants.js';
import { chooseImageEditSize, getReasoningEffort } from '../../src/shared/utils.js';
import {
  editImageWithOpenAI,
  fetchChatFromOpenAIStreaming,
  fetchFromOpenAI,
  fetchFromOpenAIStreaming
} from '../../src/background/api/openai.js';
import {
  buildAnthropicRequestBody,
  fetchChatFromAnthropicStreaming,
  fetchFromAnthropic,
  fetchFromAnthropicStreaming
} from '../../src/background/api/anthropic.js';
import {
  addThinkingConfig,
  fetchChatFromGeminiStreaming,
  fetchFromGemini,
  fetchFromGeminiStreaming,
  resolveGeminiModel
} from '../../src/background/api/gemini.js';
import { fetchFromElevenLabs } from '../../src/background/api/tts.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function parseArgs(argv) {
  const args = { only: null, skipText: false, skipImages: false, skipTts: false, concurrency: 4, out: join(repoRoot, 'local', 'live-providers') };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'skip-text') args.skipText = true;
    else if (key === 'skip-images') args.skipImages = true;
    else if (key === 'skip-tts') args.skipTts = true;
    else if (key === 'concurrency') args.concurrency = Number(argv[++i]);
    else args[key] = argv[++i];
  }
  return args;
}

// ---------- secrets ----------
function loadSecrets() {
  const secrets = {
    openai: process.env.OPENAI_API_KEY || '',
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    gemini: process.env.GEMINI_API_KEY || '',
    elevenlabs: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsVoice: process.env.ELEVENLABS_VOICE_ID || ''
  };
  const file = join(repoRoot, 'agents_secret.md');
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const read = (names) => {
      const match = text.match(new RegExp(`^\\s*(?:${names.join('|')})\\s*[=:]\\s*(\\S+)\\s*$`, 'mi'));
      return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
    };
    secrets.openai ||= read(['OPENAI_API_KEY', 'OpenAIKey']);
    secrets.anthropic ||= read(['ANTHROPIC_API_KEY', 'AnthropicKey']);
    secrets.gemini ||= read(['GEMINI_API_KEY', 'GeminiKey']);
    secrets.elevenlabs ||= read(['ELEVENLABS_API_KEY', 'ElevenLabsKey']);
    secrets.elevenlabsVoice ||= (text.match(/japanese female voice:\s*([A-Za-z0-9]{10,})/i) || [])[1] || '';
  }
  return secrets;
}

function redact(value, secrets) {
  let text = String((value && value.message) || value || 'Unknown error');
  for (const secret of Object.values(secrets)) {
    if (secret && secret.length > 8) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]').slice(0, 600);
}

// ---------- helpers ----------
const SOURCE_TEXT = '今日はいい天気ですね。散歩に行きましょう。';
const TRANSLATION_PROMPT = unifiedDefaultPrompt
  .replace('{{target}}', 'English')
  .replace('{{text}}', `<ugt_t1>${SOURCE_TEXT}</ugt_t1>`);
const CHAT_PROMPT = `You are helping a Japanese learner. In one short sentence, explain what "${SOURCE_TEXT}" means.`;

function settingsFor(provider, thinkingEnabled) {
  return { provider, [`${provider}ThinkingEnabled`]: thinkingEnabled };
}

// Does the thinking toggle change the request for this model? If so both shapes are tested.
function thinkingChangesRequest(provider, model) {
  if (provider === 'openai') return getReasoningEffort(model, true) !== getReasoningEffort(model, false);
  if (provider === 'anthropic') {
    const off = buildAnthropicRequestBody('x', model, { settings: settingsFor(provider, false) });
    const on = buildAnthropicRequestBody('x', model, { settings: settingsFor(provider, true) });
    return JSON.stringify(off) !== JSON.stringify(on);
  }
  const { modelId, thinkingLevel } = resolveGeminiModel(model);
  const off = {};
  const on = {};
  addThinkingConfig(off, modelId, thinkingLevel, false);
  addThinkingConfig(on, modelId, thinkingLevel, true);
  return JSON.stringify(off) !== JSON.stringify(on);
}

function fakePort(chunks) {
  return {
    postMessage(message) {
      if (message && message.type === 'STREAM_CHUNK' && typeof message.chunk === 'string') chunks.push(message.chunk);
    }
  };
}

async function withTimeout(operation, ms = 180000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms / 1000}s`));
    }, ms);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const streamFns = { openai: fetchFromOpenAIStreaming, anthropic: fetchFromAnthropicStreaming, gemini: fetchFromGeminiStreaming };
const chatFns = { openai: fetchChatFromOpenAIStreaming, anthropic: fetchChatFromAnthropicStreaming, gemini: fetchChatFromGeminiStreaming };
const batchFns = {
  openai: (prompt, model, key) => fetchFromOpenAI(prompt, model, key),
  anthropic: (prompt, model, key, settings) => fetchFromAnthropic(prompt, model, key, settings),
  gemini: (prompt, model, key) => fetchFromGemini(prompt, model, key)
};

function checkTranslation(text) {
  if (!text || !text.trim()) return 'empty response';
  if (/<ugt_status_gemini>\[(Error|Content blocked)/.test(text)) return `provider status: ${text.match(/<ugt_status_gemini>([^<]*)/)[1]}`;
  if (!/<ugt_t1>[\s\S]*\S[\s\S]*<\/ugt_t1>/.test(text)) return `missing <ugt_t1> tagged translation: ${JSON.stringify(text.slice(0, 160))}`;
  if (/[぀-ヿ]/.test(text.match(/<ugt_t1>([\s\S]*?)<\/ugt_t1>/)[1])) return `translation still contains Japanese kana: ${JSON.stringify(text.slice(0, 160))}`;
  return null;
}

// ---------- cases ----------
function textCases(only) {
  const cases = [];
  for (const [provider, models] of Object.entries(providerModels)) {
    for (const model of models) {
      if (only && !provider.includes(only) && !model.includes(only)) continue;
      cases.push({ kind: 'text', provider, model, path: 'translate-stream', thinking: false });
      if (thinkingChangesRequest(provider, model)) cases.push({ kind: 'text', provider, model, path: 'translate-stream', thinking: true });
      cases.push({ kind: 'text', provider, model, path: 'translate-batch', thinking: false });
      cases.push({ kind: 'text', provider, model, path: 'chat-stream', thinking: false });
    }
  }
  return cases;
}

async function runTextCase(c, secrets) {
  const key = secrets[c.provider];
  if (!key) return { status: 'skip', detail: `no ${c.provider} key` };
  const settings = settingsFor(c.provider, c.thinking);
  if (c.path === 'translate-stream') {
    const chunks = [];
    await withTimeout((signal) => streamFns[c.provider](TRANSLATION_PROMPT, c.model, key, fakePort(chunks), null, settings, signal));
    const text = chunks.join('');
    const problem = checkTranslation(text);
    return problem ? { status: 'fail', detail: problem } : { status: 'pass', detail: text.match(/<ugt_t1>([\s\S]*?)<\/ugt_t1>/)[1].trim().slice(0, 80) };
  }
  if (c.path === 'translate-batch') {
    const text = await withTimeout(() => batchFns[c.provider](TRANSLATION_PROMPT, c.model, key, settings));
    const problem = checkTranslation(text);
    return problem ? { status: 'fail', detail: problem } : { status: 'pass', detail: text.match(/<ugt_t1>([\s\S]*?)<\/ugt_t1>/)[1].trim().slice(0, 80) };
  }
  const chunks = [];
  await withTimeout((signal) => chatFns[c.provider](CHAT_PROMPT, c.model, key, (chunk) => chunks.push(chunk), settings, signal));
  const text = chunks.join('').trim();
  return text ? { status: 'pass', detail: text.slice(0, 80) } : { status: 'fail', detail: 'empty chat response' };
}

function readPngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function runImageCase(c, secrets, outDir) {
  if (!secrets.openai) return { status: 'skip', detail: 'no openai key' };
  const png = readFileSync(join(here, 'fixtures', 'sign.png'));
  const { width, height } = readPngSize(png);
  const size = chooseImageEditSize(width, height);
  const result = await withTimeout(() => editImageWithOpenAI({
    imageBlob: new Blob([png], { type: 'image/png' }),
    prompt: defaultImageTranslationPromptTemplate.replace(/\{\{target\}\}/g, 'English'),
    apiKey: secrets.openai,
    model: c.model,
    quality: 'low',
    size,
    outputFormat: 'png'
  }), 300000);
  const bytes = Buffer.from(result.base64Image, 'base64');
  if (bytes.length < 1000 || bytes.readUInt32BE(0) !== 0x89504e47) return { status: 'fail', detail: 'response is not a PNG' };
  const file = join(outDir, `image-${c.model}.png`);
  writeFileSync(file, bytes);
  const out = readPngSize(bytes);
  return { status: 'pass', detail: `requested ${size}, got ${out.width}x${out.height}, saved ${file}` };
}

async function runTtsCase(c, secrets, outDir) {
  if (!secrets.elevenlabs || !secrets.elevenlabsVoice) return { status: 'skip', detail: 'no ElevenLabs key or voice ID' };
  const base64 = await withTimeout(() => fetchFromElevenLabs('こんにちは。今日はいい天気ですね。', secrets.elevenlabsVoice, secrets.elevenlabs, c.model));
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 2000) return { status: 'fail', detail: `audio too small (${bytes.length} bytes)` };
  const file = join(outDir, `tts-${c.model}.mp3`);
  writeFileSync(file, bytes);
  return { status: 'pass', detail: `${bytes.length} bytes, saved ${file}` };
}

function elevenLabsModelsFromOptions() {
  const html = readFileSync(join(repoRoot, 'options.html'), 'utf8');
  const select = html.slice(html.indexOf('id="elevenlabsModel"'), html.indexOf('</select>', html.indexOf('id="elevenlabsModel"')));
  return [...select.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const secrets = loadSecrets();
  const outDir = args.out;
  mkdirSync(outDir, { recursive: true });

  const cases = args.skipText ? [] : textCases(args.only);
  if (!args.skipImages) {
    for (const model of imageTranslationModels) {
      if (!args.only || model.includes(args.only) || args.only === 'image') cases.push({ kind: 'image', provider: 'openai-image', model, path: 'image-edit' });
    }
  }
  if (!args.skipTts) {
    for (const model of elevenLabsModelsFromOptions()) {
      if (!args.only || model.includes(args.only) || args.only === 'tts') cases.push({ kind: 'tts', provider: 'elevenlabs', model, path: 'tts' });
    }
  }

  // Provider modules log heavily; keep the report readable.
  const quiet = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  const print = (line) => process.stdout.write(`${line}\n`);

  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      const started = Date.now();
      let outcome;
      try {
        if (c.kind === 'text') outcome = await runTextCase(c, secrets);
        else if (c.kind === 'image') outcome = await runImageCase(c, secrets, outDir);
        else outcome = await runTtsCase(c, secrets, outDir);
      } catch (error) {
        outcome = { status: 'fail', detail: redact(error, secrets) };
      }
      const r = { ...c, ...outcome, seconds: Math.round((Date.now() - started) / 100) / 10 };
      results.push(r);
      const label = `${c.provider} ${c.model} ${c.path}${c.thinking ? ' (thinking)' : ''}`;
      print(`[${results.length}/${cases.length}] ${r.status.toUpperCase().padEnd(4)} ${label.padEnd(58)} ${r.seconds}s  ${String(r.detail).replace(/\s+/g, ' ')}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: args.concurrency }, worker));
  } finally {
    Object.assign(console, quiet);
  }

  results.sort((a, b) => cases.indexOf(cases.find((c) => c.model === a.model && c.path === a.path && c.thinking === a.thinking)) -
    cases.indexOf(cases.find((c) => c.model === b.model && c.path === b.path && c.thinking === b.thinking)));
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const lines = ['# Live provider results', '', `Totals: ${JSON.stringify(counts)}`, '', '| Status | Provider | Model | Path | Seconds | Detail |', '|---|---|---|---|---|---|'];
  for (const r of results) {
    lines.push(`| ${r.status} | ${r.provider} | ${r.model} | ${r.path}${r.thinking ? ' (thinking)' : ''} | ${r.seconds} | ${String(r.detail).replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  }
  writeFileSync(join(outDir, 'summary.md'), lines.join('\n'));
  print(`\nTotals: ${JSON.stringify(counts)}\nWrote ${join(outDir, 'summary.md')}`);
  if (counts.fail) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
