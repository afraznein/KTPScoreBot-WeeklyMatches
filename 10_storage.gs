// =======================
// 10_storage.gs - Storage & Persistence
// =======================
// Purpose: Week stores, message ID tracking, script properties persistence
// Dependencies: 00_config.gs
// Used by: 30_relay.gs, 55_rendering.gs, 70_updates.gs
//
// Functions in this module:
// - weekStoreKey(wk)
// - loadWeekStore(wk)
// - saveWeekStore(wk, obj)
// - msgIdsKey(wk)
// - loadMsgIds(wk)
// - saveMsgIds(wk, ids)
// - clearMsgIds(wk)
//
// Total: 7 functions
// =======================

/** Internal helper to form the script property key for weekly store. */
function weekStoreKey(wk) {
  return `WEEKLY_STORE_${wk}`;
}

/** Load the per-week store (schedules and shoutcasters) for week key `wk`. */
function loadWeekStore(wk) {
  const sp = PropertiesService.getScriptProperties();
  const raw = sp.getProperty(weekStoreKey(wk));
  if (!raw) return { schedules: {}, shoutcasters: {} };
  try {
    const obj = JSON.parse(raw);
    if (!obj.schedules) obj.schedules = {};
    if (!obj.shoutcasters) obj.shoutcasters = {};
    return obj;
  } catch (e) {
    return { schedules: {}, shoutcasters: {} };
  }
}

/** Save the per-week store object for week key `wk`. */
function saveWeekStore(wk, obj) {
  PropertiesService.getScriptProperties()
    .setProperty(weekStoreKey(wk), JSON.stringify(obj || { schedules: {}, shoutcasters: {} }));
}

function msgIdsKey(wk) { return 'WEEKLY_MSG_IDS::' + String(wk || ''); }

/** Load IDs with full back-compat and normalize into a single shape. */
function loadMsgIds(wk) {
  var raw = PropertiesService.getScriptProperties().getProperty(msgIdsKey(wk));
  var obj = raw ? (function () { try { return JSON.parse(raw); } catch (_) { return null; } })() : null;
  if (!obj) obj = {};

  // Normalize expected fields
  var header = obj.header ? String(obj.header) : '';
  var table = obj.table ? String(obj.table) : '';
  var rematch = obj.rematch ? String(obj.rematch) : '';

  var tables = Array.isArray(obj.tables) ? obj.tables.map(String) : [];
  var rematches = Array.isArray(obj.rematches) ? obj.rematches.map(String) : [];

  // Back-compat: legacy 'cluster' = [header, ...tables]
  if ((!header || !tables.length) && Array.isArray(obj.cluster)) {
    var c = obj.cluster.map(String);
    if (!header && c.length) header = c[0] || header;
    if (!tables.length && c.length > 1) tables = c.slice(1);
  }
  // If single table present but no tables[], reflect it
  if (table && !tables.length) tables = [table];
  // If single rematch present but no rematches[], reflect it
  if (rematch && !rematches.length) rematches = [rematch];

  return {
    header: header,
    table: table,           // single weekly table (preferred new shape)
    tables: tables,          // legacy multi-page tables (kept for back-compat)
    rematch: rematch,        // single rematches post (preferred new shape)
    rematches: rematches     // legacy multi-post rematches (if any)
  };
}

/** Save IDs in both new and legacy-friendly shapes. */
function saveMsgIds(wk, ids) {
  var out = {
    header: String(ids.header || ''),
    table: String(ids.table || ''),
    rematch: String(ids.rematch || ''),
    tables: Array.isArray(ids.tables) ? ids.tables.map(String) : (ids.table ? [String(ids.table)] : []),
    rematches: Array.isArray(ids.rematches) ? ids.rematches.map(String) : (ids.rematch ? [String(ids.rematch)] : [])
  };
  // Legacy cluster: [header, ...tables]
  out.cluster = [out.header].concat(out.tables);
  PropertiesService.getScriptProperties().setProperty(msgIdsKey(wk), JSON.stringify(out));
  return out;
}

function clearMsgIds(wk) {
  PropertiesService.getScriptProperties().deleteProperty(msgIdsKey(wk));
}