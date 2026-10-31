import { decodeSave, encodeSave } from '../save-format.js';

export class BrowserStorage {
  id = 'browser';
  label = 'this device';
  constructor(storage, key = 'hearthwater-v1') { this.storage = storage; this.key = key; }
  // Synchronous local methods let the game save before page teardown.
  readLocal() { const text = this.storage.getItem(this.key); return text === null ? null : decodeSave(text); }
  writeLocal(state) { this.storage.setItem(this.key, encodeSave(state)); }
  async read() { const state = this.readLocal(); return state ? { state, revision: this.storage.getItem(this.key) } : null; }
  async write(state) { this.writeLocal(state); return { revision: this.storage.getItem(this.key) }; }
}
