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
/** Where we store the “last processed message id” pointer */
function _pointerKey_() { return 'DISCORD_LAST_POINTER'; }
function _getPointer_() {
  return PropertiesService.getScriptProperties().getProperty(_pointerKey_()) || '';
}
function _setPointer_(id) {
  if (id) PropertiesService.getScriptProperties().setProperty(_pointerKey_(), String(id));
}

/** Gather all acceptable secrets from Script Properties + config globals. */
function _getAllowedSecrets_() {
  var sp = PropertiesService.getScriptProperties();
  var names = [
    // Script Properties keys we’ll accept:
    'WM_WEBAPP_SHARED_SECRET',     // <-- your preferred name
    'WEBAPP_SECRET',
    'WEBAPP_SECRET_V2',
    'RELAY_SHARED_SECRET',
    'PANEL_SECRET'
  ];
  var out = [];

  // From Script Properties
  for (var i = 0; i < names.length; i++) {
    var v = _sanitizeSecretInput_(sp.getProperty(names[i]));
    if (v) out.push(v);
  }

  // From global constants in 00_config.gs (if defined)
  try {
    if (typeof WM_WEBAPP_SHARED_SECRET !== 'undefined') {
      var gv = _sanitizeSecretInput_(WM_WEBAPP_SHARED_SECRET);
      if (gv) out.push(gv);
    }
  } catch (_) { }
  try {
    if (typeof WEBAPP_SECRET !== 'undefined') {
      var gv2 = _sanitizeSecretInput_(WEBAPP_SECRET);
      if (gv2) out.push(gv2);
    }
  } catch (_) { }

  // de-dupe
  var uniq = {};
  for (var j = 0; j < out.length; j++) uniq[out[j]] = true;
  return Object.keys(uniq);
}

/** Centralized secret check. Throws on mismatch. */
function _checkSecret_(secret) {
  var s = _sanitizeSecretInput_(secret);
  var allowed = _getAllowedSecrets_();

  // Optional dev override via Script Properties
  var sp = PropertiesService.getScriptProperties();
  var devMode = String(sp.getProperty('DEV_MODE') || '').toLowerCase() === 'true';
  var devSecret = _sanitizeSecretInput_(sp.getProperty('SECRET_DEV') || '');

  if (s && allowed.indexOf(s) !== -1) return;
  if (devMode && devSecret && s === devSecret) return;

  throw new Error('Forbidden: bad secret');
}

/** Normalize secret text to avoid invisible/odd chars mismatching. */
function _sanitizeSecretInput_(x) {
  var s = String(x || '');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');        // zero-widths/BOM
  s = s.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); // normalize quotes/space
  return s.trim();
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
  } catch (ignore) { }
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

function server_verifySecrets() {
  try {
    var sp = PropertiesService.getScriptProperties();
    var keys = ['WM_WEBAPP_SHARED_SECRET', 'WEBAPP_SECRET', 'WEBAPP_SECRET_V2', 'RELAY_SHARED_SECRET', 'PANEL_SECRET', 'DEV_MODE', 'SECRET_DEV'];
    var info = {};
    keys.forEach(function (k) {
      var v = sp.getProperty(k);
      info[k] = v ? { present: true, length: v.length } : { present: false, length: 0 };
    });
    // Also show which globals are compiled in (without values)
    info._globals = {
      WM_WEBAPP_SHARED_SECRET: (typeof WM_WEBAPP_SHARED_SECRET !== 'undefined'),
      WEBAPP_SECRET: (typeof WEBAPP_SECRET !== 'undefined')
    };
    return _ok_(info);
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
    return (typeof _err_ === 'function') ? _err_(e) : { ok: false, error: String(e && e.message || e) };
  }
}

/** Alias for HTML control panel compatibility */
function server_resetMsgIdsForCurrent(secret) {
  return server_resetWeeklyMsgIds(secret);
}

function server_deleteWeeklyCluster(secret) {
  try {
    _checkSecret_(secret);

    var week = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : null;
    if (!week || !week.date) throw new Error('No aligned week');

    var wkKey = (typeof weekKey_ === 'function') ? weekKey_(week) : '';
    if (!wkKey) throw new Error('No weekKey');

    var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
      (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
    if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

    var ids = _loadMsgIds_(wkKey);

    // Gather all candidate message IDs (header + weekly table(s) + rematch(es))
    var toDelete = [];
    if (ids.header) toDelete.push(ids.header);
    if (ids.table) toDelete.push(ids.table);
    if (ids.rematch) toDelete.push(ids.rematch);
    if (Array.isArray(ids.tables)) toDelete = toDelete.concat(ids.tables);
    if (Array.isArray(ids.rematches)) toDelete = toDelete.concat(ids.rematches);

    // De-duplicate & strip empties
    var seen = {};
    toDelete = toDelete.filter(function (x) {
      x = String(x || '').trim();
      if (!x) return false;
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });

    var results = { attempted: toDelete.slice(), ok: [], fail: [] };
    for (var i = 0; i < toDelete.length; i++) {
      try {
        if (deleteMessage_(channelId, toDelete[i])) {
          results.ok.push(toDelete[i]);
        } else {
          results.fail.push(toDelete[i]);
        }
      } catch (e) {
        results.fail.push(toDelete[i] + ' :: ' + (e && e.message));
      }
    }

    // Clear stored IDs and known hash keys for this week
    PropertiesService.getScriptProperties().deleteProperty(_msgIdsKey_(wkKey));
    PropertiesService.getScriptProperties().deleteProperty('WEEKLY_MSG_HASHES::' + wkKey);
    PropertiesService.getScriptProperties().deleteProperty('WEEKLY_REMATCH_HASH::' + wkKey); // if you used a separate key earlier

    // Optional: log a concise summary
    try {
      logLocal_('INFO', 'weekly.cluster.deleted', {
        wkKey: wkKey, channelId: channelId,
        deletedCount: results.ok.length, failedCount: results.fail.length,
        ok: results.ok, fail: results.fail
      });
    } catch (_) { }

    return _ok_({ weekKey: wkKey, deleted: results });
  } catch (e) {
    return _err_(e);
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

/** Public: Start polling from a specific message ID (inclusive). */
function server_startPollingFrom(secret, startId) {
  try {
    _checkSecret_(secret);
    var channelId = PropertiesService.getScriptProperties().getProperty('SCHED_INPUT_CHANNEL_ID')
    if (!channelId) throw new Error('SCHED_INPUT_CHANNEL_ID is missing');

    var t0 = Date.now();
    var summary = _pollAndProcessFromId_(channelId, String(startId), { inclusive: true });
    summary.tookMs = Date.now() - t0;
    return _ok_(summary);
  } catch (e) {
    return _err_(e);
  }
}

/** Public: Continue polling from last pointer (exclusive). */
function server_startPolling(secret) {
  try {
    _checkSecret_(secret);
    var channelId = PropertiesService.getScriptProperties().getProperty('SCHED_INPUT_CHANNEL_ID');
    if (!channelId) throw new Error('SCHED_INPUT_CHANNEL_ID is missing');

    var startId = _getPointer_();
    var t0 = Date.now();
    var summary = _pollAndProcessFromId_(channelId, startId, { inclusive: false });
    summary.tookMs = Date.now() - t0;
    return _ok_(summary);
  } catch (e) {
    return _err_(e);
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
    // Version info endpoint
    if (p.op === 'version' || p.op === 'v') {
      const info = (typeof getVersionInfo_ === 'function') ? getVersionInfo_() : { version: '0.0.0', date: 'unknown', formatted: 'v0.0.0 (unknown)' };
      return _json_(_ok_(info));
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

function server_probeRelay(secret) {
  try {
    _checkSecret_(secret); // your webapp secret check
    var channelId = PropertiesService.getScriptProperties().getProperty('POLL_CHANNEL_ID') ||
      PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID');
    if (!channelId) throw new Error('POLL_CHANNEL_ID or WEEKLY_POST_CHANNEL_ID missing');

    var out = {};
    // minimal messages call
    try {
      out.messages = fetchChannelMessages_(channelId, { limit: 1 }) || [];
    } catch (e) {
      out.messagesError = String(e && e.message || e);
    }
    // optional health/whoami if your relay exposes them
    try { out.health = relayFetch_('/health', { method: 'get' }); } catch (e) { out.healthError = String(e && e.message || e); }
    try { out.whoami = relayFetch_('/whoami', { method: 'get' }); } catch (e) { out.whoamiError = String(e && e.message || e); }

    return _ok_(out);
  } catch (e) {
    return _err_(e);
  }
}

function server_probeRelayRoutes(secret) {
  try {
    _checkSecret_(secret);
    var p = (typeof getRelayPaths_ === 'function') ? getRelayPaths_() : {};
    var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
      PropertiesService.getScriptProperties().getProperty('POLL_CHANNEL_ID') || '';

    var results = {};

    function tryGet(label, path) {
      if (!path) return results[label] = { skip: true };
      try {
        var r = relayFetch_(path, { method: 'get' }); // many POST routes won’t accept GET; that’s fine
        results[label] = { ok: true, code: 200, sample: r };
      } catch (e) {
        results[label] = { ok: false, error: String(e && e.message || e), path: path };
      }
    }

    // Probe GET-friendly endpoints first
    tryGet('health', p.health);
    tryGet('whoami', p.whoami);

    // Probe messages with limit=1 (read-only)
    if (channelId) {
      try {
        var page = fetchChannelMessages_(channelId, { limit: 1 }) || [];
        results.messages = { ok: true, count: page.length, sampleId: (page[0] && page[0].id) || null, path: p.messages };
      } catch (e) {
        results.messages = { ok: false, error: String(e && e.message || e), path: p.messages };
      }
    } else {
      results.messages = { ok: false, error: 'No channelId to test', path: p.messages };
    }

    // Report configured paths so you can verify
    results.paths = p;

    return _ok_(results);
  } catch (e) {
    return _err_(e);
  }
}