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
// - clearAllScheduledMatches()
// - setupAutomaticPolling(intervalMinutes)
// - removeAutomaticPolling()
//
// Total: 10 functions
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

/**
 * Generate the script property key for Discord message IDs.
 * @param {string} wk - Week key in format "YYYY-MM-DD|mapname"
 * @returns {string} Script property key for message IDs
 */
function msgIdsKey(wk) { return 'WEEKLY_MSG_IDS::' + String(wk || ''); }

/**
 * Load Discord message IDs for a week (header, tables, rematches).
 * Handles legacy formats and normalizes to consistent shape.
 * @param {string} wk - Week key in format "YYYY-MM-DD|mapname"
 * @returns {Object} {header, table, tables[], rematch, rematches[]}
 */
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

/**
 * Save Discord message IDs for a week in both new and legacy-friendly formats.
 * @param {string} wk - Week key in format "YYYY-MM-DD|mapname"
 * @param {Object} ids - Message IDs object {header, table, rematch, tables[], rematches[]}
 * @returns {Object} Normalized IDs object that was saved
 */
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

/**
 * Clear all stored Discord message IDs for a week.
 * @param {string} wk - Week key in format "YYYY-MM-DD|mapname"
 */
function clearMsgIds(wk) {
  PropertiesService.getScriptProperties().deleteProperty(msgIdsKey(wk));
}

/**
 * Clear all scheduled matches from ALL week stores.
 * This removes the store.sched property from every WEEKLY_STORE_* entry.
 * Use this to reset the "already scheduled" tracking and allow re-scheduling of all matches.
 * @returns {number} Number of week stores cleared
 */
function clearAllScheduledMatches() {
  var sp = PropertiesService.getScriptProperties();
  var allProps = sp.getProperties();
  var cleared = 0;

  for (var key in allProps) {
    if (key.startsWith('WEEKLY_STORE_')) {
      try {
        var store = JSON.parse(allProps[key]);
        if (store && store.sched) {
          // Clear the sched property but keep other data (shoutcasters, etc.)
          delete store.sched;
          sp.setProperty(key, JSON.stringify(store));
          cleared++;
        }
      } catch (e) {
        // Skip malformed stores
        Logger.log('Skipped malformed store: ' + key);
      }
    }
  }

  if (typeof sendLog === 'function') {
    sendLog('🗑️ Cleared scheduled matches from ' + cleared + ' week stores');
  }

  return cleared;
}

/**
 * Set up automatic polling with a time-based trigger.
 * Creates a trigger that calls server_startPolling() at regular intervals.
 * @param {number} [intervalMinutes=5] - Interval in minutes (default: 5)
 * @returns {string} Trigger ID
 */
function setupAutomaticPolling(intervalMinutes) {
  intervalMinutes = intervalMinutes || 5;

  // Remove any existing automatic polling triggers first
  removeAutomaticPolling();

  // Create new trigger
  var trigger = ScriptApp.newTrigger('automaticPollingHandler')
    .timeBased()
    .everyMinutes(intervalMinutes)
    .create();

  if (typeof sendLog === 'function') {
    sendLog('✅ Automatic polling enabled (every ' + intervalMinutes + ' minutes). Trigger ID: ' + trigger.getUniqueId());
  }

  return trigger.getUniqueId();
}

/**
 * Remove all automatic polling triggers.
 * @returns {number} Number of triggers removed
 */
function removeAutomaticPolling() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'automaticPollingHandler') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  if (removed > 0 && typeof sendLog === 'function') {
    sendLog('🛑 Removed ' + removed + ' automatic polling trigger(s)');
  }

  return removed;
}

/**
 * Handler function called by the time-based trigger.
 * This is the function that actually runs automatically.
 * It calls server_startPolling() without the skipScheduled option (allows re-scheduling).
 */
function automaticPollingHandler() {
  try {
    // Get the secret from script properties (check multiple property names for compatibility)
    var sp = PropertiesService.getScriptProperties();
    var secret = sp.getProperty('WM_WEBAPP_SHARED_SECRET') ||
                 sp.getProperty('WEBAPP_SECRET') ||
                 sp.getProperty('WEBAPP_SECRET_V2') ||
                 sp.getProperty('RELAY_SHARED_SECRET');
    if (!secret) {
      Logger.log('ERROR: No webapp secret found in script properties (checked WM_WEBAPP_SHARED_SECRET, WEBAPP_SECRET, WEBAPP_SECRET_V2, RELAY_SHARED_SECRET)');
      return;
    }

    // Call server_startPolling (which polls from last pointer, no skipScheduled = allows re-scheduling)
    var result = server_startPolling(secret);

    if (result.ok) {
      var data = result.data || {};
      Logger.log('✅ Automatic poll completed: ' +
        'Processed: ' + (data.processed || 0) + ', ' +
        'Updated: ' + (data.updatedPairs || data.updated || 0) + ', ' +
        'Errors: ' + (Array.isArray(data.errors) ? data.errors.length : 0));
    } else {
      Logger.log('❌ Automatic poll failed: ' + (result.error || 'Unknown error'));
    }
  } catch (e) {
    Logger.log('❌ Automatic polling error: ' + (e.message || e));
  }
}