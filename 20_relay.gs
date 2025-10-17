// =======================
// relay.gs – Discord relay HTTP calls and related helpers
// =======================

// ---------- RELAY HTTP CORE ----------

/** Low-level helper to call the Cloud Run relay API with retries and backoff. */
function relayRequest_(path, method, bodyObj, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 30000;
  const maxRetries = (opts.retries != null) ? opts.retries : 2;
  const url = RELAY_BASE + String(path || '');
  const payload = bodyObj != null ? JSON.stringify(bodyObj) : null;
  const params = {
    method: String(method || 'get').toLowerCase(),
    headers: { 'X-Relay-Auth': RELAY_AUTH },
    muteHttpExceptions: true
  };
  if (payload != null) {
    params.contentType = 'application/json';
    params.payload = payload;
  }
  // Helper to parse numeric or HTTP-date Retry-After header
  function parseRetryAfter(h) {
    const n = Number(h);
    if (isFinite(n)) return Math.min(n * 1000, 60000);
    const t = Date.parse(h);
    if (isFinite(t)) {
      const d = t - Date.now();
      return Math.min(Math.max(d, 0), 60000);
    }
    return null;
  }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, Object.assign({ timeout: timeoutMs }, params));
      const code = res.getResponseCode();
      if (code === 429 || code >= 500) {
        const retryAfter = (res.getHeaders() || {})['Retry-After'];
        const waitMs = parseRetryAfter(retryAfter) || (600 * Math.pow(2, attempt));
        if (attempt === maxRetries) {
          return { ok: false, code: code, text: res.getContentText() || '' };
        }
        Utilities.sleep(waitMs);
        continue;
      }
      return { ok: (code >= 200 && code < 300), code: code, text: res.getContentText() || '' };
    } catch (e) {
      if (attempt === maxRetries) {
        return { ok: false, code: 0, text: String(e) };
      }
      Utilities.sleep(600 * Math.pow(2, attempt));
    }
  }
  return { ok: false, code: 0, text: 'relayRequest_ failed' };
}

/** Parse JSON text safely (returns null on failure). */
function tryParseJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------- RELAY API WRAPPERS ----------

/** Fetch a single message by ID via relay. */
function fetchSingleMessage_(channelId, messageId) {
  const r = relayRequest_(`/message/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}`, 'get');
  if (!r.ok) {
    logLocal_('WARN', 'fetchSingleMessage_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return null;
  }
  return tryParseJson_(r.text);
}

/** Fetch recent messages from a channel (if `afterId` provided, fetch after that). */
function fetchChannelMessages_(channelId, afterId) {
  const path = '/messages?channelId=' + encodeURIComponent(channelId) + (afterId ? '&after=' + encodeURIComponent(afterId) : '');
  const r = relayRequest_(path, 'get');
  if (!r.ok) {
    logLocal_('WARN', 'fetchChannelMessages_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return [];
  }
  return tryParseJson_(r.text) || [];
}

/** Post a simple text message to a channel. Returns the new message ID or ''. */
function postChannelMessage_(channelId, content) {
  const body = { channelId: String(channelId), content: String(content || '') };
  const r = relayRequest_('/reply', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'postChannelMessage_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return '';
  }
  const j = tryParseJson_(r.text);
  return (j && j.id) ? String(j.id) : '';
}

/** Edit a message's content by ID. Returns true on success. */
function editChannelMessage_(channelId, messageId, content) {
  const body = { channelId: String(channelId), messageId: String(messageId), content: String(content || '') };
  const r = relayRequest_('/edit', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'editChannelMessage_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return false;
  }
  return true;
}

/** Post an embed (and optional content) to a channel. Returns new message ID or ''. */
function postChannelEmbed_(channelId, embeds, content) {
  const body = { channelId: String(channelId), embeds: embeds || [] };
  if (content != null) body.content = String(content);
  const r = relayRequest_('/reply', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'postChannelEmbed_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return '';
  }
  const j = tryParseJson_(r.text);
  return (j && j.id) ? String(j.id) : '';
}

/** Edit a message's embeds (and content). Returns true on success. */
function editChannelEmbed_(channelId, messageId, embeds, content) {
  const body = { channelId: String(channelId), messageId: String(messageId), embeds: embeds || [] };
  if (content != null) body.content = String(content);
  const r = relayRequest_('/edit', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'editChannelEmbed_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return false;
  }
  return true;
}

/** Delete a message by ID. Returns true on success. */
function deleteMessage_(channelId, messageId) {
  const path = '/delete/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  const r = relayRequest_(path, 'delete');
  if (!r.ok) {
    logLocal_('WARN', 'deleteMessage_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return false;
  }
  return true;
}

/** Add a reaction emoji to a message. */
function postReaction_(channelId, messageId, emoji) {
  const body = { channelId: String(channelId), messageId: String(messageId), emoji: String(emoji) };
  const r = relayRequest_('/react', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'postReaction_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return false;
  }
  return true;
}

// ---------- DIRECT MESSAGING & REACTIONS ----------

/** Send a DM to a user. Returns the message ID or ''. */
function postDM_(userId, content) {
  const body = { userId: String(userId), content: String(content || '') };
  const r = relayRequest_('/dm', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'postDM_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return '';
  }
  const j = tryParseJson_(r.text);
  return (j && j.id) ? String(j.id) : '';
}

/** Advanced: Post a message with content and optional embeds directly (returns ID or null). */
function postChannelMessageAdvanced_(channelId, content, embeds) {
  const res = UrlFetchApp.fetch(`${RELAY_BASE}/reply`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify({
      channelId: String(channelId),
      content: String(content || ''),
      ...(embeds && embeds.length ? { embeds: embeds } : {})
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    logLocal_('WARN', 'postChannelMessageAdvanced_ failed', { code: code, body: (res.getContentText() || '').slice(0, 400) });
    return null;
  }
  try {
    const j = JSON.parse(res.getContentText() || '{}');
    return String(j.id || '');
  } catch (e) {
    return null;
  }
}

/** Advanced: Edit a message's content and/or embeds directly (returns true on success). */
function editChannelMessageAdvanced_(channelId, messageId, content, embeds) {
  const body = { channelId: String(channelId), messageId: String(messageId) };
  if (content != null) body.content = String(content);
  if (embeds != null) body.embeds = embeds;
  const r = relayRequest_('/edit', 'post', body);
  if (!r.ok) {
    logLocal_('WARN', 'editChannelMessageAdvanced_ failed', { code: r.code, text: (r.text || '').slice(0, 200) });
    return false;
  }
  return true;
}

// ---------- LOGGING & NOTIFICATIONS ----------

/** Send a brief log message to the results log channel (if configured). */
function sendLog_(msg) {
  try {
    if (RESULTS_LOG_CHANNEL_ID) {
      postChannelMessage_(RESULTS_LOG_CHANNEL_ID, msg);
    }
    logLocal_('INFO', LOG_SHEET, { msg: msg });
  } catch (e) {
    logLocal_('WARN', 'sendLog_ failed', { error: String(e) });
  }
}
