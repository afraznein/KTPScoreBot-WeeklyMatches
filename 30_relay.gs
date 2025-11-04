// =======================
// 30_relay.gs - Discord API & Relay HTTP
// =======================
// Purpose: Discord relay HTTP wrappers, fetch/post/edit/delete messages
// Dependencies: 00_config.gs, 05_util.gs
// Used by: 40_logging.gs, 50_rendering.gs, 60_parser.gs
//
// Functions in this module:
// - sp(k, dflt)
// - getRelayBase()
// - getRelayPaths()
// - getRelayHeaders()
// - normalizeRelayUrl(path)
// - getRelayTimeoutMs()
// - relayFetch(path, opt)
// - tryParseJson(s)
// - handleIncomingDiscordEvent(payload)
// - contentFromRelay(payload)
// - textFromEmbeds(embeds)
// - fetchSingleMessageInclusive(channelId, messageId)
// - fetchChannelMessages(channelId, params)
// - fetchMessageById(channelId, messageId)
// - postChannelMessage(channelId, content)
// - postChannelMessageAdvanced(channelId, content, embeds)
// - editChannelMessage(channelId, messageId, newContent)
// - editChannelMessageAdvanced(channelId, messageId, content, embeds)
// - deleteMessage(channelId, messageId)
//
// Total: 19 functions
// =======================

// ---------- RELAY HTTP CORE ----------

/* =========================
   Relay base / headers / fetch
   ========================= */
/** Script Property helper */
function sp(k, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v != null && v !== '') ? String(v) : (dflt == null ? '' : String(dflt));
}

/** Relay base URL (no trailing slash) */
function getRelayBase() {
  var cands = [
    sp('RELAY_BASE'),
    sp('DISCORD_RELAY_BASE'),
    sp('WM_RELAY_BASE_URL'),
    (typeof RELAY_BASE !== 'undefined' ? RELAY_BASE : ''),
    (typeof DISCORD_RELAY_BASE !== 'undefined' ? DISCORD_RELAY_BASE : ''),
    (typeof WM_RELAY_BASE_URL !== 'undefined' ? WM_RELAY_BASE_URL : '')
  ];
  for (var i = 0; i < cands.length; i++) {
    var v = String(cands[i] || '').trim();
    if (v) { if (v.endsWith('/')) v = v.slice(0, -1); return v; }
  }
  throw new Error('Relay base URL missing (set RELAY_BASE).');
}

function getRelayPaths() {
  var paths = {
    messages: sp('RELAY_PATH_MESSAGES', '/messages'),
    message: sp('RELAY_PATH_MESSAGE', '/message'),     // used as /message/:channelId/:messageId
    reply: sp('RELAY_PATH_REPLY', '/reply'),       // your server.js
    post: sp('RELAY_PATH_POST', '/reply'),       // synonym (old code may use "post")
    edit: sp('RELAY_PATH_EDIT', '/edit'),
    del: sp('RELAY_PATH_DELETE', '/delete'),      // used as /delete/:channelId/:messageId
    dm: sp('RELAY_PATH_DM', '/dm'),
    react: sp('RELAY_PATH_REACT', '/react'),
    health: sp('RELAY_PATH_HEALTH', '/health'),
    whoami: sp('RELAY_PATH_WHOAMI', '/whoami')
  };
  return paths;
}

/** Build headers for talking to the relay (adds shared secret in common formats). */
function getRelayHeaders() {
  var secret =
    sp('RELAY_AUTH') ||
    sp('WM_RELAY_SHARED_SECRET') ||
    (typeof RELAY_AUTH !== 'undefined' ? RELAY_AUTH : '') ||
    (typeof WM_RELAY_SHARED_SECRET !== 'undefined' ? WM_RELAY_SHARED_SECRET : '');
  var h = { 'Content-Type': 'application/json' };
  if (secret) h['X-Relay-Auth'] = String(secret);  // your server.js expects this
  return h;
}

/** Normalize a path/URL. Accepts absolute URLs or relative paths. */
function normalizeRelayUrl(path) {
  if (typeof path !== 'string' || !path) {
    throw new Error('relayFetch: path is missing or not a string');
  }
  // If caller passed a full URL, use as-is
  if (/^https?:\/\//i.test(path)) return path;
  var base = getRelayBase();
  return base + (path.charAt(0) === '/' ? path : ('/' + path));
}


/** Optional: central place to tune timeouts for relay calls. */
function getRelayTimeoutMs() {
  // Default 20s; adjust if your Cloud Run/Functions are slower
  var sp = PropertiesService.getScriptProperties();
  var v = sp.getProperty('RELAY_TIMEOUT_MS');
  var n = v ? parseInt(v, 10) : 20000;
  return isNaN(n) ? 20000 : Math.max(5000, n);
}

/** Fetch wrapper */
function relayFetch(path, opt) {
  opt = opt || {};
  var url = normalizeRelayUrl(path);

  var params = {
    method: (opt.method || 'get').toLowerCase(),
    headers: Object.assign({}, getRelayHeaders(), (opt.headers || {})),
    muteHttpExceptions: true,
    timeout: (function () { var n = parseInt(sp('RELAY_TIMEOUT_MS', '20000'), 10); return isNaN(n) ? 20000 : Math.max(5000, n); })()
  };

  if (opt.method && /post|put|patch|delete/i.test(opt.method) && typeof opt.payload !== 'undefined') {
    params.payload = (typeof opt.payload === 'string') ? opt.payload : JSON.stringify(opt.payload);
    if (!params.headers['Content-Type']) params.headers['Content-Type'] = 'application/json';
  }

  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('relayFetch HTTP ' + code + ' for ' + url + ': ' + body);
  }
  try { return JSON.parse(body); } catch (_) { return body; }
}

/** Parse JSON text safely (returns null on failure). */
function tryParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------- RELAY API WRAPPERS ----------

function handleIncomingDiscordEvent(payload) {
  var text = contentFromRelay(payload);
  if (!text) return { ok: false, error: 'empty' };

  var parsed = parseScheduleMessage_v3(text); // your parser
  if (!parsed.ok) return parsed;

  // group by wkKey and update
  var groups = {};
  parsed.pairs.forEach(function (p) { (groups[p.weekKey] = groups[p.weekKey] || []).push(p); });
  for (var wk in groups) {
    updateTablesMessageFromPairs(wk, groups[wk]);
  }
  return { ok: true };
}

function contentFromRelay(payload) {
  if (payload == null) return '';

  // Fast path: already a string
  if (typeof payload === 'string') return normalizeWhitespace(payload);

  // Try common wrappers
  var msg = payload;
  if (msg.message && typeof msg.message === 'object') msg = msg.message;
  else if (msg.data && typeof msg.data === 'object') msg = msg.data;
  else if (msg.d && typeof msg.d === 'object') msg = msg.d; // gateway-style

  // 1) Direct content
  var parts = [];
  if (msg.content && typeof msg.content === 'string') {
    parts.push(msg.content);
  }

  // 2) Embeds (title/description/fields) if no or minimal content
  if ((!parts.length || isJustPings(parts.join(' '))) && Array.isArray(msg.embeds) && msg.embeds.length) {
    parts.push(textFromEmbeds(msg.embeds));
  }

  // 3) Referenced (reply) message content, if present
  var ref = msg.referenced_message || (msg.message && msg.message.referenced_message);
  if ((!parts.length || isJustPings(parts.join(' '))) && ref && typeof ref.content === 'string') {
    parts.push(ref.content);
  }

  // 4) Fallback to any "clean_content" style fields if your relay provides them
  if (!parts.length && typeof msg.clean_content === 'string') {
    parts.push(msg.clean_content);
  }

  // 5) If still nothing, try attachments names as a hint (rarely useful for scheduling)
  if (!parts.length && Array.isArray(msg.attachments) && msg.attachments.length) {
    var names = msg.attachments.map(function (a) { return a && a.filename ? a.filename : ''; })
      .filter(Boolean)
      .join(' ');
    if (names) parts.push(names);
  }

  // 6) Final normalize
  var text = normalizeWhitespace(parts.filter(Boolean).join('\n').trim());

  // Strip common noise that often slips through relays; keep it *light*
  text = text.replace(/<[@#][!&]?\d+>/g, ' ')      // <@123>, <@!123>, <#123>, <@&role>
    .replace(/<:[a-z0-9_]+:\d+>/gi, ' ')  // <:emoji:12345>
    .replace(/:[a-z0-9_]+:/gi, ' ');      // :emoji:

  return normalizeWhitespace(text);
}

/* ----------------------- helpers ----------------------- */
function textFromEmbeds(embeds) {
  var out = [];
  for (var i = 0; i < embeds.length; i++) {
    var e = embeds[i] || {};
    if (e.title) out.push(String(e.title));
    if (e.description) out.push(String(e.description));
    if (Array.isArray(e.fields)) {
      for (var j = 0; j < e.fields.length; j++) {
        var f = e.fields[j] || {};
        // Concatenate name + value, since some relays put content in fields
        var line = [f.name, f.value].filter(Boolean).join(': ');
        if (line) out.push(String(line));
      }
    }
    if (e.footer && e.footer.text) {
      // footers often include "edited" or timestamps; usually not useful → skip
    }
  }
  return out.filter(Boolean).join('\n').trim();
}

/* ----------------------- Fetch ----------------------- */

function fetchSingleMessageInclusive(channelId, messageId) {
  // 1) Try a dedicated single-message endpoint
  if (typeof fetchMessageById === 'function') {
    try {
      var m = fetchMessageById(channelId, messageId);
      if (m && m.id) return m;
    } catch (e) { }
  }

  // 2) Try "around" if your relay supports it
  try {
    var aroundPage = fetchChannelMessages(channelId, { around: String(messageId), limit: 1 }) || [];
    for (var i = 0; i < aroundPage.length; i++) {
      if (String(aroundPage[i].id) === String(messageId)) return aroundPage[i];
    }
  } catch (e) { }

  // 3) Last resort: fetch "after = (messageId - 1)" using string arithmetic
  try {
    var prev = decStringMinusOne(String(messageId));
    if (prev) {
      var maybe = fetchChannelMessages(channelId, { after: prev, limit: 1 }) || [];
      for (var j = 0; j < maybe.length; j++) {
        if (String(maybe[j].id) === String(messageId)) return maybe[j];
      }
    }
  } catch (e) { }

  return null;
}

function fetchChannelMessages(channelId, params) {
  params = params || {};
  var p = getRelayPaths();
  var qs = 'channelId=' + encodeURIComponent(channelId);
  if (params.after) qs += '&after=' + encodeURIComponent(params.after);
  if (params.around) qs += '&around=' + encodeURIComponent(params.around);
  if (params.limit) qs += '&limit=' + encodeURIComponent(params.limit);
  return relayFetch(p.messages + '?' + qs, { method: 'get' }) || [];
}

function fetchMessageById(channelId, messageId) {
  var p = getRelayPaths();
  var path = (p.message || '/message') + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  var obj = relayFetch(path, { method: 'get' });
  return (obj && obj.id) ? obj : null;
}

/* ----------------------- Post ----------------------- */

/** POST text message */
function postChannelMessage(channelId, content) {
  var p = getRelayPaths();
  var path = p.reply || p.post || '/reply';
  var payload = { channelId: String(channelId), content: String(content || '') };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  if (!id) try { logLocal('WARN', 'postChannelMessage no id', { res: res }); } catch (_) { }
  return id;
}

function postChannelMessageAdvanced(channelId, content, embeds) {
  var p = getRelayPaths();
  var path = p.reply || p.post || '/reply';
  var payload = { channelId: String(channelId), content: String(content || ''), embeds: embeds || [] };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  if (!id) try { logLocal('WARN', 'postChannelMessageAdvanced no id', { res: res }); } catch (_) { }
  return id;
}

/* ----------------------- Edit ----------------------- */
function editChannelMessage(channelId, messageId, newContent) {
  var p = getRelayPaths();
  var path = p.edit || '/edit';
  var payload = { channelId: String(channelId), messageId: String(messageId), content: String(newContent || '') };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  return id || String(messageId);
}

function editChannelMessageAdvanced(channelId, messageId, content, embeds) {
  var p = getRelayPaths();
  var path = p.edit || '/edit';
  var payload = { channelId: String(channelId), messageId: String(messageId), content: String(content || ''), embeds: embeds || [] };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  return id || String(messageId);
}

/* ----------------------- Delete ----------------------- */
function deleteMessage(channelId, messageId) {
  var p = getRelayPaths();
  var base = p.del || '/delete';
  var path = base + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  var res = relayFetch(path, { method: 'delete' }) || {};
  return !(res && res.ok === false);
}