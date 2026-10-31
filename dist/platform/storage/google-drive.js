import { encodeSave, decodeSave } from '../save-format.js';
import { SaveConflictError } from '../save-service.js';

export const DRIVE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';
export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const filename = 'commonwealth-save.json';

// Authorization is injected. The adapter has no dependency on GoogleAuth or game code.
export class GoogleDriveStorage {
  id = 'google-drive';
  label = 'Google Drive';
  constructor({ authorization, fetcher = globalThis.fetch }) { this.authorization = authorization; this.fetcher = fetcher; }
  async request(url, options = {}, scopes = [DRIVE_APPDATA]) {
    const token = this.authorization.getAccessToken(scopes);
    let response;
    try { response = await this.fetcher(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } }); }
    catch { throw new Error('Google Drive could not be reached. Your local save is safe; reconnect to retry.'); }
    if (!response.ok) {
      if (response.status === 401) throw new Error('Google access expired. Reconnect to resume cloud saves.');
      if (response.status === 412) throw new SaveConflictError();
      throw new Error(`Google Drive could not save or load progress (${response.status}). Your local save is unchanged.`);
    }
    return response;
  }
  async metadata() {
    const params = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${filename}' and trashed = false`,
      fields: 'files(id,version),nextPageToken', pageSize: '100' });
    const response = await this.request(`${API}?${params}`);
    const data = await response.json();
    if (data.files.length > 1 || data.nextPageToken) throw new Error('More than one cloud save was found. Export a backup before resolving duplicate saves.');
    return data.files[0] || null;
  }
  revision(file) { return file ? `${file.id}:${file.version}` : null; }
  async read() {
    const before = await this.metadata();
    if (!before) return null;
    const response = await this.request(`${API}/${encodeURIComponent(before.id)}?alt=media`);
    const state = decodeSave(await response.text());
    const after = await this.metadata();
    if (this.revision(before) !== this.revision(after)) throw new SaveConflictError();
    return { state, revision: this.revision(after) };
  }
  async write(state, { expectedRevision = null } = {}) {
    const text = encodeSave(state), current = await this.metadata();
    if (this.revision(current) !== expectedRevision) throw new SaveConflictError();
    if (!current) {
      const created = await this.createFile({ name: filename, parents: ['appDataFolder'] }, text, [DRIVE_APPDATA]);
      return { revision: this.revision(created) };
    }
    const response = await this.request(`${UPLOAD}/${encodeURIComponent(current.id)}?uploadType=media&fields=id,version`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text
    });
    return { revision: this.revision(await response.json()) };
  }
  async createFile(metadata, text, scopes) {
    const boundary = `commonwealth_${globalThis.crypto.randomUUID()}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const response = await this.request(`${UPLOAD}?uploadType=multipart&fields=id,version,webViewLink`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }, scopes);
    return response.json();
  }
  // Visible backups are snapshots, never the authoritative hidden save file.
  async exportVisible(text) {
    decodeSave(text);
    return this.createFile({ name: `commonwealth-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json` }, text, [DRIVE_FILE]);
  }
}
