// =======================
// 30_relay.gs - Discord API & Relay HTTP
// =======================
// Purpose: Discord relay HTTP wrappers, fetch/post/edit/delete messages
// Dependencies: 00_config.gs, 05_util.gs
// Used by: 40_logging.gs, 50_rendering.gs, 60_parser.gs
//
// Functions in this module:
// Config helpers:
//   sp, getRelayBase, getRelayPaths, getRelayHeaders, normalizeRelayUrl, getRelayTimeoutMs
// HTTP core:
//   relayFetch, tryParseJson
// Event handling:
//   handleIncomingDiscordEvent, contentFromRelay, textFromEmbeds
// Message fetching:
//   fetchSingleMessageInclusive, fetchChannelMessages, fetchMessageById
// Message posting:
//   postChannelMessage, postChannelMessageAdvanced
// Message editing/deleting:
//   editChannelMessage, editChannelMessageAdvanced, deleteMessage
// Direct messages & reactions:
//   sendDM, addReaction, getReactions
//
// Total: 22 functions
// =======================

// ---------- RELAY HTTP CORE ----------

/* =========================
   Relay base / headers / fetch
   ========================= */

/**
 * Script Property helper - reads from script properties with default fallback.
 * @param {string} k - Property key
 * @param {*} dflt - Default value if property not found
 * @returns {string} Property value or default
 */
function sp(k, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v != null && v !== '') ? String(v) : (dflt == null ? '' : String(dflt));
}

/**
 * Relay base URL (no trailing slash).
 * Checks multiple property keys and constants.
 * @returns {string} Relay base URL without trailing slash
 * @throws {Error} If no relay base URL is configured
 */
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

/**
 * Get configured relay API paths for various operations.
 * @returns {Object} Object with path properties: messages, message, reply, post, edit, del, dm, react, health, whoami
 */
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

/**
 * Build headers for talking to the relay (adds shared secret in common formats).
 * @returns {Object} Headers object with Content-Type and optional X-Relay-Auth
 */
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

/**
 * Normalize a path/URL. Accepts absolute URLs or relative paths.
 * @param {string} path - Path or full URL
 * @returns {string} Full URL to relay endpoint
 * @throws {Error} If path is missing or not a string
 */
function normalizeRelayUrl(path) {
  if (typeof path !== 'string' || !path) {
    throw new Error('relayFetch: path is missing or not a string');
  }
  // If caller passed a full URL, use as-is
  if (/^https?:\/\//i.test(path)) return path;
  var base = getRelayBase();
  return base + (path.charAt(0) === '/' ? path : ('/' + path));
}

/**
 * Optional: central place to tune timeouts for relay calls.
 * @returns {number} Timeout in milliseconds (default 20000, min 5000)
 */
function getRelayTimeoutMs() {
  // Default 20s; adjust if your Cloud Run/Functions are slower
  var sp = PropertiesService.getScriptProperties();
  var v = sp.getProperty('RELAY_TIMEOUT_MS');
  var n = v ? parseInt(v, 10) : 20000;
  return isNaN(n) ? 20000 : Math.max(5000, n);
}

/**
 * Fetch wrapper for relay HTTP calls.
 * @param {string} path - Relay path or full URL
 * @param {Object} opt - Options {method, headers, payload}
 * @returns {*} Parsed JSON response or raw text
 * @throws {Error} If HTTP status is not 2xx
 */
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

/**
 * Parse JSON text safely (returns null on failure).
 * @param {string} s - JSON string to parse
 * @returns {*} Parsed object or null if parsing fails
 */
function tryParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------- RELAY API WRAPPERS ----------

/**
 * Handle incoming Discord event - parses and updates tables.
 * @param {Object} payload - Discord event payload from relay
 * @returns {Object} {ok: boolean, error?: string}
 */
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

/**
 * Extract text content from Discord relay payload.
 * Handles various payload formats and extracts from content, embeds, or replies.
 * @param {*} payload - Discord payload (string or object)
 * @returns {string} Extracted text content
 */
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

/**
 * Extract text from Discord embeds (title, description, fields).
 * @param {Array} embeds - Array of Discord embed objects
 * @returns {string} Combined text from all embeds
 */
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

/**
 * Fetch a single Discord message inclusively (tries multiple methods).
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID
 * @returns {Object|null} Message object or null if not found
 */
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

/**
 * Fetch channel messages with optional pagination parameters.
 * @param {string} channelId - Discord channel ID
 * @param {Object} params - Parameters {after, around, limit}
 * @returns {Array} Array of message objects
 */
function fetchChannelMessages(channelId, params) {
  params = params || {};
  var p = getRelayPaths();
  var qs = 'channelId=' + encodeURIComponent(channelId);
  if (params.after) qs += '&after=' + encodeURIComponent(params.after);
  if (params.around) qs += '&around=' + encodeURIComponent(params.around);
  if (params.limit) qs += '&limit=' + encodeURIComponent(params.limit);
  return relayFetch(p.messages + '?' + qs, { method: 'get' }) || [];
}

/**
 * Fetch a single message by ID using the relay's message endpoint.
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID
 * @returns {Object|null} Message object or null if not found
 */
function fetchMessageById(channelId, messageId) {
  var p = getRelayPaths();
  var path = (p.message || '/message') + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  var obj = relayFetch(path, { method: 'get' });
  return (obj && obj.id) ? obj : null;
}

/* ----------------------- Post ----------------------- */

/**
 * POST text message to Discord channel.
 * @param {string} channelId - Discord channel ID
 * @param {string} content - Message content text
 * @returns {string} Posted message ID or empty string
 */
function postChannelMessage(channelId, content) {
  var p = getRelayPaths();
  var path = p.reply || p.post || '/reply';
  var payload = { channelId: String(channelId), content: String(content || '') };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  if (!id) try { logLocal('WARN', 'postChannelMessage no id', { res: res }); } catch (_) { }
  return id;
}

/**
 * POST message with embeds to Discord channel (advanced).
 * @param {string} channelId - Discord channel ID
 * @param {string} content - Message content text
 * @param {Array} embeds - Array of Discord embed objects
 * @returns {string} Posted message ID or empty string
 */
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

/**
 * Edit an existing Discord message (text only).
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID to edit
 * @param {string} newContent - New message content text
 * @returns {string} Message ID (original or from response)
 */
function editChannelMessage(channelId, messageId, newContent) {
  var p = getRelayPaths();
  var path = p.edit || '/edit';
  var payload = { channelId: String(channelId), messageId: String(messageId), content: String(newContent || '') };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  return id || String(messageId);
}

/**
 * Edit an existing Discord message with embeds (advanced).
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID to edit
 * @param {string} content - New message content text
 * @param {Array} embeds - Array of Discord embed objects
 * @returns {string} Message ID (original or from response)
 */
function editChannelMessageAdvanced(channelId, messageId, content, embeds) {
  var p = getRelayPaths();
  var path = p.edit || '/edit';
  var payload = { channelId: String(channelId), messageId: String(messageId), content: String(content || ''), embeds: embeds || [] };
  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  return id || String(messageId);
}

/* ----------------------- Delete ----------------------- */

/**
 * Delete a Discord message.
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID to delete
 * @returns {boolean} True if deletion succeeded (or relay didn't return ok:false)
 */
function deleteMessage(channelId, messageId) {
  var p = getRelayPaths();
  var base = p.del || '/delete';
  var path = base + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  var res = relayFetch(path, { method: 'delete'}) || {};
  return !(res && res.ok === false);
}

/* ----------------------- Direct Messages ----------------------- */

/**
 * Send a DM to a Discord user and log it to WM_Log sheet.
 * @param {string} userId - Discord user ID
 * @param {string} content - Message content
 * @param {Object} options - Optional {logToSheet: boolean (default true)}
 * @returns {Object} {ok: boolean, id: string} Response from relay
 */
function sendDM(userId, content, options) {
  options = options || {};
  var logToWMLog = (typeof options.logToSheet !== 'undefined') ? options.logToSheet : true;

  var p = getRelayPaths();
  var path = p.dm || '/dm';
  var payload = {
    userId: String(userId),
    content: String(content || '').slice(0, 1900)
  };

  var res = relayFetch(path, { method: 'post', payload: payload }) || {};

  // Store DM channel ID for later reply checking (if relay returns it)
  if (res && res.channelId) {
    try {
      var sp = PropertiesService.getScriptProperties();
      var key = 'DM_CHANNEL_ID::' + String(userId);
      sp.setProperty(key, String(res.channelId));
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Log the DM to WM_Log sheet for record-keeping
  if (logToWMLog && typeof logMatchToSheet === 'function') {
    try {
      logMatchToSheet('', '', '', '', content.slice(0, 100), 'DM_SENT', '', `<@${userId}>`, 'DM');
    } catch (e) {
      // Ignore logging errors
    }
  }

  return {
    ok: (res && res.ok !== false),
    id: (res && res.id) ? String(res.id) : '',
    channelId: (res && res.channelId) ? String(res.channelId) : ''
  };
}

/**
 * Add a reaction emoji to a message.
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID
 * @param {string} emoji - Emoji (unicode or "name:id")
 * @returns {boolean} True if reaction added successfully
 */
function addReaction(channelId, messageId, emoji) {
  var p = getRelayPaths();
  var path = p.react || '/react';
  var payload = {
    channelId: String(channelId),
    messageId: String(messageId),
    emoji: String(emoji)
  };

  var res = relayFetch(path, { method: 'post', payload: payload }) || {};
  return !(res && res.ok === false);
}

/**
 * Get users who reacted to a message with a specific emoji.
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID
 * @param {string} emoji - Emoji (unicode or "name:id")
 * @returns {Array} Array of user objects {id, username, displayName, roles[]}
 */
function getReactions(channelId, messageId, emoji) {
  var p = getRelayPaths();
  var path = p.reactions || '/reactions';
  var url = path + '?channelId=' + encodeURIComponent(channelId) +
            '&messageId=' + encodeURIComponent(messageId) +
            '&emoji=' + encodeURIComponent(emoji);

  var res = relayFetch(url, { method: 'get' });

  if (Array.isArray(res)) return res;
  if (res && res.data && Array.isArray(res.data)) return res.data;
  return [];
}