/**
 * WebApp endpoints + lightweight server_* helpers.
 *
 * Goals:
 *  - No stray braces or malformed template strings
 *  - Consistent JSON envelopes: { ok, data?, error? }
 *  - Secret checking for mutating ops
 *  - Backward-compatible wrappers that call into existing functions if present
 *
 * Expected (but not strictly required):
 *  - WM_WEBAPP_SHARED_SECRET in Script Properties
 *  - Functions from other files: upsertWeeklyDiscordMessage_, renderWeeklyBoard_, etc.
 */

// ---------- tiny utils ----------
function _props_() { return PropertiesService.getScriptProperties(); }
function _getProp_(k, d) { var v = _props_().getProperty(k); return v != null ? v : (d || ''); }
function _ok_(data) { return { ok: true, data: data != null ? data : null }; }
function _err_(e) { return { ok: false, error: (e && e.message) ? String(e.message) : String(e) }; }
function _json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Header or param secret
function _checkSecret_(secret) {
  var sp = PropertiesService.getScriptProperties();
  var expected = String(sp.getProperty('WM_WEBAPP_SHARED_SECRET') || '');
  if (!expected) throw new Error('Missing WM_WEBAPP_SHARED_SECRET');

  var got = String(secret == null ? '' : secret);

  // Allow header-style tokens and trim whitespace
  if (got.indexOf('Bearer ') === 0) got = got.slice(7);
  got = got.replace(/^\s+|\s+$/g, '');
  expected = expected.replace(/^\s+|\s+$/g, '');

  if (got !== expected) {
    Utilities.sleep(20); // tiny delay to reduce brute force attempts
    throw new Error('Forbidden: bad secret');
  }
}


// Try to extract secret from request
function _secretFromRequest_(e) {
  if (!e) return '';
  try {
    if (e.parameter && e.parameter.secret) return String(e.parameter.secret);
    if (e.postData && e.postData.type && e.postData.type.indexOf('application/json') !== -1) {
      var body = JSON.parse(e.postData.contents || '{}');
      if (body && body.secret) return String(body.secret);
    }
  } catch (ignore) {}
  return '';
}

// ---------- server_* endpoints (called by HTML UI / scripts) ----------
function server_getState() {
  try {
    var state = {
      lastStartId: _getProp_('LAST_SCHED_MSG_ID', ''),
      dryRun: _getProp_('DRY_RUN', ''),
      schedChannel: _getProp_('SCHED_INPUT_CHANNEL_ID', ''),
      weeklyChannel: _getProp_('WEEKLY_POST_CHANNEL_ID', ''),
      resultsChannel: _getProp_('RESULTS_LOG_CHANNEL_ID', '')
    };
    return _ok_(state);
  } catch (e) { return _err_(e); }
}

function server_setStartId(secret, id) {
  try {
    _checkSecret_(secret);
    var snowflake = String(id || '').trim();
    if (!/^\d{5,30}$/.test(snowflake)) throw new Error('Invalid message id');
    _props_().setProperty('LAST_SCHED_MSG_ID', snowflake);
    return _ok_({ id: snowflake });
  } catch (e) { return _err_(e); }
}

function server_clearStartId(secret) {
  try { _checkSecret_(secret); _props_().deleteProperty('LAST_SCHED_MSG_ID'); return _ok_({ cleared: true }); } catch (e) { return _err_(e); }
}

function server_postOrUpdate(secret) {
  try {
    _checkSecret_(secret);
    var w = getAlignedUpcomingWeekOrReport_();
    if (!w) return _ok_({ ok:false, reason:'no_aligned_week' });

    w.weekKey = w.weekKey || getWeekKeyFromWeek_(w);
    var res = upsertWeeklyDiscordMessage_(w) || {};
    res.ok = (res.ok !== false);
    res.weekKey = w.weekKey;
    var tz = w.tz || getTz_();
    res.range = w.label || (Utilities.formatDate(w.start, tz, 'MMM d') + '–' +
                            Utilities.formatDate(w.end,   tz, 'MMM d'));
    return _ok_(res);
  } catch (e) {
    return _err_(e);
  }
}

function server_verifyConfig(secret) {
  try { _checkSecret_(secret); verifyConfig_(); return { ok:true, data:{ message:'Config OK' } }; }
  catch (e) { return { ok:false, error:String(e && e.message || e) }; }
}

/** Start polling from a specific message ID (inclusive). */
function server_startPollingFrom(secret, startId, dryRun) {
  try {
    _checkSecret_(secret);
    var id = String(startId || '').trim();
    if (!/^\d{5,30}$/.test(id)) throw new Error('Invalid message id');

    // Store the starting pointer (inclusive)
    PropertiesService.getScriptProperties().setProperty('LAST_SCHED_MSG_ID', id);

    // Optional: flip DRY_RUN quickly from the UI (null/undefined = ignore)
    if (typeof dryRun !== 'undefined' && dryRun !== null) {
      PropertiesService.getScriptProperties().setProperty('DRY_RUN', String(dryRun));
    }

    var started = Date.now();
    // Kick the poller. Prefer the locked version if present.
    var result = null;
    if (typeof WM_pollScheduling_locked === 'function') {
      result = WM_pollScheduling_locked();
    } else if (typeof WM_pollScheduling === 'function') {
      result = WM_pollScheduling();
    } else {
      throw new Error('WM_pollScheduling_locked / WM_pollScheduling not found');
    }
    var tookMs = Date.now() - started;

    var lastPtr = PropertiesService.getScriptProperties().getProperty('LAST_SCHED_MSG_ID') || '';

    return _ok_({
      startedFrom: id,
      lastPointer: lastPtr,
      tookMs: tookMs,
      result: result || null
    });
  } catch (e) {
    return _err_(e);
  }
}

/** Start polling using the current stored pointer (whatever LAST_SCHED_MSG_ID is). */
function server_startPolling(secret) {
  try {
    _checkSecret_(secret);
    var started = Date.now();
    var result = null;
    if (typeof WM_pollScheduling_locked === 'function') {
      result = WM_pollScheduling_locked();
    } else if (typeof WM_pollScheduling === 'function') {
      result = WM_pollScheduling();
    } else {
      throw new Error('WM_pollScheduling_locked / WM_pollScheduling not found');
    }
    var tookMs = Date.now() - started;
    var lastPtr = PropertiesService.getScriptProperties().getProperty('LAST_SCHED_MSG_ID') || '';
    return _ok_({ lastPointer: lastPtr, tookMs: tookMs, result: result || null });
  } catch (e) {
    return _err_(e);
  }
}

// Build the exact cache key your parser uses (V4 example)
function _currentTeamIndexCacheKey_() {
  var sp = PropertiesService.getScriptProperties();
  return 'TEAM_INDEX_V4:' +
         (sp.getProperty('SPREADSHEET_ID') || '') + ':' +
         getDivisionSheets_().join(',');
}

/**
 * Webapp debug: inspect team index on the deployed runtime.
 * @param {string} secret - your panel/shared secret
 * @param {Object=} opts  - optional flags, e.g. { reset: true }
 * @return {_ok_ payload} { ok, cacheKey, spreadsheetId, divisions, totalTeams, byDivision, samples }
 */
function server_debugIndexSnapshot(secret, opts) {
  try {
    _checkSecret_(secret);
    opts = opts || {};

    var cacheKey = _currentTeamIndexCacheKey_();
    if (opts.reset === true || String(opts.reset).toLowerCase() === 'true') {
      CacheService.getScriptCache().remove(cacheKey);
    }

    var idx = getTeamIndexCached_();
    var total = (idx && idx.teams) ? idx.teams.length : 0;

    var counts = {};
    var samples = {};
    if (idx && idx.teams) {
      for (var i = 0; i < idx.teams.length; i++) {
        var t = idx.teams[i];
        var d = canonDivision_(t.division) || t.division || '(none)';
        counts[d] = (counts[d] || 0) + 1;
        if (!samples[d]) samples[d] = [];
        if (samples[d].length < 5) samples[d].push(t.name);
      }
    }

    var sp = PropertiesService.getScriptProperties();
    var divisions = getDivisionSheets_();

    return _ok_({
      ok: true,
      cacheKey: cacheKey,
      spreadsheetId: sp.getProperty('SPREADSHEET_ID') || '',
      divisions: divisions,
      totalTeams: total,
      byDivision: counts,
      samples: samples
    });
  } catch (e) {
    return _err_(e);
  }
}

// ---------- OAuth relay callback support ----------
// The Cloud Run relay may call the WebApp with op=saveTwitch to persist a Twitch URL for a Discord user.
// We accept both GET and POST and require the shared secret.

function doGet(e) {
  try {
    // ---- Serve control panel UI when requested ----
    var p = (e && e.parameter) || {};
    var t = HtmlService.createTemplateFromFile('ktp_control_panel');
    t.WM_SECRET = PropertiesService.getScriptProperties().getProperty('WM_WEBAPP_SHARED_SECRET') || '';
    if (p.op === 'panel' || p.view === 'panel' || p.ui === '1') {
      return HtmlService.createHtmlOutputFromFile('ktp_control_panel')
        .setTitle('KTP Weekly Matches Panel')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // ---- existing JSON routes (unchanged) ----
    var op = p.op ? String(p.op) : 'ping';
    if (op === 'ping') {
      return _json_(_ok_({ now: new Date().toISOString() }));
    }
    if (op === 'saveTwitch') {
      var secret = _secretFromRequest_(e);
      _checkSecret_(secret);
      var userId = String(p.userId || '').trim();
      var twitchUrl = String(p.twitchUrl || '').trim();
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
    var body = {};
    if (e && e.postData && e.postData.type && e.postData.type.indexOf('application/json') !== -1) {
      try { body = JSON.parse(e.postData.contents || '{}'); } catch (ignore) { body = {}; }
    }
    var op = (body.op) ? String(body.op) : (e && e.parameter && e.parameter.op ? String(e.parameter.op) : '');

    if (op === 'saveTwitch') {
      var secret = _secretFromRequest_(e);
      _checkSecret_(secret);
      var userId = String((body.userId != null ? body.userId : (e.parameter && e.parameter.userId)) || '').trim();
      var twitchUrl = String((body.twitchUrl != null ? body.twitchUrl : (e.parameter && e.parameter.twitchUrl)) || '').trim();
      if (!/^\d{5,30}$/.test(userId)) throw new Error('Invalid userId');
      if (!twitchUrl) throw new Error('Missing twitchUrl');
      _saveTwitchForUser_(userId, twitchUrl);
      return _json_(_ok_({ userId: userId, twitchUrl: twitchUrl }));
    }

    return _json_(_err_('Unknown op'));
  } catch (e2) { return _json_(_err_(e2)); }
}

// ---------- minimal persistence (replace if you have your own) ----------
function _saveTwitchForUser_(userId, twitchUrl) {
  // If you already have a store function, you can replace this body with it.
  var key = 'TWITCH_URL__' + String(userId);
  _props_().setProperty(key, String(twitchUrl));
}

function server_getTwitchUrl(secret, userId) {
  try {
    _checkSecret_(secret);
    var key = 'TWITCH_URL__' + String(userId);
    var url = _props_().getProperty(key) || '';
    return _ok_({ userId: String(userId), twitchUrl: url });
  } catch (e) { return _err_(e); }
}

function server_parseDebug(secret, line, hintDivision) {
  _checkSecret_(secret);
  return _ok_( parseDebug_(line, hintDivision) );
}

/**
 * Handle ":shoutcast: dod_map team1 vs team2"
 * If the user has a stored Twitch URL, update the row immediately.
 * If not, DM them to ask for it once, store placeholder; returns info.
 */
function server_shoutcastClaim(secret, rawText, userId, username) {
  _checkSecret_(secret);
  var cmd = parseShoutcastCommand_(String(rawText||''));
  if (!cmd.ok) return _ok_({ ok:false, reason: cmd.reason || 'bad_command' });

  var url = getTwitchForUser_(userId);
  if (!url) {
    // DM prompt to collect once
    try {
      if (typeof postDM_==='function') {
        postDM_(userId, "Hey "+(username||'there')+"! Please reply with your Twitch URL so I can attach it to the weekly board (e.g., https://twitch.tv/yourname).");
      }
      setTwitchForUser_(userId, username||'', '');
    } catch(_){}
    return _ok_({ ok:false, reason:'twitch_missing_prompted', map:cmd.map, home:cmd.home, away:cmd.away });
  }

  // Update the row now
  var wk = (typeof getAlignedUpcomingWeekOrReport_==='function') ? getAlignedUpcomingWeekOrReport_() : null;
  var wkKey = wk && wk.weekKey || '';
  if (!wkKey) return _ok_({ ok:false, reason:'no_wkKey' });

  var res = updateRowCasterInTablesMessage_(wkKey, cmd.map, cmd.home, cmd.away, url);
  return _ok_(res);
}

function server_applyScheduleText(secret, textOrDiscordMessage) {
  _checkSecret_(secret);

  // 1) Parse the message into pairs
  var parsed = parseScheduleMessage_v2(textOrDiscordMessage);
  if (!parsed || !parsed.ok || !parsed.pairs || !parsed.pairs.length) {
    return _ok_({ ok:false, reason: (parsed && parsed.errors && parsed.errors[0] && parsed.errors[0].reason) || 'no_pairs_found', parsed: parsed });
  }

  // 2) Resolve the active week key
  var week = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : null;
  var wkKey = (week && week.weekKey) || '';

  if (!wkKey) return _ok_({ ok:false, reason:'no_wkKey', parsed: parsed });

  // 3) Apply to the existing tables message (EDIT in place; no new posts)
  var res = updateTablesMessageFromPairs_(wkKey, parsed.pairs);

  // 4) Touch the header to refresh timestamp (optional but recommended)
  try { touchWeeklyHeaderTimestamp_(wkKey, week); } catch(_){}

  return _ok_({ ok: !!(res && res.ok), parsed: parsed, update: res, wkKey: wkKey });
}

// Run one poll cycle now (useful for a panel button)
function server_pollOnce(secret) {
  _checkSecret_(secret);
  var res = pollDiscordOnce_();
  return _ok_(res);
}

