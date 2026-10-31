// tools/webstore/get-refresh-token.mjs
// One-time OAuth sign-in for the Chrome Web Store API. Opens the Google consent
// page in the default browser, receives the code on a loopback redirect, and saves
// CWS_REFRESH_TOKEN into agents_secret.md. The token is never printed.
//
// Needs CWS_CLIENT_ID and CWS_CLIENT_SECRET (an OAuth client of type "Desktop app")
// in agents_secret.md. Usage: npm run webstore:token

import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

import { SCOPE, readSecrets, requireSecrets, writeSecret } from './common.mjs';

const secrets = readSecrets();
requireSecrets(secrets, ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET']);

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${server.address().port}/`;

const consentUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: secrets.CWS_CLIENT_ID,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state
});

const timeout = setTimeout(() => {
  console.error('No sign-in within 5 minutes; nothing was saved.');
  process.exit(1);
}, 5 * 60 * 1000);

server.on('request', async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }
  const finish = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
    clearTimeout(timeout);
    server.close();
  };
  if (url.searchParams.get('state') !== state) return finish(400, 'State mismatch; nothing was saved.');
  if (url.searchParams.get('error')) return finish(400, `Google returned: ${url.searchParams.get('error')}. Nothing was saved.`);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.CWS_CLIENT_ID,
      client_secret: secrets.CWS_CLIENT_SECRET,
      code: url.searchParams.get('code') || '',
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.refresh_token) {
    console.error(`Token exchange failed: ${data.error_description || data.error || 'no refresh token returned'}`);
    return finish(500, 'Token exchange failed; see the terminal. Nothing was saved.');
  }
  writeSecret('CWS_REFRESH_TOKEN', data.refresh_token);
  console.log('Saved CWS_REFRESH_TOKEN to agents_secret.md.');
  finish(200, 'UGTBrowser: Chrome Web Store access saved. You can close this tab.');
});

console.log('Opening the Google sign-in page in your default browser.');
console.log('Sign in with the account that owns UGTBrowser in the Chrome Web Store and allow access.');
console.log(`If no browser opens, visit:\n${consentUrl}\n`);
// "start" needs an empty title argument before a quoted URL.
spawn('cmd', ['/c', 'start', '""', consentUrl.replace(/&/g, '^&')], { stdio: 'ignore', detached: true }).unref();
