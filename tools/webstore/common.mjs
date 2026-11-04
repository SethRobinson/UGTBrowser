// tools/webstore/common.mjs
// Shared helpers for the Chrome Web Store API v2 scripts. Credentials live in the
// git-ignored agents_secret.md (or environment variables) and are never printed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PUBLISHER_ID } from './publisher-id.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const secretFile = join(repoRoot, 'agents_secret.md');

// Not secrets: the store item and the publisher that owns it.
export const ITEM_ID = 'ccpaaggcacbmdbjhclgggndopoekjfkc';
export { DEFAULT_PUBLISHER_ID };
export const API_ROOT = 'https://chromewebstore.googleapis.com';
export const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const SECRET_NAMES = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID'];

export function readSecrets() {
  const text = existsSync(secretFile) ? readFileSync(secretFile, 'utf8') : '';
  const secrets = {};
  for (const name of SECRET_NAMES) {
    const match = text.match(new RegExp(`^\\s*${name}\\s*[=:]\\s*(\\S+)\\s*$`, 'm'));
    secrets[name] = process.env[name] || (match ? match[1].replace(/^['"]|['"]$/g, '') : '');
  }
  secrets.CWS_PUBLISHER_ID ||= DEFAULT_PUBLISHER_ID;
  return secrets;
}

// Replace NAME=... in agents_secret.md, or append it, leaving everything else as is.
export function writeSecret(name, value) {
  const text = existsSync(secretFile) ? readFileSync(secretFile, 'utf8') : '';
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^\\s*${name}\\s*[=:].*$`, 'm');
  const next = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, '')}\n\n${line}\n`;
  writeFileSync(secretFile, next);
}

export function redact(text, secrets) {
  let out = String(text);
  for (const value of Object.values(secrets)) {
    if (value && value.length > 8) out = out.split(value).join('[REDACTED]');
  }
  return out;
}

export function requireSecrets(secrets, names) {
  const missing = names.filter((name) => !secrets[name]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')} in agents_secret.md. See docs/webstore-publishing.md.`);
  }
}

export async function getAccessToken(secrets) {
  requireSecrets(secrets, ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.CWS_CLIENT_ID,
      client_secret: secrets.CWS_CLIENT_SECRET,
      refresh_token: secrets.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const hint = data.error === 'invalid_grant'
      ? ' The refresh token expired or was revoked (tokens from an OAuth app left in "Testing" expire after 7 days); run npm run webstore:token again.'
      : '';
    throw new Error(`Token refresh failed: ${data.error_description || data.error || response.status}.${hint}`);
  }
  return data.access_token;
}

export async function apiRequest(secrets, accessToken, method, path, { body, contentType } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(contentType ? { 'Content-Type': contentType } : {})
    },
    body
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data.error ? `${data.error.status || response.status}: ${data.error.message}` : `${response.status}: ${text.slice(0, 300)}`;
    const details = data.error && data.error.details ? `\n${JSON.stringify(data.error.details, null, 2)}` : '';
    throw new Error(redact(`${method} ${path} failed with ${message}${details}`, secrets));
  }
  return data;
}

export function itemPath(secrets) {
  return `publishers/${secrets.CWS_PUBLISHER_ID}/items/${ITEM_ID}`;
}
