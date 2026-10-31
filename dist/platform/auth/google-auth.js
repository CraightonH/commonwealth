let sdkPromise;
export function loadGoogleSDK() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google.accounts.oauth2);
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => resolve(globalThis.google.accounts.oauth2);
    script.onerror = () => { script.remove(); sdkPromise = null; reject(new Error('Could not load Google sign-in. Please try again.')); };
    document.head.append(script);
  });
  return sdkPromise;
}

// Identity and authorization are separate capabilities, even when Google supplies both.
// Tokens live only in this instance's memory; they are never part of a save file.
export class GoogleAuth {
  id = 'google';
  constructor({ clientId, loadSDK = loadGoogleSDK, fetcher = globalThis.fetch }) {
    this.clientId = clientId; this.loadSDK = loadSDK; this.fetcher = fetcher;
    this.session = null; this.token = null; this.expiresAt = 0; this.scopes = new Set();
  }
  getSession() { return this.session ? { ...this.session } : null; }
  async request(scopes, selectAccount = false) {
    if (!this.clientId) throw new Error('Google connection is not configured for this deployment yet.');
    const sdk = await this.loadSDK();
    const requested = [...new Set(['openid', 'email', 'profile', ...this.scopes, ...scopes])];
    const response = await new Promise((resolve, reject) => {
      const client = sdk.initTokenClient({
        client_id: this.clientId, scope: requested.join(' '), include_granted_scopes: true,
        callback: result => result.error ? reject(new Error(result.error_description || result.error)) : resolve(result),
        error_callback: () => reject(new Error('Google connection was closed or blocked. Try connecting again.'))
      });
      client.requestAccessToken({ prompt: selectAccount ? 'select_account' : '' });
    });
    if (!response.access_token) throw new Error('Google did not return an access token.');
    const granted = new Set((response.scope || '').split(/\s+/));
    if (scopes.some(scope => !granted.has(scope))) throw new Error('Google Drive access was not granted. Your local save is unchanged.');
    const profile = await this.fetcher('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${response.access_token}` }
    });
    if (!profile.ok) throw new Error('Could not identify the connected Google account.');
    const user = await profile.json();
    if (!user.sub) throw new Error('Google did not return an account identity.');
    if (!selectAccount && this.session && this.session.subject !== user.sub) {
      throw new Error('A different Google account was selected. Disconnect and reconnect before switching accounts.');
    }
    this.session = { provider: this.id, subject: user.sub, displayName: user.name || user.email || 'Google player' };
    this.token = response.access_token; this.expiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
    this.scopes = granted;
    return this.getSession();
  }
  async signIn({ scopes = [] } = {}) { return this.request(scopes, true); }
  async authorize(scopes) { return this.request(scopes); }
  getAccessToken(scopes = []) {
    if (!this.token || Date.now() >= this.expiresAt - 60000 || scopes.some(s => !this.scopes.has(s))) {
      throw new Error('Google access has expired or needs permission. Reconnect from Saves; your progress is still stored locally.');
    }
    return this.token;
  }
  async signOut() {
    this.session = null; this.token = null; this.expiresAt = 0; this.scopes.clear();
  }
}
