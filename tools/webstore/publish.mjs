// tools/webstore/publish.mjs
// Chrome Web Store API v2 release helper for UGTBrowser.
//
//   npm run webstore -- status            Show the published and submitted versions.
//   npm run webstore -- upload [zip]      Upload dist/UGTBrowser-v<manifest version>.zip (or [zip]) as the draft.
//   npm run webstore -- submit            Submit the uploaded draft for review (publishes on approval).
//
// Upload and submit are separate on purpose: check the draft (status) before submitting.
// Credentials come from agents_secret.md; see docs/webstore-publishing.md.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { apiRequest, getAccessToken, itemPath, readSecrets, repoRoot } from './common.mjs';

const [command = 'status', zipArg] = process.argv.slice(2);
const secrets = readSecrets();

function describeRevision(label, revision) {
  if (!revision) return `${label}: none`;
  const channels = (revision.distributionChannels || [])
    .map((c) => `v${c.crxVersion}${c.deployPercentage !== undefined ? ` at ${c.deployPercentage}%` : ''}`)
    .join(', ');
  return `${label}: ${revision.state}${channels ? ` (${channels})` : ''}`;
}

async function fetchStatus(token) {
  return apiRequest(secrets, token, 'GET', `/v2/${itemPath(secrets)}:fetchStatus`);
}

function printStatus(status) {
  console.log(`Item ${status.itemId || ''}`);
  console.log(describeRevision('Published', status.publishedItemRevisionStatus));
  console.log(describeRevision('Submitted', status.submittedItemRevisionStatus));
  if (status.lastAsyncUploadState) console.log(`Last upload: ${status.lastAsyncUploadState}`);
  if (status.warned) console.log('WARNING: the item has a policy warning; check the developer dashboard.');
  if (status.takenDown) console.log('WARNING: the item is taken down for a policy violation.');
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function upload(token) {
  const manifestVersion = JSON.parse(readFileSync(join(repoRoot, 'manifest.json'), 'utf8')).version;
  const zipPath = zipArg || join(repoRoot, 'dist', `UGTBrowser-v${manifestVersion}.zip`);
  if (!existsSync(zipPath)) throw new Error(`${zipPath} not found; run npm run package first.`);

  const before = await fetchStatus(token);
  const published = before.publishedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion;
  if (published && compareVersions(manifestVersion, published) <= 0) {
    throw new Error(`manifest.json version ${manifestVersion} is not higher than the published ${published}; bump it first.`);
  }

  console.log(`Uploading ${zipPath} (manifest ${manifestVersion}; published ${published || 'none'})`);
  let result = await apiRequest(secrets, token, 'POST', `/upload/v2/${itemPath(secrets)}:upload?uploadType=media`, {
    body: readFileSync(zipPath),
    contentType: 'application/zip'
  });
  for (let i = 0; result.uploadState === 'IN_PROGRESS' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const status = await fetchStatus(token);
    result = { ...result, uploadState: status.lastAsyncUploadState };
  }
  console.log(`Upload state: ${result.uploadState}${result.crxVersion ? `, version ${result.crxVersion}` : ''}`);
  if (result.uploadState !== 'SUCCEEDED') {
    throw new Error('Upload did not succeed; check the Package tab in the developer dashboard for the reason.');
  }
}

async function submit(token) {
  const result = await apiRequest(secrets, token, 'POST', `/v2/${itemPath(secrets)}:publish`, {
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
    contentType: 'application/json'
  });
  console.log(`Submission state: ${result.state}`);
  for (const warning of result.warningInfo?.warnings || []) console.log(`Warning: ${JSON.stringify(warning)}`);
}

try {
  const token = await getAccessToken(secrets);
  if (command === 'upload') await upload(token);
  else if (command === 'submit') await submit(token);
  else if (command !== 'status') throw new Error(`Unknown command "${command}". Use status, upload, or submit.`);
  printStatus(await fetchStatus(token));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
