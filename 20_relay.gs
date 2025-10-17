// =======================
// relay.gs
// Discord relay calls + logging + Twitch + shoutcaster helpers
// =======================

// ---------- RELAY HTTP HELPERS ----------

// ---------- Unified Relay Client with retries ----------
function relayRequest_(path, method, bodyObj, opts){
  opts = opts || {};
  var timeoutMs = opts.timeoutMs || 30000;
  var retries   = (opts.retries == null) ? 2 : opts.retries;
  var url = RELAY_BASE + String(path || '');
  var payload = (bodyObj == null) ? null : JSON.stringify(bodyObj);
  var params = { method: String(method||'get').toLowerCase(), headers:{'X-Relay-Auth': RELAY_AUTH}, muteHttpExceptions:true };
  if (payload != null){ params.contentType = 'application/json'; params.payload = payload; }
  function sleep(ms){ Utilities.sleep(Math.max(0, ms||0)); }
  function parseRetryAfter(h){ var n=Number(h); if (isFinite(n)) return Math.min(n*1000, 60000); var t=Date.parse(h); if (isFinite(t)){ var d=t-Date.now(); return Math.min(Math.max(d,0),60000);} return null; }
  for (var attempt=0; attempt<=retries; attempt++){
    try{
      var res = UrlFetchApp.fetch(url, Object.assign({ timeout: timeoutMs }, params));
      var code = res.getResponseCode();
      if (code===429 || code>=500){
        var ra = (res.getHeaders()||{})['Retry-After'];
        var wait = parseRetryAfter(ra) || (600 * Math.pow(2, attempt));
        if (attempt === retries) return { ok:false, code:code, text:(res.getContentText()||''), res:res };
        sleep(wait); continue;
      }
      return { ok: code>=200 && code<300, code: code, text: (res.getContentText()||''), res: res };
    } catch(e){
      if (attempt === retries) return { ok:false, code:0, text:String(e), error:String(e) };
      sleep(600 * Math.pow(2, attempt));
    }
  }
  return { ok:false, code:0, text:'relayRequest_ failed' };
}
function tryParseJson_(s){ if (!s) return null; try{ return JSON.parse(s); } catch(_){ return null; } }
/** GET a single message by id through the relay. */
function fetchSingleMessage_(channelId, messageId){
  var r = relayRequest_('/message/'+encodeURIComponent(String(channelId))+'/'+encodeURIComponent(String(messageId)), 'get');
  if (!r.ok){ logLocal_('WARN','fetchSingleMessage_ failed',{ code:r.code, text:(r.text||'').slice(0,200) }); return null; }
  return tryParseJson_(r.text);
}

/** Fetch messages (optionally strictly after a messageId). */
function fetchChannelMessages_(channelId, afterId) {
  var path = '/messages?channelId=' + encodeURIComponent(String(channelId)) +
             (afterId ? '&after=' + encodeURIComponent(String(afterId)) : '');
  var r = relayRequest_(path, 'get');
  if (!r.ok) {
    logLocal_ && logLocal_('WARN', 'fetchChannelMessages_ failed', { code: r.code, text: (r.text || '').slice(0,200) });
    return [];
  }
  return tryParseJson_(r.text) || [];
}

/** Post a simple text message. Returns new message id or ''. */
function postChannelMessage_(channelId, content) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    logLocal_ && logLocal_('DRY','postChannelMessage_', { channelId: channelId, content: String(content||'').slice(0,120) });
    return '';
  }
  var body = { channelId: String(channelId), content: String(content || '') };
  var r = relayRequest_('/reply', 'post', body);
  if (!r.ok) {
    logLocal_ && logLocal_('WARN','postChannelMessage_ failed',{ code:r.code, text:(r.text||'').slice(0,200) });
    return '';
  }
  var j = tryParseJson_(r.text);
  return (j && j.id) ? String(j.id) : '';
}

/** Edit message content only. */
function editChannelMessage_(channelId, messageId, content) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    logLocal_ && logLocal_('DRY','editChannelMessage_', { channelId: channelId, messageId: messageId, content: String(content||'').slice(0,120) });
    return true;
  }
  var body = { channelId: String(channelId), messageId: String(messageId), content: String(content || '') };
  var r = relayRequest_('/edit', 'post', body);
  if (!r.ok) {
    logLocal_ && logLocal_('WARN','editChannelMessage_ failed',{ code:r.code, text:(r.text||'').slice(0,200) });
    return false;
  }
  return true;
}

/** Post embeds (optional content). Returns new message id or ''. */
function postChannelEmbed_(channelId, embeds, content) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    logLocal_ && logLocal_('DRY','postChannelEmbed_', { channelId: channelId, embedsCount: (embeds && embeds.length) || 0 });
    return '';
  }
  var body = { channelId: String(channelId), embeds: embeds || [] };
  if (content != null) body.content = String(content);
  var r = relayRequest_('/reply', 'post', body);
  if (!r.ok) {
    logLocal_ && logLocal_('WARN','postChannelEmbed_ failed',{ code:r.code, text:(r.text||'').slice(0,200) });
    return '';
  }
  var j = tryParseJson_(r.text);
  return (j && j.id) ? String(j.id) : '';
}

/** Edit embeds/content. */
function editChannelEmbed_(channelId, messageId, embeds, content) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    logLocal_ && logLocal_('DRY','editChannelEmbed_', { channelId: channelId, messageId: messageId, embedsCount: (embeds && embeds.length) || 0 });
    return true;
  }
  var body = { channelId: String(channelId), messageId: String(messageId), embeds: embeds || [] };
  if (content != null) body.content = String(content);
  var r = relayRequest_('/edit', 'post', body);
  if (!r.ok) {
    logLocal_ && logLocal_('WARN','editChannelEmbed_ failed',{ code:r.code, text:(r.text||'').slice(0,200) });
    return false;
  }
  return true;
}

/** Delete a message. */
function deleteMessage_(channelId, messageId) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    logLocal_ && logLocal_('DRY','deleteMessage_', { channelId: channelId, messageId: messageId });
    return true;
  }
  var path = '/delete/' + encodeURIComponent(String(channelId)) + '/' + encodeURIComponent(String(messageId));
  var r = relayRequest_(path, 'delete');
  if (!r.ok) {
    logLocal_ && logLocal_('WARN','deleteMessage_ failed',{ code:r.code, text:(r.text||'').slice(0,200) });
    return false;
  }
  return true;
}

/** Add a reaction to a message. */
function postReaction_(channelId, messageId, emoji) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    logLocal_ && logLocal_('DRY','postReaction_', { channelId: channelId, messageId: messageId, emoji: emoji });
    return true;
  }
  var body = { channelId: String(channelId), messageId: String(messageId), emoji: String(emoji) };
  var r = relayRequest_('/react', 'post', body);
  if (!r.ok) {
    logLocal_ && logLocal_('WARN','postReaction_ failed',{ code:r.code, text:(r.text||'').slice(0,200) });
    return false;
  }
  return true;
}

/**
 * List reactors for a given emoji.
 * Tries name:id → name → id, handles Unknown Emoji (10014) gracefully.
 */
function listReactors_(channelId, messageId, emojiIdOrName) {
  function tryOnce(param) {
    var q = '?channelId='+encodeURIComponent(String(channelId))+'&messageId='+encodeURIComponent(String(messageId))+'&emoji='+encodeURIComponent(String(param));
    var r = relayRequest_('/reactions'+q, 'get');
    if (r.ok) { var arr = tryParseJson_(r.text); return Array.isArray(arr) ? arr : []; }
    var txt = r.text || '';
    if (String(txt).indexOf('"code": 10014') >= 0) return null; // Unknown Emoji
    logLocal_('WARN','listReactors trial failed',{ code:r.code, body: txt.slice(0,400), emoji:param });
    return null;
  }
  if (SHOUTCAST_EMOJI_NAME && SHOUTCAST_EMOJI_ID) { var r1 = tryOnce(SHOUTCAST_EMOJI_NAME+':'+SHOUTCAST_EMOJI_ID); if (Array.isArray(r1)) return r1; }
  if (SHOUTCAST_EMOJI_NAME) { var r2 = tryOnce(SHOUTCAST_EMOJI_NAME); if (Array.isArray(r2)) return r2; }
  if (SHOUTCAST_EMOJI_ID)   { var r3 = tryOnce(SHOUTCAST_EMOJI_ID);   if (Array.isArray(r3)) return r3; }
  return [];
}

/** DM a user. Returns the new message id or ''. */
function postDM_(userId, content) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    if (typeof logLocal_ === 'function') logLocal_('DRY', 'postDM_', {
      userId: String(userId),
      content: String(content || '').slice(0, 120)
    });
    return '';
  }
  var body = { userId: String(userId), content: String(content || '') };
  var r = relayRequest_('/dm', 'post', body);
  if (!r.ok) {
    if (typeof logLocal_ === 'function') logLocal_('WARN', 'postDM_ failed', {
      code: r.code, text: (r.text || '').slice(0, 200)
    });
    return '';
  }
  var j = tryParseJson_(r.text);
  return (j && j.id) ? String(j.id) : '';
}

function postChannelMessageAdvanced_(channelId, content, embeds) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/reply`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({
      channelId: String(channelId),
      content: String(content || ''),
      ...(embeds && embeds.length ? { embeds } : {})
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    logLocal_('WARN','postChannelMessageAdvanced failed',{ code, body:(res.getContentText()||'').slice(0,400) });
    return null;
  }
  try { const j = JSON.parse(res.getContentText()||'{}'); return String(j.id||''); } catch { return null; }
}

/** Edit message content and/or embeds. Returns true on success. */
function editChannelMessageAdvanced_(channelId, messageId, content, embeds) {
  if (String(DRY_RUN || '').toLowerCase() === 'true') {
    if (typeof logLocal_ === 'function') logLocal_('DRY', 'editChannelMessageAdvanced_', {
      channelId: String(channelId),
      messageId: String(messageId),
      content: content != null ? String(content).slice(0, 120) : '',
      embedsCount: (embeds && embeds.length) || 0
    });
    return true;
  }
  var body = { channelId: String(channelId), messageId: String(messageId) };
  if (content != null) body.content = String(content);
  if (embeds != null) body.embeds = embeds;
  var r = relayRequest_('/edit', 'post', body);
  if (!r.ok) {
    if (typeof logLocal_ === 'function') logLocal_('WARN', 'editChannelMessageAdvanced_ failed', {
      code: r.code, text: (r.text || '').slice(0, 200)
    });
    return false;
  }
  return true;
}


// ---------- LOGGING (Discord + hidden sheet) ----------

function ensureLogSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName('WM_Log');
  if (!sh) {
    sh = ss.insertSheet('WM_Log');
    sh.getRange(1,1,1,5).setValues([['Timestamp','Level','Event','Message','Details (JSON)']]);
    sh.hideSheet();
  }
  return sh;
}

function appendLogRow_(level, event, message, detailsObj) {
  try {
    const sh = ensureLogSheet_();
    const row = [
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      String(level||'INFO'),
      String(event||''),
      String(message||''),
      detailsObj ? JSON.stringify(detailsObj) : ''
    ];
    sh.appendRow(row);
  } catch (e) {
    logLocal_('WARN','appendLogRow_ failed',{ error:String(e) });
  }
}

function sendLog_(msg) {
  try {
    if (RESULTS_LOG_CHANNEL_ID) postChannelMessage_(RESULTS_LOG_CHANNEL_ID, msg);
    logLocal_('INFO','RESULTS_LOG', { msg });
  } catch (e) {
    logLocal_('WARN','sendLog_ failed',{ error:String(e) });
  }
}

// ---------- TWITCH MAP HELPERS (uses TWITCH_MAP_KEY from config.gs) ----------

function _loadTwitchMap_(){
  const raw = PropertiesService.getScriptProperties().getProperty(TWITCH_MAP_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function _saveTwitchMap_(obj){
  PropertiesService.getScriptProperties().setProperty(TWITCH_MAP_KEY, JSON.stringify(obj||{}));
}
function normalizeTwitchInput_(s){
  if (!s) return '';
  let x = String(s).trim().replace(/^<|>$/g,'');
  const m = x.match(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\/([A-Za-z0-9_]{3,})\/?$/i);
  if (m) return `https://twitch.tv/${m[1]}`;
  const u = x.match(/^([A-Za-z0-9_]{3,})$/);
  if (u) return `https://twitch.tv/${u[1]}`;
  return '';
}
function setTwitchForUser_(discordUserId, input){
  if (!discordUserId) return false;
  const url = normalizeTwitchInput_(input);
  if (!url) return false;
  const map = _loadTwitchMap_();
  map[String(discordUserId)] = url;
  _saveTwitchMap_(map);
  return true;
}
function getTwitchForUser_(discordUserId){
  const map = _loadTwitchMap_();
  return map[String(discordUserId)] || '';
}

// ---------- SHOUTCASTER DETECTION ----------

function buildShoutcasterDm_(displayNameOrUsername, oauthLoginUrl){
  return [
    `Hey ${displayNameOrUsername}! 🎙️`,
    `You reacted as **shoutcaster** for an upcoming match, but I don't have your Twitch.`,
    `Please reply **here** with either:`,
    `• \`twitch twitch.tv/YourChannel\`  or`,
    `• \`twitch YourChannel\``,
    ``,
    `Or connect via OAuth so I can read it automatically:`,
    oauthLoginUrl,
    ``,
    `Tip: you can also connect Twitch in Discord (User Settings → Connections).`
  ].join('\n');
}

/**
 * Read shoutcaster from reactions:
 * - Prefer users with SHOUTCASTER_ROLE_ID (if set)
 * - If twitch known → return twitch URL; else DM prompt and return @mention
 */
function getShoutcasterInfoForMessage_(channelId, messageId){
  // Try both custom forms and unicode name
  let users = listReactors_(channelId, messageId, `${SHOUTCAST_EMOJI_NAME}:${SHOUTCAST_EMOJI_ID}`) || [];
  if (!users.length && SHOUTCAST_EMOJI_NAME) users = listReactors_(channelId, messageId, SHOUTCAST_EMOJI_NAME) || [];
  if (!users.length && SHOUTCAST_EMOJI_ID)   users = listReactors_(channelId, messageId, SHOUTCAST_EMOJI_ID)   || [];
  if (!users.length) return null;

  // Role-gate if configured
  let candidates = users;
  if (SHOUTCASTER_ROLE_ID) {
    const withRole = users.filter(u => Array.isArray(u.roles) && u.roles.indexOf(SHOUTCASTER_ROLE_ID) >= 0);
    if (withRole.length) candidates = withRole;
  }

  const u = candidates[0];
  const uid = String(u.id || '');
  const twitch = getTwitchForUser_(uid);
  if (twitch) return { tag: twitch, id: uid };

  // DM prompt fallback
  try {
    const loginUrl = `https://YOUR_CLOUD_RUN_URL/oauth/discord/login?userId=${encodeURIComponent(uid)}`;
    const msg = buildShoutcasterDm_(u.displayName || u.username || 'there', loginUrl);
    postDM_(uid, msg);
  } catch(e) {
    logLocal_('WARN','DM prompt for Twitch failed', { userId: uid, error: String(e) });
  }

  return { tag: `<@${uid}>`, id: uid };
}

// Helper to normalize relay responses into a Discord message ID
function idFromRelay_(resp) {
  try {
    if (!resp) return null;
    if (resp.id) return String(resp.id);
    if (resp.message && resp.message.id) return String(resp.message.id);
    if (resp.data && resp.data.id) return String(resp.data.id);
  } catch (e) {}
  return null;
}

function _enc_(s){ return encodeURIComponent(String(s||'')); }

// tweak these paths to match your relay if they differ
function fetchMessageById_(channelId, messageId) {
  var path = '/message?channelId=' + _enc_(channelId) + '&messageId=' + _enc_(messageId);
  return relayFetch_('GET', path, null);
}
function listReactions_(channelId, messageId, emoji) {
  // Accept ':name:' or 'name:id' or unicode; strip surrounding colons
  var e = String(emoji||'').trim();
  if (e.startsWith(':') && e.endsWith(':')) e = e.slice(1,-1);
  var path = '/reactions?channelId=' + _enc_(channelId) +
             '&messageId=' + _enc_(messageId) +
             '&emoji=' + _enc_(e);
  return relayFetch_('GET', path, null);
}

// Extract plain content from relay response
function contentFromRelay_(resp) {
  try {
    if (!resp) return '';
    if (resp.content) return String(resp.content);
    if (resp.message && resp.message.content) return String(resp.message.content);
    if (resp.data && resp.data.content) return String(resp.data.content);
  } catch(e){}
  return '';
}
