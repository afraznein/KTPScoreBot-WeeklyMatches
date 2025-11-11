// =======================
// 12_alias_suggestions.gs - Alias Suggestion & DM Management
// =======================
// Purpose: Manage pending alias suggestions via DM, track confirmations, auto-add to _Aliases sheet
// Dependencies: 00_config.gs, 05_util.gs, 30_relay.gs, 40_logging.gs
// Used by: 60_parser.gs
//
// Functions in this module:
// - suggestTeamAlias(input, hintDiv)
// - sendAliasSuggestionDM(userId, input, suggestion, originalMessage)
// - storePendingAliasSuggestion(data)
// - getPendingAliasSuggestions()
// - removePendingAliasSuggestion(userId)
// - addAliasToSheet(alias, canonical)
// - getDMChannelId(userId)
// - checkAndProcessAliasSuggestions()
// - checkDMReply(userId, afterTimestamp)
//
// Total: 9 functions
// =======================

/**
 * Suggest a team alias based on fuzzy matching.
 * Finds teams that contain the input or vice versa.
 * @param {string} input - User's input that failed to match
 * @param {string} hintDiv - Optional division hint
 * @returns {Object|null} {name, division, score} or null if no good match
 */
function suggestTeamAlias(input, hintDiv) {
  var idx = (typeof getTeamIndexCached === 'function') ? getTeamIndexCached() : null;
  if (!idx || !idx.teams || !idx.teams.length) return null;

  var normalized = (typeof normalizeTeamText === 'function') ? normalizeTeamText(input) : String(input || '').toLowerCase().trim();

  var candidates = [];
  for (var i = 0; i < idx.teams.length; i++) {
    var t = idx.teams[i];

    // Apply division filter if hint provided
    if (hintDiv && String(t.division || '').toLowerCase() !== String(hintDiv || '').toLowerCase()) continue;

    var teamNorm = (typeof normalizeTeamText === 'function') ? normalizeTeamText(t.name) : String(t.name || '').toLowerCase().trim();

    // Score the match: substring matching
    var score = 0;
    if (teamNorm === normalized) score = 10; // exact match (shouldn't happen, but just in case)
    else if (teamNorm.indexOf(normalized) >= 0) score = 8; // team contains input: "soul skaters" contains "soul"
    else if (normalized.indexOf(teamNorm) >= 0) score = 7; // input contains team: "soul skaters thing" contains "soul"
    else {
      // Token overlap
      var inputTokens = normalized.split(/\s+/);
      var teamTokens = teamNorm.split(/\s+/);
      var hits = 0;
      for (var j = 0; j < inputTokens.length; j++) {
        for (var k = 0; k < teamTokens.length; k++) {
          if (inputTokens[j] && teamTokens[k] &&
              (inputTokens[j] === teamTokens[k] ||
               inputTokens[j].indexOf(teamTokens[k]) >= 0 ||
               teamTokens[k].indexOf(inputTokens[j]) >= 0)) {
            hits++;
            break;
          }
        }
      }
      score = hits;
    }

    if (score >= 1) {
      candidates.push({
        name: t.name,
        division: t.division,
        score: score
      });
    }
  }

  // Sort by score desc
  candidates.sort(function(a, b) { return b.score - a.score; });

  // Return best candidate if score is reasonable (>= 4 for good confidence)
  return (candidates[0] && candidates[0].score >= 4) ? candidates[0] : null;
}

/**
 * Send a DM to a user with alias suggestion and store pending state.
 * @param {string} userId - Discord user ID
 * @param {string} input - The input that failed to match
 * @param {Object} suggestion - Suggestion object {name, division} or null
 * @param {Object} originalMessage - Original Discord message {id, channel_id, content}
 * @returns {Object} {ok: boolean, dmId: string}
 */
function sendAliasSuggestionDM(userId, input, suggestion, originalMessage) {
  var content = '⚠️ I couldn\'t match "' + input + '" in your message:\n' +
                '> ' + String(originalMessage.content || '').slice(0, 100) + '...\n\n';

  if (suggestion) {
    content += '💡 Did you mean **' + suggestion.name + '** (' + suggestion.division + ')?\n\n' +
               'Reply:\n' +
               '• "yes" to confirm and add alias\n' +
               '• The correct team name if I\'m wrong\n' +
               '• "skip" to ignore';
  } else {
    content += '❓ I couldn\'t find a close match.\n\n' +
               'Reply with the correct team name, or "skip" to ignore.';
  }

  var dmResult = (typeof sendDM === 'function') ? sendDM(userId, content) : {ok: false, id: ''};

  if (dmResult.ok) {
    // Store pending suggestion
    storePendingAliasSuggestion({
      userId: userId,
      input: input,
      suggested: suggestion ? suggestion.name : null,
      originalMessageId: originalMessage.id,
      originalChannelId: originalMessage.channel_id,
      originalContent: String(originalMessage.content || '').slice(0, 200),
      timestamp: Date.now()
    });
  }

  return dmResult;
}

/**
 * Store a pending alias suggestion in Script Properties.
 * @param {Object} data - {userId, input, suggested, originalMessageId, originalChannelId, originalContent, timestamp}
 */
function storePendingAliasSuggestion(data) {
  var sp = PropertiesService.getScriptProperties();
  var key = 'PENDING_ALIAS_SUGGESTION::' + String(data.userId || '');
  sp.setProperty(key, JSON.stringify(data));
}

/**
 * Get all pending alias suggestions from Script Properties.
 * @returns {Array<Object>} Array of pending suggestion objects
 */
function getPendingAliasSuggestions() {
  var sp = PropertiesService.getScriptProperties();
  var allProps = sp.getProperties();
  var pending = [];

  for (var key in allProps) {
    if (key.indexOf('PENDING_ALIAS_SUGGESTION::') === 0) {
      try {
        var data = JSON.parse(allProps[key]);
        pending.push(data);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  return pending;
}

/**
 * Remove a pending alias suggestion from Script Properties.
 * @param {string} userId - Discord user ID
 */
function removePendingAliasSuggestion(userId) {
  var sp = PropertiesService.getScriptProperties();
  var key = 'PENDING_ALIAS_SUGGESTION::' + String(userId || '');
  sp.deleteProperty(key);
}

/**
 * Add an alias to the _Aliases sheet.
 * @param {string} alias - Alias text
 * @param {string} canonical - Canonical team name
 * @returns {boolean} True if added successfully
 */
function addAliasToSheet(alias, canonical) {
  try {
    var sh = (typeof getSheetByName === 'function') ? getSheetByName('_Aliases') : null;
    if (!sh) {
      if (typeof sendLog === 'function') sendLog('❌ _Aliases sheet not found');
      return false;
    }

    // Check if alias already exists
    var existingAliases = (typeof loadTeamAliases === 'function') ? loadTeamAliases() : {};
    var aliasUpper = String(alias || '').trim().toUpperCase();

    if (existingAliases[aliasUpper]) {
      if (typeof sendLog === 'function') {
        sendLog('ℹ️ Alias "' + alias + '" already exists → ' + existingAliases[aliasUpper]);
      }
      return false;
    }

    // Append new row: [alias, canonical]
    sh.appendRow([String(alias || '').trim(), String(canonical || '').trim()]);

    // Clear the alias cache to force reload
    if (typeof TEAM_ALIAS_CACHE !== 'undefined') {
      TEAM_ALIAS_CACHE = null;
    }
    if (typeof TEAM_INDEX_CACHE !== 'undefined') {
      TEAM_INDEX_CACHE = null;
    }

    if (typeof sendLog === 'function') {
      sendLog('✅ Added alias: "' + alias + '" → "' + canonical + '"');
    }

    return true;
  } catch (e) {
    if (typeof sendLog === 'function') {
      sendLog('❌ Error adding alias: ' + String(e && e.message || e));
    }
    return false;
  }
}

/**
 * Get DM channel ID for a user (creates DM channel if needed).
 * Uses the relay's /dm endpoint to get or create a DM channel.
 * @param {string} userId - Discord user ID
 * @returns {string} DM channel ID or empty string if failed
 */
function getDMChannelId(userId) {
  // We'll leverage the fact that when we send a DM, Discord creates/reuses the channel
  // For reading, we need to get the DM channel ID differently
  // The relay doesn't expose this directly, so we'll use a workaround:
  // Store the DM channel ID when we send the DM
  var sp = PropertiesService.getScriptProperties();
  var key = 'DM_CHANNEL_ID::' + String(userId || '');
  var channelId = sp.getProperty(key);

  if (channelId) return channelId;

  // If not cached, we can't easily get it without modifying the relay
  // For now, return empty and rely on the relay returning the channel ID when we send a DM
  return '';
}

/**
 * Check pending alias suggestions and process any DM replies.
 * Called during batch processing to automatically handle captain responses.
 * @returns {Object} {processed: number, added: number, skipped: number}
 */
function checkAndProcessAliasSuggestions() {
  var pending = getPendingAliasSuggestions();
  var processed = 0;
  var added = 0;
  var skipped = 0;

  if (typeof logToSheet === 'function') {
    logToSheet('🔍 Checking ' + pending.length + ' pending alias suggestions for DM replies...');
  }

  for (var i = 0; i < pending.length; i++) {
    var sug = pending[i];

    // Check if suggestion is older than 7 days - auto-expire
    var age = Date.now() - (sug.timestamp || 0);
    var maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (age > maxAge) {
      removePendingAliasSuggestion(sug.userId);
      if (typeof logToSheet === 'function') {
        logToSheet('⏰ Expired pending suggestion for user ' + sug.userId + ' (age: ' + Math.round(age / (24*60*60*1000)) + ' days)');
      }
      continue;
    }

    // Get DM channel and check for replies
    // Note: Since we don't have the DM channel ID stored, we'll need to modify sendDM to capture it
    // For now, we'll use a simpler approach: check if we can fetch recent DMs from the user

    var reply = checkDMReply(sug.userId, sug.timestamp);

    if (!reply) continue; // No reply yet

    processed++;
    var replyText = String(reply.content || '').toLowerCase().trim();

    // Process reply
    if (replyText === 'yes' || replyText === 'y' || replyText === 'confirm') {
      // Add the suggested alias
      if (sug.suggested) {
        var success = addAliasToSheet(sug.input, sug.suggested);
        if (success) {
          added++;
          // Send confirmation DM
          if (typeof sendDM === 'function') {
            sendDM(sug.userId, '✅ Added alias: "' + sug.input + '" → "' + sug.suggested + '"');
          }
        }
      }
      removePendingAliasSuggestion(sug.userId);

    } else if (replyText === 'skip' || replyText === 'no' || replyText === 'n' || replyText === 'cancel') {
      // User declined
      skipped++;
      if (typeof sendDM === 'function') {
        sendDM(sug.userId, 'ℹ️ Alias suggestion skipped.');
      }
      removePendingAliasSuggestion(sug.userId);

    } else {
      // User provided a custom team name
      // Treat the reply as the correct canonical name
      var customCanonical = reply.content.trim();
      var success = addAliasToSheet(sug.input, customCanonical);
      if (success) {
        added++;
        if (typeof sendDM === 'function') {
          sendDM(sug.userId, '✅ Added alias: "' + sug.input + '" → "' + customCanonical + '"');
        }
      }
      removePendingAliasSuggestion(sug.userId);
    }
  }

  if (typeof logToSheet === 'function' && (processed > 0 || pending.length > 0)) {
    logToSheet('📬 Alias suggestions: ' + processed + ' processed, ' + added + ' added, ' + skipped + ' skipped, ' + (pending.length - processed) + ' pending');
  }

  return {
    processed: processed,
    added: added,
    skipped: skipped
  };
}

/**
 * Check for DM reply from a user after a specific timestamp.
 * Fetches recent messages from the DM channel and looks for user replies.
 * @param {string} userId - Discord user ID
 * @param {number} afterTimestamp - Only check messages after this timestamp
 * @returns {Object|null} Message object {content, id, timestamp} or null
 */
function checkDMReply(userId, afterTimestamp) {
  try {
    // Get the DM channel ID (stored when we sent the initial DM)
    var channelId = getDMChannelId(userId);
    if (!channelId) {
      // No DM channel found - user hasn't replied yet or channel not cached
      return null;
    }

    // Fetch recent messages from the DM channel (limit 10 to be efficient)
    var messages = (typeof fetchChannelMessages === 'function')
      ? fetchChannelMessages(channelId, { limit: 10 })
      : [];

    if (!Array.isArray(messages) || messages.length === 0) return null;

    // Convert afterTimestamp to snowflake for comparison
    var afterSnowflake = String(afterTimestamp || 0);

    // Look for the first message from the USER (not the bot) after our DM
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];

      // Skip if this is our bot's message
      if (msg.author && msg.author.bot) continue;

      // Check if message is after our suggestion timestamp
      // Discord snowflake IDs are chronologically sortable
      if (typeof compareSnowflakes === 'function') {
        if (compareSnowflakes(msg.id, afterSnowflake) > 0) {
          // Found a reply!
          return {
            content: String(msg.content || ''),
            id: String(msg.id || ''),
            timestamp: msg.timestamp || Date.now()
          };
        }
      } else {
        // Fallback: just return the first non-bot message
        return {
          content: String(msg.content || ''),
          id: String(msg.id || ''),
          timestamp: msg.timestamp || Date.now()
        };
      }
    }

    return null; // No reply found
  } catch (e) {
    // Ignore errors (DM channel might not be accessible)
    return null;
  }
}
