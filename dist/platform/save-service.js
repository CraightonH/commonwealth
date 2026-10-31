import { validateState, decodeSave, encodeSave } from './save-format.js';

export class SaveConflictError extends Error {
  constructor() { super('The cloud save changed on another device. Reconnect and choose which save to use.'); this.name = 'SaveConflictError'; }
}

// The game sees state and status only. Tokens and provider APIs stay in adapters.
export class SaveService {
  constructor({ local, onStatus = () => {} }) {
    this.local = local; this.onStatus = onStatus;
    this.remote = null; this.revision = null; this.generation = 0;
    this.localOK = true; this.blocked = false; this.inFlight = null;
    this.lastSyncedAt = null; this.current = null;
  }
  status(message = '') {
    this.onStatus({ localOK: this.localOK, provider: this.remote?.label || null,
      lastSyncedAt: this.lastSyncedAt, blocked: this.blocked, message });
  }
  load(fallback) {
    try { this.current = this.local.readLocal() || validateState(fallback); }
    catch (e) { this.localOK = false; this.status(`Local save unavailable: ${e.message}`); this.current = validateState(fallback); }
    return structuredClone(this.current);
  }
  save(state) {
    this.current = validateState(state);
    try { this.local.writeLocal(this.current); this.localOK = true; }
    catch { this.localOK = false; }
    this.status();
  }
  // Cloud state is never chosen silently; the caller presents the choice first.
  attach(provider, record, { useCloud = false } = {}) {
    this.disconnect();
    const cloudState = record ? validateState(record.state) : null;
    this.remote = provider; this.revision = record?.revision ?? null;
    if (useCloud && cloudState) this.save(cloudState);
    this.status();
    return useCloud && cloudState ? structuredClone(cloudState) : null;
  }
  disconnect() {
    this.generation++; this.remote = null; this.revision = null;
    this.blocked = false; this.lastSyncedAt = null; this.inFlight = null;
    this.status();
  }
  sync() {
    if (this.inFlight) return this.inFlight;
    if (!this.remote || this.blocked || !this.current) return Promise.resolve();
    const provider = this.remote, generation = this.generation;
    const snapshot = structuredClone(this.current), revision = this.revision;
    this.inFlight = (async () => {
      try {
        const result = await provider.write(snapshot, { expectedRevision: revision });
        if (generation !== this.generation) return;
        this.revision = result.revision; this.lastSyncedAt = Date.now(); this.status();
      } catch (e) {
        if (generation !== this.generation) return;
        this.blocked = true; this.status(e.message);
        throw e;
      } finally { if (generation === this.generation) this.inFlight = null; }
    })();
    return this.inFlight;
  }
  export() { return encodeSave(this.current); }
  import(text) { const state = decodeSave(text); this.save(state); return structuredClone(state); }
}
