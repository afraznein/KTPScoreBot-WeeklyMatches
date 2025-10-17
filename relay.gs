// =======================
// relay.gs
// Discord relay calls + logging + Twitch + shoutcaster helpers
// =======================

// ---------- RELAY HTTP HELPERS ----------

function fetchChannelMessages_(channelId, afterId) {
  const url = `${RELAY_BASE}/messages?channelId=${encodeURIComponent(channelId)}${afterId ? `&after=${encodeURIComponent(afterId)}` : ''}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Relay-Auth': RELAY_AUTH },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(`Relay /messages failed: ${code} ${res.getContentText()}`);
  }
  try { return JSON.parse(res.getContentText()); } catch { return []; }
}

function postChannelMessage_(channelId, content) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/reply`, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({ channelId:String(channelId), content:String(content||'') }),
    muteHttpExceptions:true
  });
  const code = res.getResponseCode();
  if (code>=300) {
    logLocal_('WARN','postChannelMessage failed',{ code, body: (res.getContentText()||'').slice(0,400) });
    return null;
  }
  try { const j=JSON.parse(res.getContentText()||'{}'); return String(j.id||''); } catch { return null; }
}

function editChannelMessage_(channelId, messageId, content) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/edit`, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({ channelId:String(channelId), messageId:String(messageId), content:String(content||'') }),
    muteHttpExceptions:true
  });
  const code = res.getResponseCode();
  if (code>=200 && code<300) return true;
  logLocal_('WARN','editChannelMessage failed',{ code, body:(res.getContentText()||'').slice(0,400) });
  return false;
}

function postChannelEmbed_(channelId, content, embeds) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/replyEmbed`, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({ channelId:String(channelId), content:String(content||''), embeds: embeds || [] }),
    muteHttpExceptions:true
  });
  const code = res.getResponseCode();
  if (code>=300) {
    logLocal_('WARN','postChannelEmbed failed',{ code, body:(res.getContentText()||'').slice(0,400) });
    return null;
  }
  try { const j=JSON.parse(res.getContentText()||'{}'); return String(j.id||''); } catch { return null; }
}

function editChannelEmbed_(channelId, messageId, content, embeds) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/editEmbed`, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({ channelId:String(channelId), messageId:String(messageId), content:String(content||''), embeds: embeds || [] }),
    muteHttpExceptions:true
  });
  const code = res.getResponseCode();
  if (code>=200 && code<300) return true;
  logLocal_('WARN','editChannelEmbed failed',{ code, body:(res.getContentText()||'').slice(0,400) });
  return false;
}

function deleteMessage_(channelId, messageId) {
  try {
    const res = UrlFetchApp.fetch(`${RELAY_BASE}/delete/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}`, {
      method:'delete',
      headers:{ 'X-Relay-Auth': RELAY_AUTH },
      muteHttpExceptions:true
    });
    return res.getResponseCode() === 204;
  } catch(e){
    logLocal_('WARN','deleteMessage exception',{ error:String(e) });
    return false;
  }
}

function postReaction_(channelId, messageId, emoji) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/react`, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({ channelId:String(channelId), messageId:String(messageId), emoji:String(emoji) }),
    muteHttpExceptions:true
  });
  const code = res.getResponseCode();
  if (code !== 204) {
    logLocal_('WARN','react failed',{ code, body:(res.getContentText()||'').slice(0,400) });
  }
}

/**
 * List reactors for a given emoji.
 * Tries name:id → name → id, handles Unknown Emoji (10014) gracefully.
 */
function listReactors_(channelId, messageId, emojiIdOrName) {
  function tryOnce(param) {
    const url = `${RELAY_BASE}/reactions?channelId=${encodeURIComponent(channelId)}&messageId=${encodeURIComponent(messageId)}&emoji=${encodeURIComponent(param)}`;
    const res = UrlFetchApp.fetch(url, { method:'get', headers:{ 'X-Relay-Auth': RELAY_AUTH }, muteHttpExceptions:true });
    const code = res.getResponseCode();
    if (code === 200) { try { return JSON.parse(res.getContentText()) || []; } catch { return []; } }
    const txt = res.getContentText() || '';
    if (String(txt).indexOf('"code": 10014') >= 0) return null; // Unknown Emoji
    logLocal_('WARN','listReactors trial failed',{ code, body: txt.slice(0,400), emoji:param });
    return null;
  }

  if (SHOUTCAST_EMOJI_NAME && SHOUTCAST_EMOJI_ID) {
    const r = tryOnce(`${SHOUTCAST_EMOJI_NAME}:${SHOUTCAST_EMOJI_ID}`); if (Array.isArray(r)) return r;
  }
  if (SHOUTCAST_EMOJI_NAME) {
    const r = tryOnce(SHOUTCAST_EMOJI_NAME); if (Array.isArray(r)) return r;
  }
  if (SHOUTCAST_EMOJI_ID) {
    const r = tryOnce(SHOUTCAST_EMOJI_ID); if (Array.isArray(r)) return r;
  }
  return [];
}

function postDM_(userId, content) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/dm`, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({ userId:String(userId), content:String(content) }),
    muteHttpExceptions:true
  });
  const code = res.getResponseCode();
  if (code>=300) {
    logLocal_('WARN','postDM failed',{ code, body: (res.getContentText()||'').slice(0,400), userId });
    return false;
  }
  return true;
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

function editChannelMessageAdvanced_(channelId, messageId, content, embeds) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/edit`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({
      channelId: String(channelId),
      messageId: String(messageId),
      content: String(content || ''),
      ...(embeds && embeds.length ? { embeds } : {})
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code>=200 && code<300) return true;
  logLocal_('WARN','editChannelMessageAdvanced failed',{ code, body:(res.getContentText()||'').slice(0,400) });
  return false;
}



// ---------- LOGGING (Discord + hidden sheet) ----------

function ensureLogSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
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
    var loginUrl = `https://`;
    loginUrl += RELAY_BASE + `/oauth/discord/login?userId=${encodeURIComponent(uid)}`;
    const msg = buildShoutcasterDm_(u.displayName || u.username || 'there', loginUrl);
    postDM_(uid, msg);
  } catch(e) {
    logLocal_('WARN','DM prompt for Twitch failed', { userId: uid, error: String(e) });
  }

  return { tag: `<@${uid}>`, id: uid };
}