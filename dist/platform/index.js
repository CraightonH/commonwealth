import { config } from '../config.js';
import { GuestAuth } from './auth/guest-auth.js';
import { GoogleAuth, loadGoogleSDK } from './auth/google-auth.js';
import { BrowserStorage } from './storage/browser-storage.js';
import { GoogleDriveStorage, DRIVE_APPDATA, DRIVE_FILE } from './storage/google-drive.js';
import { SaveService } from './save-service.js';

// Composition root: new providers are selected here, not inside the game loop.
export function createPlatform({ onStatus }) {
  const local = new BrowserStorage({
    getItem: key => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value)
  });
  const guest = new GuestAuth();
  const auth = new GoogleAuth({ clientId: config.googleClientId });
  const drive = new GoogleDriveStorage({ authorization: auth });
  const saves = new SaveService({ local, onStatus });
  if (config.googleClientId) loadGoogleSDK().catch(() => {});
  return {
    saves, guest, auth, configured: Boolean(config.googleClientId),
    async connect() {
      saves.disconnect();
      const identity = await auth.signIn({ scopes: [DRIVE_APPDATA] });
      const record = await drive.read();
      return { identity, record, storage: drive };
    },
    async disconnect() { saves.disconnect(); await auth.signOut(); },
    async exportToDrive(text) {
      if (!auth.getSession()) await auth.signIn({ scopes: [DRIVE_FILE] });
      else await auth.authorize([DRIVE_FILE]);
      return drive.exportVisible(text);
    }
  };
}
