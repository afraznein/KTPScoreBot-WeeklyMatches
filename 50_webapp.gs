// =======================
// webapp.gs – Web UI server functions for control panel
// =======================

/** Small internal helpers for webapp. */
function _props_() { return PropertiesService.getScriptProperties(); }
function _getProp_(key, def) {
  const v = _props_().getProperty(key);
  return v != null ? v : (def || '');
}
function _ok_(data) {
  return { ok: true, data: data != null ? data : null };
}
function _err_(err) {
  return { ok: false, error: err && err.message ? String(err.message) : String(err) };
}
function _json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Verify a provided secret against the configured WebApp shared secret. */
function _checkSecret_(secret) {
  const expected = String(_props_().getProperty('WM_WEBAPP_SHARED_SECRET') || '');
  let got = String(secret == null ? '' : secret);
  if (got.indexOf('Bearer ') === 0) got = got.slice(7);
  got = got.trim();
  if (!expected || got !== expected.trim()) {
    Utilities.sleep(20);  // slight delay to mitigate brute-force attempts
    throw new Error('Forbidden: bad secret');
  }
}

/** Extract secret from a request (URL param or JSON body). */
function _secretFromRequest_(e) {
  if (!e) return '';
  try {
    if (e.parameter && e.parameter.secret) {
      return String(e.parameter.secret);
    }
    if (e.postData && e.postData.type && e.postData.type.indexOf('application/json') !== -1) {
      const body = JSON.parse(e.postData.contents || '{}');
      if (body && body.secret) return String(body.secret);
    }
  } catch (ignore) {}
  return '';
}

// ---------- server_* endpoints for control panel ----------

function server_getState() {
  try {
    const state = {
      lastStartId: _getProp_('LAST_SCHED_MSG_ID', ''),
      schedChannel: _getProp_('SCHED_INPUT_CHANNEL_ID', ''),
      weeklyChannel: _getProp_('WEEKLY_POST_CHANNEL_ID', ''),
      resultsChannel: _getProp_('RESULTS_LOG_CHANNEL_ID', '')
    };
    return _ok_(state);
  } catch (e) {
    return _err_(e);
  }
}

function server_setStartId(secret, id) {
  try {
    _checkSecret_(secret);
    const snowflake = String(id || '').trim();
    if (!/^\d{5,30}$/.test(snowflake)) throw new Error('Invalid message id');
    _props_().setProperty('LAST_SCHED_MSG_ID', snowflake);
    return _ok_({ id: snowflake });
  } catch (e) {
    return _err_(e);
  }
}

function server_clearStartId(secret) {
  try {
    _checkSecret_(secret);
    _props_().deleteProperty('LAST_SCHED_MSG_ID');
    return _ok_({ cleared: true });
  } catch (e) {
    return _err_(e);
  }
}

// Clear the stored IDs (header/table) and content-hash for the CURRENT weekKey
function server_resetWeeklyMsgIds(secret) {
  try {
    if (typeof _checkSecret_ === 'function') _checkSecret_(secret);

    // Derive the same wkKey your upsert uses
    var w = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : {};
    if (typeof syncHeaderMetaToTables_ === 'function') w = syncHeaderMetaToTables_(w, 'Bronze');
    var wkKey = (typeof weekKey_ === 'function') ? weekKey_(w)
              : (w && w.date ? Utilities.formatDate(w.date, 'America/New_York', 'yyyy-MM-dd') : '') + '|' + (w.mapRef || '');

    // Load, then clear
    var before = (typeof _loadMsgIds_ === 'function') ? _loadMsgIds_(wkKey) : {};
    if (typeof _clearMsgIds_ === 'function') _clearMsgIds_(wkKey);

    // Also clear the content hash so next post forces create/edit
    var hashKey = 'WEEKLY_MSG_HASHES::' + wkKey;
    PropertiesService.getScriptProperties().deleteProperty(hashKey);

    return (typeof _ok_ === 'function')
      ? _ok_({ weekKey: wkKey, cleared: true, prevIds: before })
      : { ok: true, data: { weekKey: wkKey, cleared: true, prevIds: before } };
  } catch (e) {
    return (typeof _err_ === 'function') ? _err_(e) : { ok:false, error:String(e && e.message || e) };
  }
}

// Delete the actual header/table messages on Discord for CURRENT weekKey (uses stored IDs)
function server_deleteWeeklyCluster(secret) {
  try {
    if (typeof _checkSecret_ === 'function') _checkSecret_(secret);

    var w = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : {};
    if (typeof syncHeaderMetaToTables_ === 'function') w = syncHeaderMetaToTables_(w, 'Bronze');
    var wkKey = (typeof weekKey_ === 'function') ? weekKey_(w)
              : (w && w.date ? Utilities.formatDate(w.date, 'America/New_York', 'yyyy-MM-dd') : '') + '|' + (w.mapRef || '');

    if (typeof deleteWeeklyClusterByKey_ === 'function') {
      deleteWeeklyClusterByKey_(wkKey);
    } else {
      // Fallback inline delete (if your store helper isn't present)
      var ids = (typeof _loadMsgIds_ === 'function') ? _loadMsgIds_(wkKey) : {};
      var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
                      (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
      if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

      if (ids.header) { try { deleteMessage_(channelId, ids.header); } catch (_) {} }
      if (ids.table)  { try { deleteMessage_(channelId, ids.table);  } catch (_) {} }
      if (Array.isArray(ids.tables)) {
        for (var i=1;i<ids.tables.length;i++) { var mid = ids.tables[i]; if (mid) { try { deleteMessage_(channelId, mid); } catch(_){} } }
      }
      if (typeof _clearMsgIds_ === 'function') _clearMsgIds_(wkKey);
    }

    // Also clear hash so next post recreates cleanly
    var hashKey = 'WEEKLY_MSG_HASHES::' + wkKey;
    PropertiesService.getScriptProperties().deleteProperty(hashKey);

    return (typeof _ok_ === 'function') ? _ok_({ deleted:true, weekKey:wkKey }) : { ok:true, data:{ deleted:true, weekKey:wkKey } };
  } catch (e) {
    return (typeof _err_ === 'function') ? _err_(e) : { ok:false, error:String(e && e.message || e) };
  }
}


function server_postOrUpdate(secret) {
  try {
    _checkSecret_(secret);
    var w = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : null;
    var res = upsertWeeklyDiscordMessage_(w);
    logToWmSheet_('INFO', 'weekly_upsert', 'ok', res)
    return _ok_(res);  // <- res already has ok/action/etc.
  } catch (e) {
    return _err_(e);
  }
}

/** Start polling from a specific message ID (inclusive). */
function server_startPollingFrom(secret, startId, dryRunOverride) {
  try {
    _checkSecret_(secret);
    const id = String(startId || '').trim();
    if (!/^\d{5,30}$/.test(id)) throw new Error('Invalid message id');
    // Set the starting pointer
    _props_().setProperty('LAST_SCHED_MSG_ID', id);
    // Execute polling (prefer locked version if available)
    let pollResult = null;
    if (typeof WM_pollScheduling_locked === 'function') {
      pollResult = WM_pollScheduling_locked();
    } else if (typeof WM_pollScheduling === 'function') {
      pollResult = WM_pollScheduling();
    } else {
      throw new Error('Poll function not found');
    }
    const tookMs = Date.now() - Number(pollResult && pollResult.startTime || 0);
    const lastPtr = _getProp_('LAST_SCHED_MSG_ID', '');
    return _ok_({ startedFrom: id, lastPointer: lastPtr, tookMs: tookMs, result: pollResult || null });
  } catch (e) {
    return _err_(e);
  }
}

/** Start polling from the current stored pointer (continues from last stop). */
function server_startPolling(secret) {
  try {
    _checkSecret_(secret);
    // Simply delegate to locked or unlocked polling
    let pollResult = null;
    if (typeof WM_pollScheduling_locked === 'function') {
      pollResult = WM_pollScheduling_locked();
    } else if (typeof WM_pollScheduling === 'function') {
      pollResult = WM_pollScheduling();
    } else {
      throw new Error('Poll function not found');
    }
    const tookMs = pollResult && pollResult.tookMs != null
      ? pollResult.tookMs
      : (pollResult && pollResult.startTime ? Date.now() - pollResult.startTime : null);
    const lastPtr = _getProp_('LAST_SCHED_MSG_ID', '');
    return _ok_({ lastPointer: lastPtr, tookMs: tookMs, result: pollResult || null });
  } catch (e) {
    return _err_(e);
  }
}

function logToWmSheet_(level, event, message, detailsObj) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['Timestamp','Level','Event','Message','Details (JSON)']);
      sh.hideSheet(); // keep it tidy
    }
    sh.appendRow([
      Utilities.formatDate(new Date(), getTz_ ? getTz_() : Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      String(level||'INFO'),
      String(event||''),
      String(message||''),
      detailsObj ? JSON.stringify(detailsObj) : ''
    ]);
  } catch (e) {
    // Don't let logging failures break anything
  }
}

// ----- OAuth callback endpoints for Twitch integration (if used) -----

function doGet(e) {
  try {
    // Serve control panel UI
    const p = e && e.parameter;
    if (p && (p.op === 'panel' || p.view === 'panel' || p.ui === '1')) {
      return HtmlService.createHtmlOutputFromFile('ktp_control_panel')
        .setTitle('KTP Weekly Matches Control Panel')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    // Basic ping test
    if (!p || !p.op || p.op === 'ping') {
      return _json_(_ok_({ now: new Date().toISOString() }));
    }
    // Twitch OAuth callback (saveTwitch)
    if (p.op === 'saveTwitch') {
      const secret = _secretFromRequest_(e);
      _checkSecret_(secret);
      const userId = String(p.userId || '').trim();
      const twitchUrl = String(p.twitch || p.twitchUrl || '').trim();
      if (!/^\d{5,30}$/.test(userId)) throw new Error('Invalid userId');
      if (!twitchUrl) throw new Error('Missing twitchUrl');
      _saveTwitchForUser_(userId, twitchUrl);
      return _json_(_ok_({ userId: userId, twitchUrl: twitchUrl }));
    }
    return _json_(_err_('Unknown op'));
  } catch (e2) {
    return _json_(_err_(e2));
  }
}

function doPost(e) {
  try {
    let body = {};
    if (e && e.postData && e.postData.type === 'application/json') {
      try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { body = {}; }
    }
    const op = body.op ? String(body.op) : (e.parameter && e.parameter.op ? String(e.parameter.op) : '');
    if (op === 'saveTwitch') {
      const secret = _secretFromRequest_(e);
      _checkSecret_(secret);
      const userId = String(body.userId != null ? body.userId : (e.parameter && e.parameter.userId) || '').trim();
      const twitchUrl = String(body.twitchUrl != null ? body.twitchUrl : (e.parameter && e.parameter.twitchUrl) || '').trim();
      if (!/^\d{5,30}$/.test(userId)) throw new Error('Invalid userId');
      if (!twitchUrl) throw new Error('Missing twitchUrl');
      _saveTwitchForUser_(userId, twitchUrl);
      return _json_(_ok_({ userId: userId, twitchUrl: twitchUrl }));
    }
    return _json_(_err_('Unknown op'));
  } catch (e2) {
    return _json_(_err_(e2));
  }
}

// ----- Minimal persistent storage for Twitch links -----

function _saveTwitchForUser_(userId, twitchUrl) {
  const key = 'TWITCH_URL__' + String(userId);
  _props_().setProperty(key, String(twitchUrl));
}

function server_getTwitchUrl(secret, userId) {
  try {
    _checkSecret_(secret);
    const key = 'TWITCH_URL__' + String(userId);
    const url = _props_().getProperty(key) || '';
    return _ok_({ userId: String(userId), twitchUrl: url });
  } catch (e) {
    return _err_(e);
  }
}