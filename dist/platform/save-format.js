const finite = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const integer = (n) => finite(n) && Number.isSafeInteger(n);
const fail = () => { throw new Error('This file is not a supported Commonwealth save.'); };

// Whitelist fields: imported objects never become live game state unexamined.
export function validateState(value) {
  if (!value || value.v !== 1 || !value.res || !value.levels ||
      !['food', 'timber', 'ore'].every(k => finite(value.res[k])) ||
      !['fish', 'wood', 'ore'].every(k => integer(value.levels[k])) ||
      !integer(value.tools) || value.tools > 1000 ||
      !integer(value.active) || value.active > 1000 || !finite(value.last) ||
      value.last > Date.now() + 300000 || !Array.isArray(value.log)) fail();
  if (value.exp !== null && (!value.exp || !finite(value.exp.end) || typeof value.exp.ready !== 'boolean')) fail();
  if (value.log.length > 30 || value.log.some(item => !item || typeof item.text !== 'string' || item.text.length > 2000 || !finite(item.time))) fail();
  return {
    v: 1,
    res: Object.fromEntries(['food', 'timber', 'ore'].map(k => [k, value.res[k]])),
    levels: Object.fromEntries(['fish', 'wood', 'ore'].map(k => [k, value.levels[k]])),
    tools: value.tools, active: value.active, last: value.last,
    exp: value.exp === null ? null : { end: value.exp.end, ready: value.exp.ready },
    log: value.log.map(({ text, time }) => ({ text, time }))
  };
}

export function encodeSave(state) {
  return JSON.stringify({ format: 'commonwealth-save', schemaVersion: 1,
    exportedAt: new Date().toISOString(), state: validateState(state) }, null, 2);
}

export function decodeSave(text) {
  if (typeof text !== 'string' || text.length > 1024 * 1024) fail();
  let value;
  try { value = JSON.parse(text); } catch { fail(); }
  // The original PoC's raw state is supported as a migration input.
  if (value?.format === 'commonwealth-save') {
    if (value.schemaVersion !== 1) fail();
    return validateState(value.state);
  }
  return validateState(value);
}
