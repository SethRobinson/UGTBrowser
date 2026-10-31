// tools/page-corpus/probe.js
// Evaluated by run.mjs in the same isolated world as contentScript.js, BEFORE the
// content script. It stubs the chrome.runtime surface the content script uses,
// fakes the background's streaming translation, and exposes helpers the runner
// calls to pick selections and inspect the result. No provider API is called.
(() => {
  if (window.__ugtProbe) return;

  const log = {
    sentMessages: [],
    consoleErrors: [],
    listenerErrors: [],
    fetchPayload: null,
    segmentsRequested: 0,
    overlay: null,
    streamComplete: false
  };

  const messageListeners = [];
  const connectListeners = [];
  const SEGMENT_DELIMITER = '\n<<<UGT_SEG>>>\n';
  const NOTES_TEXT = '### Notes\nThis is a fake cultural note from the page-corpus harness.';

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    log.consoleErrors.push(args.map((a) => (a && a.stack) || String(a)).join(' ').slice(0, 500));
    originalConsoleError(...args);
  };

  function safeCall(fn, ...args) {
    try {
      return fn(...args);
    } catch (error) {
      log.listenerErrors.push(String((error && error.stack) || error).slice(0, 800));
      return undefined;
    }
  }

  function deepQueryAll(selector, root = document, out = []) {
    out.push(...root.querySelectorAll(selector));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out);
    }
    return out;
  }

  function findOverlay() {
    return [...document.querySelectorAll('body > div')].find((el) =>
      el.style.position === 'fixed' && /^Streaming from/.test(el.textContent || ''));
  }

  function findErrorModal() {
    return [...document.querySelectorAll('body > div')].find((el) =>
      el.style.position === 'fixed' && (el.style.background || '').includes('200, 0, 0'));
  }

  // "Visible to the user": has a box, is inside the viewport after scrolling it
  // into view, is not clipped by an overflow ancestor, and is the topmost element
  // at its own center.
  function visibility(el) {
    if (!el || !el.isConnected) return { ok: false, reason: 'not-connected' };
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return { ok: false, reason: `zero-size ${Math.round(rect.width)}x${Math.round(rect.height)}` };
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
      return { ok: false, reason: 'hidden-style' };
    }
    let node = el.parentElement || el.getRootNode().host;
    while (node && node !== document.documentElement) {
      const ns = getComputedStyle(node);
      // Only an axis whose overflow is hidden/clip cuts content off; a scrolling
      // axis is still reachable.
      const clipsY = /(hidden|clip)/.test(ns.overflowY);
      const clipsX = /(hidden|clip)/.test(ns.overflowX);
      if (clipsX || clipsY) {
        const nr = node.getBoundingClientRect();
        const clipped = (clipsY && (rect.top < nr.top - 2 || rect.bottom > nr.bottom + 2)) ||
          (clipsX && (rect.left < nr.left - 2 || rect.right > nr.right + 2));
        if (clipped) {
          const box = (r) => `${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`;
          return { ok: false, reason: `clipped-by <${node.tagName.toLowerCase()} class="${String(node.className).slice(0, 60)}"> (element ${box(rect)}, clip box ${box(nr)})` };
        }
      }
      if (ns.display === 'none' || ns.visibility === 'hidden') return { ok: false, reason: 'ancestor-hidden' };
      node = node.parentElement || (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
    }
    const cx = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 40), 1), innerWidth - 2);
    const cy = Math.min(Math.max(rect.top + Math.min(rect.height / 2, 20), 1), innerHeight - 2);
    let hit = document.elementFromPoint(cx, cy);
    while (hit && hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(cx, cy);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    const inside = hit && (hit === el || el.contains(hit) || (hit.getRootNode && el.contains(hit.getRootNode().host)));
    if (rect.top >= 0 && rect.top < innerHeight && !inside) {
      return { ok: false, reason: `covered-by <${hit ? hit.tagName.toLowerCase() : 'none'} class="${hit ? String(hit.className).slice(0, 60) : ''}">` };
    }
    return { ok: true };
  }

  // ----- chrome.runtime stub -----
  function makePort() {
    const portMessageListeners = [];
    const disconnectListeners = [];
    const port = {
      name: 'translation_stream',
      onMessage: { addListener: (fn) => portMessageListeners.push(fn), removeListener() {} },
      onDisconnect: { addListener: (fn) => disconnectListeners.push(fn), removeListener() {} },
      postMessage: (msg) => {
        if (msg && msg.type === 'HEARTBEAT') {
          setTimeout(() => portMessageListeners.forEach((fn) => safeCall(fn, { type: 'HEARTBEAT_RESPONSE', timestamp: Date.now() })), 0);
        }
      },
      disconnect: () => {},
      deliver: (msg) => portMessageListeners.forEach((fn) => safeCall(fn, msg))
    };
    return port;
  }

  function simulateStream(textPayload, simpleMode) {
    const segments = textPayload.split(SEGMENT_DELIMITER).map((segment) => {
      const match = segment.match(/^(ugt_[^:]+):\s*([\s\S]*)$/);
      return match ? { id: match[1], text: match[2].trim() } : null;
    }).filter(Boolean);
    log.segmentsRequested = segments.length;

    const port = makePort();
    connectListeners.forEach((fn) => safeCall(fn, port));

    // Split the stream mid-tag to exercise the partial-buffer parsing (at most ~40 chunks).
    let stream = segments.map((s) => `<${s.id}>[T] ${s.text}</${s.id}>`).join('\n');
    if (!simpleMode) stream += `\n\n${NOTES_TEXT}`;
    const chunkSize = Math.max(37, Math.ceil(stream.length / 40));
    const chunks = [];
    for (let i = 0; i < stream.length; i += chunkSize) chunks.push(stream.slice(i, i + chunkSize));

    let index = 0;
    const step = () => {
      if (index === 1) {
        const overlay = findOverlay();
        log.overlay = overlay ? visibility(overlay) : { ok: false, reason: 'not-shown' };
      }
      if (index < chunks.length) {
        port.deliver({ type: 'STREAM_CHUNK', chunk: chunks[index++] });
        setTimeout(step, 5);
      } else {
        port.deliver({ type: 'STREAM_COMPLETE', success: true, simpleMode: !!simpleMode });
        log.streamComplete = true;
      }
    };
    setTimeout(step, 20);
  }

  let pendingSimpleMode = false;

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: 'ugt-page-corpus-harness',
    lastError: undefined,
    getURL: (path) => `chrome-extension://ugt-page-corpus-harness/${path}`,
    onMessage: { addListener: (fn) => messageListeners.push(fn), removeListener() {} },
    onConnect: { addListener: (fn) => connectListeners.push(fn), removeListener() {} },
    sendMessage: (message, callback) => {
      log.sentMessages.push(message && message.type);
      let response;
      if (message && message.type === 'FETCH_TRANSLATION') {
        log.fetchPayload = message.payload && message.payload.textPayload;
        response = { status: 'streaming_started' };
        setTimeout(() => simulateStream(log.fetchPayload || '', pendingSimpleMode), 0);
      }
      if (typeof callback === 'function') setTimeout(() => safeCall(callback, response), 0);
      return Promise.resolve(response);
    },
    connect: () => makePort()
  };

  // ----- helpers called by run.mjs -----
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'SVG', 'CODE', 'PRE']);
  let candidates = [];

  function blockOf(node) {
    // Text directly under a shadow root has no parentElement; start at the host.
    let el = node.parentElement || (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null);
    while (el) {
      const d = getComputedStyle(el).display;
      if (d !== 'inline' && d !== 'contents' && !d.startsWith('inline')) return el;
      el = el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);
    }
    return document.body;
  }

  function collectTextNodes(root, inShadow, out) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.shadowRoot) collectTextNodes(node.shadowRoot, true, out);
        continue;
      }
      const text = node.nodeValue.trim();
      if (text.length < 20) continue;
      const parent = node.parentElement || node.getRootNode().host;
      if (!parent || parent.closest('[contenteditable=""],[contenteditable="true"]')) continue;
      let skip = false;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName.toUpperCase())) { skip = true; break; }
      }
      if (skip) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 8) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden' || style.userSelect === 'none' || Number(style.opacity) === 0) continue;
      out.push({ node, inShadow, inLink: !!parent.closest('a'), top: rect.top + scrollY });
    }
    return out;
  }

  window.__ugtProbe = {
    log,
    setSimpleMode(value) { pendingSimpleMode = !!value; },

    // within: optional selector; only text inside a matching element is used
    // (for example YouTube comment threads).
    listCandidates(within) {
      candidates = collectTextNodes(document.body, false, []);
      if (within) {
        candidates = candidates.filter((c) => {
          for (let el = c.node.parentElement || c.node.parentNode.host; el; el = el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null)) {
            if (el.matches(within)) return true;
          }
          return false;
        });
      }
      return candidates.map((c, i) => ({
        i, inShadow: c.inShadow, inLink: c.inLink, len: c.node.nodeValue.trim().length,
        sample: c.node.nodeValue.trim().slice(0, 40)
      }));
    },

    // Scroll the candidate to the viewport middle and return drag endpoints.
    // mode "within": inside one text node. mode "multi": into a later block.
    dragPoints(i, mode) {
      const cand = candidates[i];
      if (!cand || !cand.node.isConnected) return null;
      const block = blockOf(cand.node);
      block.scrollIntoView({ block: 'center', behavior: 'instant' });
      const text = cand.node.nodeValue;
      const firstChar = text.search(/\S/);
      const r0 = document.createRange();
      r0.setStart(cand.node, firstChar);
      r0.setEnd(cand.node, firstChar + 1);
      const startRect = r0.getClientRects()[0];
      if (!startRect) return null;

      let endNode = cand.node;
      let endOffset = Math.min(text.length, firstChar + Math.max(8, Math.floor(text.trim().length * 0.6)));
      if (mode === 'multi') {
        const next = candidates.slice(i + 1).find((c) => blockOf(c.node) !== block && c.node.isConnected &&
          Math.abs(c.top - cand.top) < 350 && c.inShadow === cand.inShadow);
        if (!next) return null;
        endNode = next.node;
        const t = next.node.nodeValue;
        endOffset = Math.min(t.length, t.search(/\S/) + Math.floor(t.trim().length / 2));
      }
      const r1 = document.createRange();
      r1.setStart(endNode, Math.max(0, endOffset - 1));
      r1.setEnd(endNode, endOffset);
      const endRects = r1.getClientRects();
      const endRect = endRects[endRects.length - 1];
      if (!endRect) return null;
      const inView = (r) => r.top > 0 && r.bottom < innerHeight && r.left >= 0 && r.right <= innerWidth;
      if (!inView(startRect) || !inView(endRect)) return null;
      return {
        start: { x: startRect.left + 1, y: startRect.top + startRect.height / 2 },
        end: { x: endRect.right - 1, y: endRect.top + endRect.height / 2 },
        inShadow: cand.inShadow,
        inLink: cand.inLink,
        // Something outside the paragraph (cookie banner, sticky header, card-wide
        // link overlay) drawn over the drag start. Inline neighbors such as padded
        // <code> in the same block are fine.
        startCovered: (() => {
          const x = startRect.left + 1;
          const y = startRect.top + startRect.height / 2;
          let hit = document.elementFromPoint(x, y);
          while (hit && hit.shadowRoot) {
            const inner = hit.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === hit) break;
            hit = inner;
          }
          const owner = block;
          if (hit && (hit === owner || owner.contains(hit) || hit.contains(owner))) return null;
          return hit ? `<${hit.tagName.toLowerCase()} class="${String(hit.className).slice(0, 50)}">` : 'nothing';
        })()
      };
    },

    // Scroll toward a lazily loaded section until `ready` matches visible text.
    // Returns true once ready.
    prepareStep(scrollTo, ready) {
      const readyEl = deepQueryAll(ready).find((el) => (el.textContent || '').trim().length > 0);
      if (readyEl) return true;
      const target = scrollTo ? deepQueryAll(scrollTo)[0] : null;
      if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
      else window.scrollBy(0, 600);
      return false;
    },

    selectionInfo() {
      const sel = document.getSelection();
      const text = sel ? sel.toString() : '';
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      return { text, rangeCollapsed: range ? range.collapsed : null };
    },

    deliver(message) {
      messageListeners.forEach((fn) => safeCall(fn, message, { id: 'ugt-page-corpus-harness' }, () => {}));
    },

    inspectTranslation(selectionText) {
      const segments = deepQueryAll('span.ugt-translation-segment');
      // The content script may prepend a space to keep words apart, so match anywhere.
      const translated = segments.filter((s) => (s.textContent || '').includes('[T]'));
      // Elements whose text is code, config, or form state, never visible prose.
      const NEVER_TRANSLATE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE', 'OPTION']);
      const badParents = segments.filter((s) => s.parentElement && NEVER_TRANSLATE.has(s.parentElement.tagName.toUpperCase()))
        .map((s) => s.parentElement.tagName.toLowerCase());
      const invisible = translated.filter((s) => {
        const r = s.getBoundingClientRect();
        return r.width === 0 && r.height === 0;
      }).length;
      // Selection.toString() applies CSS text-transform (uppercase headings), so compare case-insensitively.
      const norm = (t) => t.replace(/\s+/g, '').toLowerCase();
      const originals = norm(segments.map((s) => s.getAttribute('data-original-text') || '').join(''));
      const selected = norm(selectionText);
      const missing = [...selected].filter((ch) => !originals.includes(ch)).length;
      const toggles = deepQueryAll('.ugt-toggle-all-btn');
      const notes = deepQueryAll('.ugt-cultural-nuances');
      const errorModal = findErrorModal();
      return {
        segments: segments.length,
        translated: translated.length,
        invisibleTranslated: invisible,
        badParents: [...new Set(badParents)],
        selectionCharsNotCovered: missing,
        toggleButtons: toggles.length,
        notesPanels: notes.length,
        notesVisible: notes[0] ? (notes[0].scrollIntoView({ block: 'center', behavior: 'instant' }), visibility(notes[0])) : null,
        errorModal: errorModal ? (errorModal.textContent || '').slice(0, 200) : null
      };
    },

    exerciseToggle() {
      const btn = deepQueryAll('.ugt-toggle-all-btn')[0];
      if (!btn) return { ok: false, reason: 'no-toggle-button' };
      btn.scrollIntoView({ block: 'center', behavior: 'instant' });
      const vis = visibility(btn);
      const segs = () => deepQueryAll('span.ugt-translation-segment');
      safeCall(() => btn.click());
      const allOriginal = segs().every((s) => s.textContent === s.getAttribute('data-original-text'));
      safeCall(() => btn.click());
      const allTranslated = segs().every((s) => (s.textContent || '').includes('[T]') || s.textContent === s.getAttribute('data-original-text'));
      return { ok: allOriginal && allTranslated, visible: vis, allOriginal, allTranslated };
    },

    inspectPanel(selector) {
      const panel = deepQueryAll(selector)[0];
      if (!panel) return { ok: false, reason: 'not-inserted', errorModal: findErrorModal() ? findErrorModal().textContent.slice(0, 200) : null };
      panel.scrollIntoView({ block: 'center', behavior: 'instant' });
      const inShadow = panel.getRootNode() instanceof ShadowRoot;
      return { ok: true, inShadow, visible: visibility(panel), insideLink: !!panel.closest('a') };
    }
  };
})();
