# Chrome Web Store publishing

Browser automation cannot drive the developer dashboard: Chromium (Chrome and Brave) blocks every extension, including Claude in Chrome, from reading, screenshotting, or clicking Web Store pages, and the Claude desktop browser pane cannot load them. Releases go through the Chrome Web Store API v2 instead, with `tools/webstore/`.

## Release

```bash
npm run package
npm run webstore -- status
npm run webstore -- upload
npm run webstore -- status
npm run webstore -- submit
```

- `upload` sends `dist/UGTBrowser-v<manifest version>.zip` (or a zip path given after `upload`) as the item's draft. It refuses to upload when `manifest.json` is not higher than the published version, which the store would reject anyway.
- `submit` calls `publish` with `DEFAULT_PUBLISH`: the draft goes to review and is published automatically once approved. It uses the item's existing visibility; if visibility was changed by hand in the dashboard, publish once by hand before the API can.
- Listing text, screenshots, and privacy fields are not changed by the API scripts; edit those in the dashboard.
- Submitting publishes to users after review, so only run `submit` when Seth has asked for the release.

Item ID `ccpaaggcacbmdbjhclgggndopoekjfkc` and publisher ID `752d04bb-b577-435f-b081-44244e00a3c5` (from the dashboard URL) are set in `tools/webstore/common.mjs`; `CWS_PUBLISHER_ID` in `agents_secret.md` overrides the publisher.

## One-time credential setup (done by Seth)

1. In the Google Cloud console, create or pick a project and enable the **Chrome Web Store API** (`chromewebstore.googleapis.com`).
2. In **Google Auth Platform**, set up the consent screen: audience **External**, any app name, your email as support contact. Then either add the account that owns UGTBrowser as a **test user**, or click **Publish app**. Refresh tokens from an app left in Testing expire after 7 days; a published personal app shows a "Google hasn't verified this app" warning at sign-in, which is expected for your own client.
3. Under **Clients**, create an OAuth client of type **Desktop app** and put its values in the git-ignored `agents_secret.md`:

   ```
   CWS_CLIENT_ID=...
   CWS_CLIENT_SECRET=...
   ```

4. The publishing Google account needs 2-step verification.
5. Run `npm run webstore:token`. It opens the Google sign-in in the default browser, receives the code on a `127.0.0.1` loopback redirect, and writes `CWS_REFRESH_TOKEN` to `agents_secret.md` without printing it. Run it again whenever a call reports `invalid_grant`.
