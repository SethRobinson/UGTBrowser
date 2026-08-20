// Single-use authorization for text translations initiated from the context menu.

export const TRANSLATION_AUTHORIZATION_TTL_MS = 60_000;

export class TranslationAuthorizationStore {
  constructor({
    ttlMs = TRANSLATION_AUTHORIZATION_TTL_MS,
    now = () => Date.now(),
    createId = () => `txt_${crypto.randomUUID()}`
  } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.createId = createId;
    this.pending = new Map();
  }

  issue({ tabId, frameId = 0, simpleMode = false }) {
    this.cleanup();
    const requestId = this.createId();
    this.pending.set(requestId, {
      requestId,
      tabId,
      frameId,
      simpleMode: Boolean(simpleMode),
      expiresAt: this.now() + this.ttlMs
    });
    return requestId;
  }

  consume(requestId, { tabId, frameId = 0 }) {
    const authorization = this.pending.get(requestId);
    if (!authorization) return null;

    if (authorization.expiresAt <= this.now()) {
      this.pending.delete(requestId);
      return null;
    }

    if (authorization.tabId !== tabId || authorization.frameId !== frameId) {
      return null;
    }

    this.pending.delete(requestId);
    return authorization;
  }

  revoke(requestId) {
    this.pending.delete(requestId);
  }

  cleanup() {
    const now = this.now();
    for (const [requestId, authorization] of this.pending) {
      if (authorization.expiresAt <= now) {
        this.pending.delete(requestId);
      }
    }
  }
}
