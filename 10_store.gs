// =======================
// store.gs – Per-week and global schedule storage
// =======================
/** Internal helper to form the script property key for weekly store. */
function _weekStoreKey_(wk) {
  return `WEEKLY_STORE_${wk}`;
}

/** Load the per-week store (schedules and shoutcasters) for week key `wk`. */
function loadWeekStore_(wk) {
  const sp = PropertiesService.getScriptProperties();
  const raw = sp.getProperty(_weekStoreKey_(wk));
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
function saveWeekStore_(wk, obj) {
  PropertiesService.getScriptProperties()
    .setProperty(_weekStoreKey_(wk), JSON.stringify(obj || { schedules: {}, shoutcasters: {} }));
}

/** Stable match key (ignores home/away order) for two teams in a division. */
function matchKey_(division, team1, team2) {
  const t1 = normalizeTeam_(team1);
  const t2 = normalizeTeam_(team2);
  const [a, b] = [t1, t2].sort();
  return `${division}|${a}|${b}`;
}

function _msgIdsKey_(wk){ return 'WEEKLY_MSG_IDS::' + String(wk || ''); }

/** Load IDs with full back-compat and normalize into a single shape. */
function _loadMsgIds_(wk) {
  var raw = PropertiesService.getScriptProperties().getProperty(_msgIdsKey_(wk));
  var obj = raw ? (function(){ try { return JSON.parse(raw); } catch(_) { return null; } })() : null;
  if (!obj) obj = {};

  // Normalize expected fields
  var header    = obj.header    ? String(obj.header)    : '';
  var table     = obj.table     ? String(obj.table)     : '';
  var rematch   = obj.rematch   ? String(obj.rematch)   : '';

  var tables    = Array.isArray(obj.tables)    ? obj.tables.map(String)    : [];
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
    table:  table,           // single weekly table (preferred new shape)
    tables: tables,          // legacy multi-page tables (kept for back-compat)
    rematch: rematch,        // single rematches post (preferred new shape)
    rematches: rematches     // legacy multi-post rematches (if any)
  };
}

/** Save IDs in both new and legacy-friendly shapes. */
function _saveMsgIds_(wk, ids) {
  var out = {
    header: String(ids.header || ''),
    table:  String(ids.table  || ''),
    rematch: String(ids.rematch || ''),
    tables:  Array.isArray(ids.tables)    ? ids.tables.map(String)    : (ids.table ? [String(ids.table)] : []),
    rematches: Array.isArray(ids.rematches) ? ids.rematches.map(String) : (ids.rematch ? [String(ids.rematch)] : [])
  };
  // Legacy cluster: [header, ...tables]
  out.cluster = [out.header].concat(out.tables);
  PropertiesService.getScriptProperties().setProperty(_msgIdsKey_(wk), JSON.stringify(out));
  return out;
}

function _clearMsgIds_(wk) {
  PropertiesService.getScriptProperties().deleteProperty(_msgIdsKey_(wk));
}

function deleteWeeklyClusterByKey_(wk) {
  var ids = _loadMsgIds_(wk);
  var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
                  (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
  if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

  if (ids.header)    { try { deleteMessage_(channelId, ids.header); }    catch(e){} }
  if (ids.weekly)    { try { deleteMessage_(channelId, ids.weekly); }    catch(e){} }
  if (ids.rematches) { try { deleteMessage_(channelId, ids.rematches); } catch(e){} }

  _clearMsgIds_(wk);
  return true;
}