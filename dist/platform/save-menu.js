import { decodeSave } from './save-format.js';

const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const summary = state => `${Object.values(state.levels).reduce((a, b) => a + b, 0)} settlements · tools tier ${state.tools} · ${new Date(state.last).toLocaleString()}`;

export function installSaveMenu({ platform, readState, replaceState, openModal, notify }) {
  const { saves } = platform;
  const $ = s => document.querySelector(s);
  function snapshot() { saves.save(readState()); return saves.export(); }
  function handle(action) {
    return async event => {
      const button = event.currentTarget; button.disabled = true;
      try { await action(event); }
      catch (error) { notify(error.message); const status = $('#save-feedback'); if (status) status.textContent = error.message; }
      finally { if (button.isConnected) button.disabled = false; }
    };
  }
  function attach(connection, useCloud) {
    // Stop the current activity before replacing state; normal modal opening does this.
    const cloud = saves.attach(connection.storage, connection.record, { useCloud });
    if (cloud) replaceState(cloud);
    else saves.save(readState());
    saves.sync().catch(error => notify(error.message));
    render();
  }
  async function connect() {
    const connection = await platform.connect();
    if (!connection.record) { attach(connection, false); return; }
    openModal(`<div class="eyebrow">CHOOSE YOUR PROGRESS</div><h2>Welcome back.</h2><p>No saves have been replaced. Choose which progress to continue.</p><div class="hint">This device: ${escapeHTML(summary(readState()))}<br>Google Drive: ${escapeHTML(summary(connection.record.state))}</div><button class="primary" id="use-cloud">Continue the cloud save</button><button class="secondary" id="use-local">Keep this device and replace cloud save</button><p class="helptext">Close this window to keep playing locally without syncing.</p>`);
    $('#use-cloud').onclick = () => attach(connection, true);
    $('#use-local').onclick = () => attach(connection, false);
  }
  function render() {
    const identity = platform.auth.getSession() || platform.guest.getSession();
    const status = saves.remote ? saves.blocked ? 'Cloud sync needs attention. Reconnect to resume.' :
      saves.lastSyncedAt ? `Last synced ${new Date(saves.lastSyncedAt).toLocaleTimeString()}` : 'Cloud sync is ready.' : 'Automatic saves are stored on this device.';
    openModal(`<div class="eyebrow">YOUR WORLD, YOUR SAVE</div><h2>Saves & account</h2><p id="save-feedback" role="status">${escapeHTML(status)}</p><div class="hint">Playing as ${escapeHTML(identity.displayName)}. Connecting Google Drive keeps an automatic save in its hidden app storage. Exports are separate backups.</div><button class="primary" id="connect-drive" ${platform.configured ? '' : 'disabled'}>${saves.remote ? 'Reconnect' : 'Connect'} Google Drive</button>${platform.configured ? '' : '<p class="helptext">Google Drive connection is not available on this deployment yet. Local saves and file exports work now.</p>'}${identity.provider !== 'guest' ? '<button class="secondary" id="disconnect-drive">Disconnect Google account</button>' : ''}<div class="divider"></div><div class="sectiontitle">Export a backup</div><button class="secondary" id="download-save">Download save file</button><button class="secondary" id="export-drive" ${platform.configured ? '' : 'disabled'}>Save a visible copy to Google Drive</button><div class="divider"></div><label class="sectiontitle" for="import-save">Import a save file</label><input id="import-save" type="file" accept=".json,application/json"><p class="helptext">You can review a file before replacing your progress. Disconnecting never deletes your cloud save.</p>`);
    $('#connect-drive').onclick = handle(connect);
    const disconnect = $('#disconnect-drive');
    if (disconnect) disconnect.onclick = handle(async () => { await platform.disconnect(); render(); });
    $('#download-save').onclick = handle(() => {
      const url = URL.createObjectURL(new Blob([snapshot()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `commonwealth-save-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Save file exported.');
    });
    $('#export-drive').onclick = handle(async () => {
      await platform.exportToDrive(snapshot());
      notify('A visible backup was saved to Google Drive.'); render();
    });
    $('#import-save').onchange = handle(async event => {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 1024 * 1024) throw new Error('Save files must be smaller than 1 MB.');
      const text = await file.text(), candidate = decodeSave(text);
      openModal(`<div class="eyebrow">RESTORE A BACKUP</div><h2>Continue this world?</h2><p>${escapeHTML(summary(candidate))}</p><p>This replaces progress on this device${saves.remote ? ' and the connected cloud save on the next sync' : ''}. Download your current save first if you want to keep it.</p><button class="primary" id="confirm-import">Replace current progress</button><button class="secondary" id="cancel-import">Go back</button>`);
      $('#cancel-import').onclick = render;
      $('#confirm-import').onclick = handle(async () => {
        replaceState(saves.import(text));
        notify('Save imported.'); render();
        saves.sync().catch(error => notify(error.message));
      });
    });
  }
  $('#save-menu').onclick = render;
}
