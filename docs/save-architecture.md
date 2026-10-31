# Identity and save providers

The game uses a provider-independent save service. It does not read local storage directly, handle OAuth tokens, or call the Drive API.

```text
game.js → SaveService → local storage adapter
                    → optional remote storage adapter

save menu → composition root → identity provider
                            → storage authorization
                            → optional export destination
```

## Contracts

An **identity provider** implements:

```js
getSession()                 // null or {provider, subject, displayName}
signIn(options)              // Promise<identity>
signOut()                    // Promise<void>
```

Identity is namespaced by provider. It is not a storage path, an OAuth token, or proof of identity for a future backend. A backend would need its own verified session. `GuestAuth` and `GoogleAuth` implement this contract.

A **storage provider** implements:

```js
id                           // stable provider name
label                        // player-facing label
read()                       // Promise<null | {state, revision}>
write(state, {expectedRevision}) // Promise<{revision}>
```

The revision is opaque to the game. A remote provider rejects stale writes with `SaveConflictError`. `BrowserStorage` additionally exposes synchronous `readLocal()` and `writeLocal(state)` because page teardown cannot reliably wait for a network request.

**Authorization** is a separate capability injected into providers that need it. The Drive adapter receives an object with `getAccessToken(scopes)`. It does not import `GoogleAuth`. Google currently supplies both identity and Drive authorization, but another identity source could coexist with Google Drive authorization. Additional providers are composed in `dist/platform/index.js`; economy code remains unchanged.

Visible export is a separate optional capability. A storage provider does not have to support it. The menu's download export requires no account or network connection. Both export destinations use the same JSON envelope.

## Save lifecycle

1. Load and validate the local save. Legacy raw PoC saves migrate transparently under the existing `hearthwater-v1` key.
2. Persist locally every five seconds, at milestones, and on page lifecycle events.
3. On an explicit cloud connection, read cloud progress without replacing either save.
4. If cloud progress exists, ask whether to continue it or replace it with this device's progress. Closing the choice leaves cloud sync detached.
5. Once attached, sync at milestones and every 30 seconds. Serialize writes within the active service instance.
6. On network errors, authorization expiry, or a detected revision conflict, pause cloud sync. Continue local play; reconnect explicitly to inspect cloud progress and resume.

The service snapshots state before each write. Late responses from a detached provider cannot update the new connection's revision. Local changes during a write are preserved and sent at the next sync.

Drive's metadata revision check detects intervening edits before upload and edits during reads. **It is not an atomic compare-and-swap transaction:** two devices writing at precisely the same time can still race, including creating duplicate files on first connection. Duplicate hidden saves are rejected rather than silently selected. Use one active device/tab at a time for now. Strong simultaneous-device guarantees would require a provider with conditional writes or server-side coordination.

## Portable save format

Exports contain `{format: 'commonwealth-save', schemaVersion: 1, exportedAt, state}`. State is validated and copied through an allowlist before use. Identity details, access tokens, and storage configuration are never exported. Imported journal text is escaped when displayed.

Imports require a preview and explicit replacement. When cloud storage is attached, the preview explains that the restored state will also replace the cloud save on the next sync. Keep a downloaded backup if retaining multiple timelines matters.

## Google setup

The local game and file download/import work without registration. For live Google access:

1. Create a Google Cloud project and enable the **Google Drive API**.
2. Configure Google Auth Platform branding, audience, and data access. Add test users while the app is in testing.
3. Create an OAuth client with application type **Web application**.
4. Add each exact **Authorized JavaScript origin**, including the local port when testing (for example, `http://localhost:8000`). Add the production origin separately. This uses Google's browser token flow, not a server redirect flow.
5. Set `googleClientId` in `dist/config.js` to the public client ID. Never put a client secret in the website.
6. Serve the game over localhost for development or HTTPS in production. Connect using a permitted test account, reload, reconnect, and verify the cloud save loads.
7. Complete Google's current publishing requirements before opening access beyond test users. These requirements depend on the app's audience and scopes.

The browser loads Google's Identity Services script only on deployments with a client ID. It requests `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive.appdata` when connecting hidden storage. A visible export requests `https://www.googleapis.com/auth/drive.file` incrementally. No broad Drive access is requested.

Automatic saves use `commonwealth-save.json` in `appDataFolder`. Visible exports create dated JSON files in the user's normal Drive. A Google account switch must be made by explicitly disconnecting/reconnecting, followed by the same save-choice flow.

Access tokens are kept in memory and expire. Reloading requires connecting again; a static client does not keep refresh tokens. Disconnecting clears the in-memory connection but does not delete Drive files or revoke the app's grant. Players can revoke that access from their Google account settings.

## Verification

Run `npm test` (Node.js, no installation required). Tests cover legacy migration, invalid imports, a non-Google provider, serialized writes, detached completions, local storage failure, paused cloud writes, Drive scope/folder separation, revision conflicts, token expiry, and account switching. Google calls are mocked; live OAuth requires the registration above.

Browser acceptance checks: load an existing local save; download it; import it and cancel once; confirm import; reload; connect Google and exercise both save choices; export visibly; expire/revoke access and confirm local play continues; reconnect from another device and verify offline production.
