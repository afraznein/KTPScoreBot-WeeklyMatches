// =======================
// 50_webapp.gs - Web App & API Endpoints
// =======================
// Purpose: HTTP endpoints for control panel, polling control, Discord relay testing
// Dependencies: 00_config.gs, 05_util.gs, 20_sheets.gs, 30_relay.gs, 55_rendering.gs, 60_parser.gs
// Used by: External web UI, Discord bot control panel
//
// Functions in this module:
// Helpers: props, getProp, ok, error, json
// Pointers: pointerKey, getPointer, setPointer
// Security: getAllowedSecrets, checkSecret, sanitizeSecretInput, secretFromRequest
// Endpoints: server_getState, server_setStartId, server_clearStartId, server_verifySecrets
//           server_resetWeeklyMsgIds, server_resetMsgIdsForCurrent, server_deleteWeeklyCluster
//           server_postOrUpdate, server_startPollingFrom, server_startPolling
//           server_probeRelay, server_probeRelayRoutes, server_backprocessMatch
// HTTP: doGet, doPost
//
// Total: 28 functions
// =======================

/**
 * Get script properties service instance.
 * @returns {PropertiesService.Properties} Script properties
 */
function props() { return PropertiesService.getScriptProperties(); }

/**
 * Get a script property value with optional default.
 * @param {string} key - Property key
 * @param {string} [def=''] - Default value if not found
 * @returns {string} Property value or default
 */
function getProp(key, def) {
  const v = props().getProperty(key);
  return v != null ? v : (def || '');
}

/**
 * Create a success response wrapper.
 * @param {*} data - Data to return
 * @returns {Object} {ok: true, data}
 */
function ok(data) {
  return { ok: true, data: data != null ? data : null };
}

/**
 * Create an error response wrapper.
 * @param {Error|string} err - Error object or message
 * @returns {Object} {ok: false, error: string}
 */
function error(err) {
  return { ok: false, error: err && err.message ? String(err.message) : String(err) };
}

/**
 * Convert object to JSON ContentService response.
 * @param {Object} obj - Object to serialize
 * @returns {ContentService.TextOutput} JSON response
 */
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Get the script property key for the Discord message pointer.
 * @returns {string} Pointer key name
 */
function pointerKey() { return 'DISCORD_LAST_POINTER'; }

/**
 * Get the last processed Discord message ID.
 * @returns {string} Message ID snowflake or empty string
 */
function getPointer() {return PropertiesService.getScriptProperties().getProperty(pointerKey()) || ''; }

/**
 * Store the last processed Discord message ID.
 * @param {string} id - Message ID snowflake to store
 */
function setPointer(id) { if (id) PropertiesService.getScriptProperties().setProperty(pointerKey(), String(id)); }

/**
 * Gather all acceptable authentication secrets from Script Properties and config globals.
 * Checks multiple property names for backwards compatibility.
 * @returns {string[]} Array of valid secret strings (de-duplicated)
 */
function getAllowedSecrets() {
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
    var v = sanitizeSecretInput(sp.getProperty(names[i]));
    if (v) out.push(v);
  }

  // From global constants in 00_config.gs (if defined)
  try {
    if (typeof WM_WEBAPP_SHARED_SECRET !== 'undefined') {
      var gv = sanitizeSecretInput(WM_WEBAPP_SHARED_SECRET);
      if (gv) out.push(gv);
    }
  } catch (_) { }
  try {
    if (typeof WEBAPP_SECRET !== 'undefined') {
      var gv2 = sanitizeSecretInput(WEBAPP_SECRET);
      if (gv2) out.push(gv2);
    }
  } catch (_) { }

  // de-dupe
  var uniq = {};
  for (var j = 0; j < out.length; j++) uniq[out[j]] = true;
  return Object.keys(uniq);
}

/**
 * Validate authentication secret. Throws error if invalid.
 * @param {string} secret - Secret to validate
 * @throws {Error} If secret doesn't match any allowed secrets
 */
function checkSecret(secret) {
  var s = sanitizeSecretInput(secret);
  var allowed = getAllowedSecrets();

  // Optional dev override via Script Properties
  var sp = PropertiesService.getScriptProperties();
  var devMode = String(sp.getProperty('DEV_MODE') || '').toLowerCase() === 'true';
  var devSecret = sanitizeSecretInput(sp.getProperty('SECRET_DEV') || '');

  if (s && allowed.indexOf(s) !== -1) return;
  if (devMode && devSecret && s === devSecret) return;

  throw new Error('Forbidden: bad secret');
}

/**
 * Normalize secret text to avoid invisible/odd character mismatches.
 * Removes zero-width chars, normalizes whitespace and quotes.
 * @param {string} x - Raw secret input
 * @returns {string} Sanitized secret string
 */
function sanitizeSecretInput(x) {
  var s = String(x || '');
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');        // zero-widths/BOM
  s = s.replace(/\s+/g, ' ').replace(/[""]/g, '"').replace(/['']/g, "'"); // normalize quotes/space
  return s.trim();
}

/**
 * Extract authentication secret from HTTP request.
 * Checks both URL parameters and JSON body.
 * @param {Object} e - Request event object
 * @returns {string} Secret string or empty if not found
 */
function secretFromRequest(e) {
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

/**
 * Get current bot configuration state.
 * @returns {Object} {ok: true, data: {lastStartId, schedChannel, weeklyChannel, resultsChannel}}
 */
/**
 * Get version information.
 * @returns {Object} {ok: true, data: {version, date}}
 */
function server_getVersion() {
  try {
    return ok({
      version: typeof VERSION !== 'undefined' ? VERSION : 'unknown',
      date: typeof VERSION_DATE !== 'undefined' ? VERSION_DATE : 'unknown'
    });
  } catch (e) {
    return error(e);
  }
}

/**
 * Get debug parser status.
 * @returns {Object} {ok: true, data: {debugParser: boolean}}
 */
function server_getDebugStatus() {
  try {
    return ok({
      debugParser: typeof DEBUG_PARSER !== 'undefined' ? DEBUG_PARSER : false
    });
  } catch (e) {
    return error(e);
  }
}

/**
 * Set debug parser status.
 * @param {string} secret - Authentication secret
 * @param {boolean} enabled - Enable or disable debug parser
 * @returns {Object} {ok: true, data: {debugParser: boolean}}
 */
function server_setDebugParser(secret, enabled) {
  try {
    checkSecret(secret);
    DEBUG_PARSER = !!enabled;
    return ok({
      debugParser: DEBUG_PARSER
    });
  } catch (e) {
    return error(e);
  }
}

/**
 * Get current state of polling pointers and channel IDs.
 * @returns {Object} {ok: true, data: {lastStartId, schedChannel, weeklyChannel, resultsChannel}}
 */
function server_getState() {
  try {
    const state = {
      lastStartId: getPointer(),  // Read from DISCORD_LAST_POINTER (same key setPointer() writes to)
      schedChannel: getProp('SCHED_INPUT_CHANNEL_ID', ''),
      weeklyChannel: getProp('WEEKLY_POST_CHANNEL_ID', ''),
      resultsChannel: getProp('RESULTS_LOG_CHANNEL_ID', '')
    };
    return ok(state);
  } catch (e) {
    return error(e);
  }
}

/**
 * Set the starting message ID for polling.
 * @param {string} secret - Authentication secret
 * @param {string} id - Discord message ID (snowflake)
 * @returns {Object} {ok: true, data: {id}} or {ok: false, error}
 */
function server_setStartId(secret, id) {
  try {
    checkSecret(secret);
    const snowflake = String(id || '').trim();
    if (!/^\d{5,30}$/.test(snowflake)) throw new Error('Invalid message id');
    setPointer(snowflake);  // Use setPointer() for consistency with parser
    return ok({ id: snowflake });
  } catch (e) {
    return error(e);
  }
}

/**
 * Clear the stored starting message ID.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {cleared: true}} or {ok: false, error}
 */
function server_clearStartId(secret) {
  try {
    checkSecret(secret);
    props().deleteProperty(pointerKey());  // Use pointerKey() for consistency with parser
    return ok({ cleared: true });
  } catch (e) {
    return error(e);
  }
}

/**
 * Verify which secrets are configured (returns metadata only, not values).
 * @returns {Object} {ok: true, data: {[key]: {present: boolean, length: number}}}
 */
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
    return ok(info);
  } catch (e) {
    return error(e);
  }
}

/**
 * Clear the stored Discord message IDs and content hashes for the current week.
 * Forces a full re-post on next upsert.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {weekKey, cleared, prevIds}} or {ok: false, error}
 */
function server_resetWeeklyMsgIds(secret) {
  try {
    if (typeof checkSecret === 'function') checkSecret(secret);

    // Derive the same wkKey your upsert uses
    var w = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : {};
    if (typeof syncHeaderMetaToTables === 'function') w = syncHeaderMetaToTables(w, 'Bronze');
    var wkKey = (typeof weekKey === 'function') ? weekKey(w)
      : (w && w.date ? Utilities.formatDate(w.date, 'America/New_York', 'yyyy-MM-dd') : '') + '|' + (w.mapRef || '');

    // Load, then clear
    var before = (typeof loadMsgIds === 'function') ? loadMsgIds(wkKey) : {};
    if (typeof clearMsgIds === 'function') clearMsgIds(wkKey);

    // Also clear the content hash so next post forces create/edit
    var hashKey = 'WEEKLY_MSG_HASHES::' + wkKey;
    PropertiesService.getScriptProperties().deleteProperty(hashKey);

    return (typeof ok === 'function')
      ? ok({ weekKey: wkKey, cleared: true, prevIds: before })
      : { ok: true, data: { weekKey: wkKey, cleared: true, prevIds: before } };
  } catch (e) {
    return (typeof error === 'function') ? error(e) : { ok: false, error: String(e && e.message || e) };
  }
}

/**
 * Alias for HTML control panel compatibility.
 * @param {string} secret - Authentication secret
 * @returns {Object} Result from server_resetWeeklyMsgIds()
 */
function server_resetMsgIdsForCurrent(secret) {
  return server_resetWeeklyMsgIds(secret);
}

/**
 * List all weeks that have stored Discord message IDs.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {weeks: [{weekKey, ids: {header, table, rematch}}]}} or {ok: false, error}
 */
function server_listWeeksWithMessageIds(secret) {
  try {
    checkSecret(secret);

    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var weeks = [];

    // Find all WEEKLY_MSG_IDS:: keys
    for (var key in allProps) {
      if (key.indexOf('WEEKLY_MSG_IDS::') === 0) {
        var weekKey = key.replace('WEEKLY_MSG_IDS::', '');
        var ids = (typeof loadMsgIds === 'function') ? loadMsgIds(weekKey) : {};

        // Only include if there are actual IDs stored
        if (ids.header || ids.table || ids.rematch) {
          weeks.push({
            weekKey: weekKey,
            ids: {
              header: ids.header || '',
              table: ids.table || '',
              rematch: ids.rematch || ''
            }
          });
        }
      }
    }

    // Sort by weekKey (newest first)
    weeks.sort(function(a, b) {
      return b.weekKey > a.weekKey ? 1 : (b.weekKey < a.weekKey ? -1 : 0);
    });

    return ok({ weeks: weeks });
  } catch (e) {
    return error(e);
  }
}

/**
 * Clear stored message IDs and hashes for a specific week.
 * Useful when Discord messages were manually deleted but IDs are still stored.
 * @param {string} secret - Authentication secret
 * @param {string} weekKey - Week key in format "YYYY-MM-DD|mapname"
 * @returns {Object} {ok: true, data: {weekKey, cleared: true, prevIds}} or {ok: false, error}
 */
function server_resetMsgIdsForWeek(secret, weekKey) {
  try {
    checkSecret(secret);
    if (!weekKey || typeof weekKey !== 'string' || weekKey.indexOf('|') < 0) {
      throw new Error('Invalid weekKey format (expected "YYYY-MM-DD|mapname")');
    }

    var before = (typeof loadMsgIds === 'function') ? loadMsgIds(weekKey) : {};
    if (typeof clearMsgIds === 'function') clearMsgIds(weekKey);

    // Also clear the content hashes so next post forces create
    var hashKey = 'WEEKLY_MSG_HASHES::' + weekKey;
    var remKey = 'WEEKLY_REMATCH_HASH::' + weekKey;
    PropertiesService.getScriptProperties().deleteProperty(hashKey);
    PropertiesService.getScriptProperties().deleteProperty(remKey);

    return ok({ weekKey: weekKey, cleared: true, prevIds: before });
  } catch (e) {
    return error(e);
  }
}

/**
 * Delete all Discord messages for the current week's cluster (header + tables + rematches).
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {weekKey, deleted: {attempted, ok, fail}}} or {ok: false, error}
 */
function server_deleteWeeklyCluster(secret) {
  try {
    checkSecret(secret);

    var week = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : null;
    if (!week || !week.date) throw new Error('No aligned week');

    var wkKey = (typeof weekKey === 'function') ? weekKey(week) : '';
    if (!wkKey) throw new Error('No weekKey');

    var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
      (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
    if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

    var ids = loadMsgIds(wkKey);

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
        if (deleteMessage(channelId, toDelete[i])) {
          results.ok.push(toDelete[i]);
        } else {
          results.fail.push(toDelete[i]);
        }
      } catch (e) {
        results.fail.push(toDelete[i] + ' :: ' + (e && e.message));
      }
    }

    // Clear stored IDs and known hash keys for this week
    PropertiesService.getScriptProperties().deleteProperty(msgIdsKey(wkKey));
    PropertiesService.getScriptProperties().deleteProperty('WEEKLY_MSG_HASHES::' + wkKey);
    PropertiesService.getScriptProperties().deleteProperty('WEEKLY_REMATCH_HASH::' + wkKey); // if you used a separate key earlier

    // Optional: log a concise summary
    try {
      logLocal('INFO', 'weekly.cluster.deleted', {
        wkKey: wkKey, channelId: channelId,
        deletedCount: results.ok.length, failedCount: results.fail.length,
        ok: results.ok, fail: results.fail
      });
    } catch (_) { }

    return ok({ weekKey: wkKey, deleted: results });
  } catch (e) {
    return error(e);
  }
}

/**
 * Post or update the weekly Discord message boards for the current week.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {action, ...}} or {ok: false, error}
 */
function server_postOrUpdate(secret) {
  try {
    checkSecret(secret);
    var w = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : null;
    var res = upsertWeeklyDiscordMessage(w);
    logToWmSheet('INFO', 'weekly_upsert', 'ok', res)
    return ok(res);  // <- res already has ok/action/etc.
  } catch (e) {
    return error(e);
  }
}

/**
 * Start polling Discord messages from a specific message ID (inclusive).
 * Processes all messages starting from and including the specified ID.
 * @param {string} secret - Authentication secret
 * @param {string} startId - Discord message ID to start from (inclusive)
 * @param {boolean} [skipScheduled=false] - Skip matches that already have schedules
 * @returns {Object} {ok: true, data: {processed, updated, skipped, errors, lastPointer, tookMs}}
 */
function server_startPollingFrom(secret, startId, skipScheduled) {
  try {
    checkSecret(secret);
    var channelId = PropertiesService.getScriptProperties().getProperty('SCHED_INPUT_CHANNEL_ID');
    if (!channelId) throw new Error('SCHED_INPUT_CHANNEL_ID is missing');
    if (!startId) throw new Error('startId parameter is required');

    var t0 = Date.now();
    var opts = { inclusive: true };
    if (skipScheduled) opts.skipScheduled = true;
    var summary = pollAndProcessFromId(channelId, String(startId), opts);

    // Normalize field names for UI compatibility
    summary.tookMs = Date.now() - t0;
    summary.updated = summary.updatedPairs || 0;
    summary.skipped = summary.skippedPairs || 0;
    summary.errors = Array.isArray(summary.errors) ? summary.errors.length : 0;

    return ok(summary);
  } catch (e) {
    // Enhanced error handling for debugging
    var errMsg = 'Unknown error';
    if (e && e.message) {
      errMsg = String(e.message);
    } else if (e && e.toString) {
      errMsg = e.toString();
    } else if (e) {
      errMsg = JSON.stringify(e);
    }
    return error(new Error('server_startPollingFrom: ' + errMsg));
  }
}

/**
 * Continue polling Discord messages from the last saved pointer (exclusive).
 * Processes new messages since the last poll.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {processed, updatedPairs, errors, lastPointer, tookMs}}
 */
function server_startPolling(secret) {
  try {
    checkSecret(secret);
    var channelId = PropertiesService.getScriptProperties().getProperty('SCHED_INPUT_CHANNEL_ID');
    if (!channelId) throw new Error('SCHED_INPUT_CHANNEL_ID is missing');

    var startId = getPointer();
    var t0 = Date.now();
    var summary = pollAndProcessFromId(channelId, startId, { inclusive: false });
    summary.tookMs = Date.now() - t0;
    return ok(summary);
  } catch (e) {
    return error(e);
  }
}

/**
 * Test connectivity to the Discord relay server.
 * Attempts to fetch recent messages and optional health/whoami endpoints.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {messages, health, whoami, ...errors}} or {ok: false, error}
 */
function server_probeRelay(secret) {
  try {
    checkSecret(secret); // your webapp secret check
    var channelId = PropertiesService.getScriptProperties().getProperty('POLL_CHANNEL_ID') ||
      PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID');
    if (!channelId) throw new Error('POLL_CHANNEL_ID or WEEKLY_POST_CHANNEL_ID missing');

    var out = {};
    // minimal messages call
    try {
      out.messages = fetchChannelMessages(channelId, { limit: 1 }) || [];
    } catch (e) {
      out.messagesError = String(e && e.message || e);
    }
    // optional health/whoami if your relay exposes them
    try { out.health = relayFetch('/health', { method: 'get' }); } catch (e) { out.healthError = String(e && e.message || e); }
    try { out.whoami = relayFetch('/whoami', { method: 'get' }); } catch (e) { out.whoamiError = String(e && e.message || e); }

    return ok(out);
  } catch (e) {
    return error(e);
  }
}

/**
 * Probe all configured Discord relay routes to verify connectivity.
 * Tests GET-friendly endpoints (health, whoami) and message fetching.
 * @param {string} secret - Authentication secret
 * @returns {Object} {ok: true, data: {health, whoami, messages, paths}} or {ok: false, error}
 */
function server_probeRelayRoutes(secret) {
  try {
    checkSecret(secret);
    var p = (typeof getRelayPaths === 'function') ? getRelayPaths() : {};
    var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
      PropertiesService.getScriptProperties().getProperty('POLL_CHANNEL_ID') || '';

    var results = {};

    function tryGet(label, path) {
      if (!path) return results[label] = { skip: true };
      try {
        var r = relayFetch(path, { method: 'get' }); // many POST routes won't accept GET; that's fine
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
        var page = fetchChannelMessages(channelId, { limit: 1 }) || [];
        results.messages = { ok: true, count: page.length, sampleId: (page[0] && page[0].id) || null, path: p.messages };
      } catch (e) {
        results.messages = { ok: false, error: String(e && e.message || e), path: p.messages };
      }
    } else {
      results.messages = { ok: false, error: 'No channelId to test', path: p.messages };
    }

    // Report configured paths so you can verify
    results.paths = p;

    return ok(results);
  } catch (e) {
    return error(e);
  }
}

/**
 * Back-process a match without requiring a map hint.
 *
 * @param {string} secret - Authentication secret
 * @param {string} division - Division name (Bronze/Silver/Gold)
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @param {string} whenText - Schedule time text (e.g., "9:00 PM ET")
 * @param {number} epochSec - Optional epoch timestamp
 * @returns {Object} Result with match location and update status
 */
function server_backprocessMatch(secret, division, homeTeam, awayTeam, whenText, epochSec) {
  try {
    checkSecret(secret);

    // Validate inputs
    if (!division || !homeTeam || !awayTeam) {
      throw new Error('Missing required fields: division, homeTeam, awayTeam');
    }

    // Resolve team aliases
    var home = (typeof resolveTeamAlias === 'function')
      ? resolveTeamAlias(homeTeam)
      : homeTeam;
    var away = (typeof resolveTeamAlias === 'function')
      ? resolveTeamAlias(awayTeam)
      : awayTeam;

    // Find the match in the sheets
    var match =findMatchAcrossAllWeeks(division, home, away);

    if (!match) {
      return error('Match not found in any week: ' + home + ' vs ' + away + ' in ' + division);
    }

    // Build the update pair
    var pair = {
      division: division,
      home: home,
      away: away,
      whenText: whenText || 'TBD',
      weekKey: match.weekKey
    };

    if (epochSec) {
      pair.epochSec = parseInt(epochSec, 10);
    }

    // Update the match using existing update logic
    var updateResult = null;
    if (typeof updateTablesMessageFromPairs === 'function') {
      updateResult = updateTablesMessageFromPairs(match.weekKey, [pair]);
    }

    // Log the back-process action
    if (typeof logMatchToWMLog === 'function') {
      logMatchToWMLog(pair, 'backprocess', 'backprocess', false, false);
    }

    if (typeof sendLog === 'function') {
      sendLog('✅ Back-processed: ' + division + ' • ' + match.map + ' • ' + home + ' vs ' + away + ' • ' + (whenText || 'TBD'));
    }

    return ok({
      found: true,
      match: {
        weekKey: match.weekKey,
        map: match.map,
        date: match.date,
        blockTop: match.blockTop,
        row: match.row
      },
      pair: pair,
      updateResult: updateResult
    });

  } catch (e) {
    return error(e);
  }
}

// ----- HTTP Handlers (doGet / doPost) -----

/**
 * Handle HTTP GET requests to the web app.
 * Supports control panel UI, version info, ping test, and Twitch OAuth callback.
 * @param {Object} e - Event object with query parameters
 * @param {Object} e.parameter - Query string parameters
 * @returns {HtmlService.HtmlOutput|ContentService.TextOutput} HTML page or JSON response
 */
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
      const info = (typeof getVersionInfo === 'function') ? getVersionInfo() : { version: '0.0.0', date: 'unknown', formatted: 'v0.0.0 (unknown)' };
      return json(ok(info));
    }
    // Basic ping test
    if (!p || !p.op || p.op === 'ping') {
      return json(ok({ now: new Date().toISOString() }));
    }
    // Twitch OAuth callback (saveTwitch)
    if (p.op === 'saveTwitch') {
      const secret = secretFromRequest(e);
      checkSecret(secret);
      const userId = String(p.userId || '').trim();
      const twitchUrl = String(p.twitch || p.twitchUrl || '').trim();
      if (!/^\d{5,30}$/.test(userId)) throw new Error('Invalid userId');
      if (!twitchUrl) throw new Error('Missing twitchUrl');
      saveTwitchForUser(userId, twitchUrl);
      return json(ok({ userId: userId, twitchUrl: twitchUrl }));
    }
    return json(error('Unknown op'));
  } catch (e2) {
    return json(error(e2));
  }
}

/**
 * Handle HTTP POST requests to the web app.
 * Currently supports Twitch OAuth callback operations via POST.
 * @param {Object} e - Event object with POST data
 * @param {Object} e.postData - POST body data
 * @param {Object} e.parameter - Query string parameters
 * @returns {ContentService.TextOutput} JSON response
 */
function doPost(e) {
  try {
    let body = {};
    if (e && e.postData && e.postData.type === 'application/json') {
      try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { body = {}; }
    }
    const op = body.op ? String(body.op) : (e.parameter && e.parameter.op ? String(e.parameter.op) : '');
    if (op === 'saveTwitch') {
      const secret = secretFromRequest(e);
      checkSecret(secret);
      const userId = String(body.userId != null ? body.userId : (e.parameter && e.parameter.userId) || '').trim();
      const twitchUrl = String(body.twitchUrl != null ? body.twitchUrl : (e.parameter && e.parameter.twitchUrl) || '').trim();
      if (!/^\d{5,30}$/.test(userId)) throw new Error('Invalid userId');
      if (!twitchUrl) throw new Error('Missing twitchUrl');
      saveTwitchForUser(userId, twitchUrl);
      return json(ok({ userId: userId, twitchUrl: twitchUrl }));
    }
    return json(error('Unknown op'));
  } catch (e2) {
    return json(error(e2));
  }
}