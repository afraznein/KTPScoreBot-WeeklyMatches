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

/** Property key for storing Discord message IDs for a given week key */
function _msgIdsKey_(wk) {
  return 'WEEKLY_MSG_IDS::' + String(wk || '');
}

/** Load stored IDs for this week (back-compatible with old shapes) */
function _loadMsgIds_(wk) {
  var raw = PropertiesService.getScriptProperties().getProperty(_msgIdsKey_(wk));
  var obj;
  try { obj = JSON.parse(raw || '{}'); } catch (e) { obj = {}; }

  var header = obj.header || '';
  var table  = obj.table  || '';
  var tables = Array.isArray(obj.tables) ? obj.tables
             : Array.isArray(obj.cluster) ? obj.cluster.slice(1)
             : (table ? [table] : []);

  if (!table && tables.length) table = tables[0];

  return { header: header, table: table, tables: tables };
}

/** Save IDs in a normalized way, plus legacy 'cluster' for safety */
function _saveMsgIds_(wk, ids) {
  var header = ids.header || '';
  var table  = ids.table  || ((Array.isArray(ids.tables) && ids.tables[0]) || '');
  var tables = table ? [table] : [];
  var obj = { header: header, table: table, tables: tables, cluster: [header].concat(tables) };
  PropertiesService.getScriptProperties().setProperty(_msgIdsKey_(wk), JSON.stringify(obj));
  return obj;
}

/** Clear stored IDs for a week key */
function _clearMsgIds_(wk) {
  PropertiesService.getScriptProperties().deleteProperty(_msgIdsKey_(wk));
}

/** Delete the stored header/table messages on Discord, then clear IDs */
function deleteWeeklyClusterByKey_(wk) {
  var ids = _loadMsgIds_(wk);
  var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') || (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
  if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

  if (ids.header) { try { deleteMessage_(channelId, ids.header); } catch (e) {} }
  if (ids.table)  { try { deleteMessage_(channelId, ids.table);  } catch (e) {} }

  // safety: remove any extra stale tables from old runs
  if (Array.isArray(ids.tables)) {
    for (var i = 1; i < ids.tables.length; i++) {
      var mid = ids.tables[i];
      if (mid) { try { deleteMessage_(channelId, mid); } catch (e) {} }
    }
  }
  _clearMsgIds_(wk);
  return true;
}