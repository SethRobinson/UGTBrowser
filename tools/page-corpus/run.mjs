// tools/page-corpus/run.mjs
// Page-compatibility harness for the selected-text features in contentScript.js.
//
// Drives headless Chrome over the DevTools protocol (no npm dependencies), injects
// probe.js + contentScript.js into an isolated world (as Chrome does for content
// scripts), makes real mouse selections, right-clicks, and replays the background's
// TRANSLATE_SELECTION / streaming flow with fake translations. No provider API is
// called and no keys are needed.
//
// Usage:
//   node tools/page-corpus/run.mjs [--only <url substring>] [--concurrency 3]
//     [--content-script <path>] [--out <dir>] [--chrome <path>] [--pages <json>]
// Results: <out>/results.json and <out>/summary.md (default out: local/page-corpus).

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function parseArgs(argv) {
  const args = {
    pages: join(here, 'pages.json'),
    out: join(repoRoot, 'local', 'page-corpus'),
    contentScript: join(repoRoot, 'contentScript.js'),
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    concurrency: 3,
    only: null,
    cases: null
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[++i];
    if (key === 'content-script') args.contentScript = resolve(value);
    else if (key === 'concurrency') args.concurrency = Number(value);
    else if (key === 'cases') args.cases = value.split(',');
    else args[key] = value;
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal CDP client ----------
class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.opened = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} ${msg.error.data || ''}`));
        else res(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); res(v); },
        reject: (e) => { clearTimeout(timer); rej(e); }
      });
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function launchChrome(chromePath) {
  const profileDir = mkdtempSync(join(tmpdir(), 'ugt-page-corpus-'));
  const proc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    // Several tabs run at once; keep the hidden ones from throttling timers.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--lang=en-US',
    '--window-size=1366,900',
    'about:blank'
  ], { stdio: 'ignore' });

  const portFile = join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port] = readFileSync(portFile, 'utf8').split('\n');
  return { proc, port, profileDir };
}

async function newPage(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.opened;
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Real content scripts are exempt from the page's CSP (including Trusted Types),
  // but a DevTools-created isolated world is not, so bypass it to match Chrome.
  await session.send('Page.setBypassCSP', { enabled: true });
  const { userAgent } = await session.send('Browser.getVersion');
  await session.send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome'), acceptLanguage: 'en-US,en;q=0.9,ja;q=0.8' });
  return { session, targetId: target.id };
}

// ---------- page helpers ----------
async function navigate(session, url) {
  let lastNavigation = Date.now();
  session.on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) lastNavigation = Date.now(); });
  const loaded = new Promise((res) => {
    const timer = setTimeout(res, 30000);
    session.on('Page.loadEventFired', () => { clearTimeout(timer); res(); });
  });
  await session.send('Page.navigate', { url });
  await loaded;
  await sleep(4000);
  // Some sites redirect or reload after load (locale or consent redirects), which
  // would destroy the isolated world; wait until the main frame stays put for 3s.
  const deadline = Date.now() + 20000;
  while (Date.now() - lastNavigation < 3000 && Date.now() < deadline) await sleep(250);
}

async function injectContentScript(session, probeSource, contentSource) {
  const { frameTree } = await session.send('Page.getFrameTree');
  const { executionContextId } = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: 'ugt-content-script',
    grantUniveralAccess: true
  });
  for (const [source, name] of [[probeSource, 'probe.js'], [contentSource, 'contentScript.js']]) {
    const result = await session.send('Runtime.evaluate', {
      expression: `${source}\n//# sourceURL=${name}`,
      contextId: executionContextId
    });
    if (result.exceptionDetails) {
      throw new Error(`${name} threw on injection: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
  }
  return executionContextId;
}

async function evalIn(session, contextId, expression) {
  const result = await session.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }, 90000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function mouse(session, type, x, y, extra = {}) {
  await session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
}

async function drag(session, start, end) {
  await mouse(session, 'mouseMoved', start.x, start.y, { button: 'none' });
  await mouse(session, 'mousePressed', start.x, start.y, { buttons: 1 });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await mouse(session, 'mouseMoved', start.x + (end.x - start.x) * i / steps, start.y + (end.y - start.y) * i / steps, { buttons: 1 });
    await sleep(15);
  }
  await mouse(session, 'mouseReleased', end.x, end.y, { buttons: 0 });
}

async function tripleClick(session, point) {
  for (let count = 1; count <= 3; count++) {
    await mouse(session, 'mousePressed', point.x, point.y, { clickCount: count, buttons: 1 });
    await mouse(session, 'mouseReleased', point.x, point.y, { clickCount: count, buttons: 0 });
  }
}

async function rightClick(session, point) {
  await mouse(session, 'mouseMoved', point.x, point.y, { button: 'none' });
  await mouse(session, 'mousePressed', point.x, point.y, { button: 'right', buttons: 2 });
  await mouse(session, 'mouseReleased', point.x, point.y, { button: 'right', buttons: 0 });
  // Headless has no native menu; dismiss nothing.
  await sleep(150);
}

// ---------- cases ----------
const CASES = {
  'drag-within': { pick: 'longest', mode: 'within', action: 'translate', simpleMode: false },
  'drag-multi': { pick: 'document', mode: 'multi', action: 'translate', simpleMode: true },
  'triple-click': { pick: 'longest', mode: 'within', action: 'translate', simpleMode: false, triple: true },
  'shadow-drag': { pick: 'shadow', mode: 'within', action: 'translate', simpleMode: false },
  'ask': { pick: 'longest', mode: 'within', action: 'ask' }
};

function orderCandidates(cands, pick) {
  const usable = cands.filter((c) => c.len >= 25);
  if (pick === 'longest') return usable.filter((c) => !c.inShadow && !c.inLink).sort((a, b) => b.len - a.len);
  if (pick === 'document') return usable.filter((c) => !c.inLink);
  if (pick === 'link') return usable.filter((c) => c.inLink && !c.inShadow);
  if (pick === 'shadow') return usable.filter((c) => c.inShadow).sort((a, b) => b.len - a.len);
  return usable;
}

// A page entry is a URL string, or { url, label, cases, scrollTo, ready, within } for content
// that loads lazily (scroll toward `scrollTo` until `ready` has text) and where
// selections must stay inside `within`.
async function preparePage(session, contextId, page) {
  if (!page.ready) return true;
  for (let i = 0; i < 60; i++) {
    if (await evalIn(session, contextId, `__ugtProbe.prepareStep(${JSON.stringify(page.scrollTo || null)}, ${JSON.stringify(page.ready)})`)) {
      await sleep(1500);
      return true;
    }
    await sleep(500);
  }
  return false;
}

// A page that navigates or reloads after injection destroys the isolated world;
// retry once in a fresh tab before reporting an error.
async function runCase(port, page, caseName, sources, shotDir) {
  const first = await runCaseOnce(port, page, caseName, sources, shotDir);
  if (first.status === 'error' && /Cannot find context|not of type 'Node'|CDP timeout/.test(first.reason || '')) {
    return { ...(await runCaseOnce(port, page, caseName, sources, shotDir)), retried: true };
  }
  return first;
}

async function saveScreenshot(session, shotDir, page, caseName) {
  shotDir = shotDir.dir;
  const host = page.url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
  const file = join(shotDir, `${host}${page.label ? `_${page.label}` : ''}_${caseName}.png`);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

async function runCaseOnce(port, page, caseName, sources, shotDir) {
  const url = page.url;
  const spec = CASES[caseName];
  const result = { url, case: caseName, status: 'pass', problems: [], warnings: [] };
  // Cut off or collapsed UI is a failure; "covered" can be a sticky header, so it only warns.
  const report = (message) => (/clipped-by|zero-size|hidden|not-connected/.test(message) ? result.problems : result.warnings).push(message);
  const { session, targetId } = await newPage(port);
  const exceptions = [];
  let contextId = null;
  session.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    if (contextId !== null && exceptionDetails.executionContextId === contextId) {
      exceptions.push((exceptionDetails.exception?.description || exceptionDetails.text || '').slice(0, 800));
    }
  });

  let navigatedDuringCase = false;
  try {
    await navigate(session, url);
    contextId = await injectContentScript(session, sources.probe, sources.content);
    session.on('Page.frameNavigated', ({ frame }) => { if (!frame.parentId) navigatedDuringCase = true; });
    if (!(await preparePage(session, contextId, page))) {
      return { ...result, status: 'error', reason: `lazy content never appeared: ${page.ready}` };
    }
    const cands = await evalIn(session, contextId, `__ugtProbe.listCandidates(${JSON.stringify(page.within || null)})`);
    const ordered = orderCandidates(cands, spec.pick);
    if (ordered.length === 0) {
      return { ...result, status: 'skip', reason: `no ${spec.pick} text candidates (page has ${cands.length})` };
    }

    let points = null;
    let chosen = null;
    let coveredBy = null;
    for (const cand of ordered.slice(0, 25)) {
      const candidatePoints = await evalIn(session, contextId, `__ugtProbe.dragPoints(${cand.i}, ${JSON.stringify(spec.mode)})`);
      if (!candidatePoints) continue;
      // Another element drawn over the text: a user could not drag there either.
      if (candidatePoints.startCovered) { coveredBy = coveredBy || candidatePoints.startCovered; continue; }
      points = candidatePoints;
      chosen = cand;
      break;
    }
    if (!points) {
      return { ...result, status: 'skip', reason: coveredBy ? `candidate text is covered (first by ${coveredBy})` : 'no candidate could be scrolled into a draggable position' };
    }
    result.sample = chosen.sample;
    result.inShadow = points.inShadow;
    await sleep(300);

    if (spec.triple) await tripleClick(session, points.start);
    else await drag(session, points.start, points.end);
    await sleep(200);
    const afterDrag = await evalIn(session, contextId, '__ugtProbe.selectionInfo()');
    if (!afterDrag.text.trim()) {
      return { ...result, status: 'skip', reason: 'mouse drag selected no text (page blocks selection)' };
    }
    await rightClick(session, spec.triple ? points.start : points.end);

    const selection = await evalIn(session, contextId, '__ugtProbe.selectionInfo()');
    if (!selection.text.trim()) {
      // Chrome reads the menu's selectionText at right-click time, so the extension
      // still receives it; continue with the text from before the right-click.
      result.warnings.push('page cleared the selection on right-click');
      selection.text = afterDrag.text;
    }
    result.selectionLength = selection.text.length;
    result.rescopedSelection = selection.rangeCollapsed;

    if (spec.action === 'ask') {
      await evalIn(session, contextId, `__ugtProbe.deliver({ type: 'ASK_ABOUT', text: ${JSON.stringify(selection.text)} })`);
      await sleep(600);
      const panel = await evalIn(session, contextId, `__ugtProbe.inspectPanel('.ugt-ask-container')`);
      result.panel = panel;
      if (!panel.ok) result.problems.push(`ask panel ${panel.reason}${panel.errorModal ? `: ${panel.errorModal}` : ''}`);
      else if (!panel.visible.ok) report(`ask panel not visible: ${panel.visible.reason}`);
      if (panel.insideLink) result.problems.push('ask panel inserted inside a link');
    } else {
      await evalIn(session, contextId, `__ugtProbe.setSimpleMode(${spec.simpleMode})`);
      await evalIn(session, contextId, `__ugtProbe.deliver({ type: 'TRANSLATE_SELECTION', requestId: 'harness', text: ${JSON.stringify(selection.text)}, settings: { provider: 'openai', targetLang: 'English' }, simpleMode: ${spec.simpleMode} })`);
      for (let i = 0; i < 200; i++) {
        if (await evalIn(session, contextId, '__ugtProbe.log.streamComplete')) break;
        await sleep(100);
      }
      await sleep(700);
      const log = await evalIn(session, contextId, '__ugtProbe.log');
      const inspect = await evalIn(session, contextId, `__ugtProbe.inspectTranslation(${JSON.stringify(selection.text)})`);
      result.inspect = inspect;
      result.segmentsRequested = log.segmentsRequested;

      if (!log.fetchPayload) {
        result.problems.push(`no translation request sent${inspect.errorModal ? ` (error shown: ${inspect.errorModal})` : ' and no error shown'}`);
      } else {
        if (!log.streamComplete) result.problems.push('stream did not complete');
        if (!log.overlay || !log.overlay.ok) result.warnings.push(`progress overlay: ${log.overlay ? log.overlay.reason : 'not checked'}`);
        if (inspect.translated < log.segmentsRequested) {
          result.problems.push(`only ${inspect.translated}/${log.segmentsRequested} segments show the translation (page re-render or lookup failure)`);
        }
        if (inspect.selectionCharsNotCovered > 3) {
          result.problems.push(`${inspect.selectionCharsNotCovered} selected characters were not sent for translation`);
        }
        if (inspect.badParents.length) result.problems.push(`segments inserted inside <${inspect.badParents.join('>, <')}>`);
        if (inspect.invisibleTranslated) result.warnings.push(`${inspect.invisibleTranslated} translated segments have no box (hidden text was translated)`);
        if (inspect.toggleButtons > 1) result.problems.push(`${inspect.toggleButtons} Show Original buttons for one translation`);
        if (inspect.toggleButtons === 1) {
          const toggle = await evalIn(session, contextId, '__ugtProbe.exerciseToggle()');
          result.toggle = toggle;
          if (!toggle.ok) result.problems.push(`Show Original toggle failed (original=${toggle.allOriginal}, back=${toggle.allTranslated})`);
          if (toggle.visible && !toggle.visible.ok) report(`toggle button not visible: ${toggle.visible.reason}`);
        } else if (inspect.toggleButtons === 0 && inspect.translated > 0) {
          result.warnings.push('no Show Original button after translation');
        }
        if (!spec.simpleMode) {
          if (inspect.notesPanels === 0) result.problems.push('notes panel not created');
          else if (inspect.notesVisible && !inspect.notesVisible.ok) report(`notes panel not visible: ${inspect.notesVisible.reason}`);
        }
      }
      if (log.listenerErrors.length) result.problems.push(...log.listenerErrors.map((e) => `listener threw: ${e.split('\n').slice(0, 3).join(' | ')}`));
      if (log.consoleErrors.length) result.warnings.push(...log.consoleErrors.slice(0, 3).map((e) => `console.error: ${e.slice(0, 200)}`));
    }

    if (exceptions.length) result.problems.push(...exceptions.map((e) => `uncaught: ${e.split('\n').slice(0, 3).join(' | ')}`));
    if (result.problems.length) result.status = 'fail';
    if (shotDir.all || result.problems.length || result.warnings.length) {
      result.screenshot = await saveScreenshot(session, shotDir, page, caseName).catch(() => null);
    }
    return result;
  } catch (error) {
    if (navigatedDuringCase) {
      // Clicking or dragging the chosen text followed a link or JS click handler;
      // a user selecting there would leave the page too.
      return { ...result, status: 'skip', reason: 'page navigated while selecting (text is inside a clickable element)' };
    }
    return { ...result, status: 'error', reason: String(error.message || error).slice(0, 400) };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
  }
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  // "fixture:<name>" entries are local regression pages in tools/page-corpus/fixtures.
  let pages = JSON.parse(readFileSync(args.pages, 'utf8'))
    .map((p) => (typeof p === 'string' ? { url: p } : p))
    .map((p) => (p.url.startsWith('fixture:') ? { ...p, url: pathToFileURL(join(here, 'fixtures', p.url.slice(8))).href } : p));
  if (args.only) pages = pages.filter((p) => p.url.includes(args.only));
  const caseNames = args.cases || Object.keys(CASES);
  const sources = {
    probe: readFileSync(join(here, 'probe.js'), 'utf8'),
    content: readFileSync(args.contentScript, 'utf8')
  };

  const shotDir = { dir: join(args.out, 'screenshots'), all: args.shots === 'all' };
  mkdirSync(shotDir.dir, { recursive: true });
  const { proc, port, profileDir } = await launchChrome(args.chrome);
  const jobs = pages.flatMap((page) => caseNames.filter((c) => !page.cases || page.cases.includes(c)).map((c) => [page, c]));
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [page, caseName] = jobs[next++];
      const url = page.label ? `${page.url} (${page.label})` : page.url;
      const r = { ...(await runCase(port, page, caseName, sources, shotDir)), url };
      results.push(r);
      const detail = r.problems?.length ? ` :: ${r.problems.join(' ; ')}` : (r.reason ? ` :: ${r.reason}` : '');
      console.log(`[${results.length}/${jobs.length}] ${r.status.toUpperCase().padEnd(5)} ${caseName.padEnd(12)} ${url}${detail}`);
    }
  };

  try {
    await Promise.all(Array.from({ length: args.concurrency }, worker));
  } finally {
    proc.kill();
    await sleep(500);
    if (profileDir.includes('ugt-page-corpus-')) {
      try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
    }
  }

  const pageOrder = pages.map((p) => (p.label ? `${p.url} (${p.label})` : p.url));
  results.sort((a, b) => pageOrder.indexOf(a.url) - pageOrder.indexOf(b.url) || caseNames.indexOf(a.case) - caseNames.indexOf(b.case));
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, 'results.json'), JSON.stringify(results, null, 2));
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const lines = [
    `# Page corpus results`,
    '',
    `Content script: ${args.contentScript}`,
    `Totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    '',
    '| Status | Case | URL | Details |',
    '|---|---|---|---|'
  ];
  for (const r of results) {
    const details = [...(r.problems || []), ...(r.warnings || []).map((w) => `warn: ${w}`), r.reason || ''].filter(Boolean).join('<br>');
    lines.push(`| ${r.status} | ${r.case} | ${r.url} | ${details.replace(/\|/g, '/')} |`);
  }
  writeFileSync(join(args.out, 'summary.md'), lines.join('\n'));
  console.log(`\nTotals: ${JSON.stringify(counts)}\nWrote ${join(args.out, 'summary.md')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
