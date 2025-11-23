// =======================
// 40_logging.gs - Logging & Notifications
// =======================
// Purpose: Discord/sheet logging, confirmation messages, parse summaries
// Dependencies: 00_config.gs, 05_util.gs, 30_relay.gs
// Used by: 55_rendering.gs, 60_parser.gs, 70_updates.gs
//
// Functions in this module:
// - logLocal(level, event, data)
// - logToSheet(msg)
// - sendLog(msg)
// - formatScheduleConfirmationLine(parsed, row, authorId, msgId)
// - logParsingSummary(successCount, tentativeCount, sourceChannel)
// - logMatchToWMLog(entry, authorId, sourceChannel, isTentative, isRematch)
// - logToWmSheet(level, event, message, detailsObj)
//
// Total: 7 functions
// =======================

// ----- LOGGING -----

/**
 * Append a log entry (timestamped) to console and optionally to Discord log channel.
 * @param {string} level - Log level (e.g., "INFO", "ERROR", "WARN")
 * @param {string} event - Event name or category
 * @param {*} data - Optional data to include in log (will be JSON stringified)
 */
function logLocal(level, event, data) {
  try {
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const line = `[${level}] ${ts} ${event} ${data ? JSON.stringify(data) : ''}`;
    console.log(line);
  } catch (e) {
    // If console logging fails for any reason, do nothing.
  }
}

/**
 * Write a log message only to WM_Log sheet (no Discord posting).
 * @param {string} msg - Message to log
 */
function logToSheet(msg) {
  try {
    if (!SPREADSHEET_ID) {
      console.error('logToSheet: SPREADSHEET_ID not configured');
      return;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(LOG_SHEET);

    if (!sh) {
      sh = ss.insertSheet(LOG_SHEET);
      sh.appendRow(['Timestamp', 'Level', 'Message']);
      sh.setFrozenRows(1);
    }

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sh.appendRow([timestamp, 'INFO', String(msg)]);
  } catch (e) {
    console.error('logToSheet failed:', e);
  }
}

/**
 * Send a brief log message to the results log channel (if configured) and write to sheet.
 * Posts to Discord RESULTS_LOG_CHANNEL_ID and appends to WM_Log sheet.
 * @param {string} msg - Message to log
 */
function sendLog(msg) {
  // Send to Discord log channel
  try {
    if (typeof postChannelMessage === 'function' && RESULTS_LOG_CHANNEL_ID) {
      postChannelMessage(RESULTS_LOG_CHANNEL_ID, msg);
    }
  } catch (e) {
    console.error('sendLog Discord post failed:', e);
  }

  // Write to WM_Log sheet
  logToSheet(msg);
}

/**
 * Format a confirmation line for a scheduled match.
 * @param {Object} parsed - Parsed match data {division, map, team1, team2, status, ...}
 * @param {number|null} row - Row number in sheet or null if unmapped
 * @param {string} authorId - Discord user ID who reported the match
 * @param {string} msgId - Discord message ID
 * @returns {string} Formatted confirmation message with emojis
 */
function formatScheduleConfirmationLine(parsed, row, authorId, msgId) {
  const mapShown = parsed.map || '?';
  const left = parsed.team1;
  const right = parsed.team2;
  const by = authorId ? ` — reported by <@${authorId}>` : '';
  // Note: buildDiscordMessageLink_ removed - was undefined
  const linkBit = '';
  const rowBit = row ? `Row ${row}` : 'Unmapped';
  const status = parsed.status || 'Scheduled';
  const emoji = status === 'Confirming' ? EMOJI_EDIT : EMOJI_OK;

  return `${emoji} **${parsed.division}** • \`${mapShown}\` • ${rowBit} — **${left} vs ${right}** (${status})${by}${linkBit}`;
}

/**
 * Log a summary of parsing results to Discord log channel.
 * @param {number} successCount - Number of successfully scheduled matches
 * @param {number} tentativeCount - Number of tentative/confirming matches
 * @param {string} sourceChannel - Discord channel name where messages were parsed from
 */
function logParsingSummary(successCount, tentativeCount, sourceChannel) {
  const total = successCount + tentativeCount;

  // Skip logging if no matches were parsed (0, 0, 0)
  if (total === 0) {
    return;
  }

  const emoji = EMOJI_OK;
  const msg = `${emoji} Parsed ${total} matches (${successCount} scheduled, ${tentativeCount} tentative)` +
    (sourceChannel ? ` — from #${sourceChannel}` : '');
  sendLog(msg);
}

/**
 * Log a match entry to the WM_Log sheet in the spreadsheet.
 * @param {Object} entry - Match entry {division, map, team1, team2, whenText, row, ...}
 * @param {string} authorId - Discord user ID who reported the match
 * @param {string} sourceChannel - Discord channel name where match was reported
 * @param {boolean} isTentative - Whether match is tentative/confirming
 * @param {boolean} isRematch - Whether this is a rematch
 */
function logMatchToWMLog(entry, authorId, sourceChannel, isTentative, isRematch) {
  try {
    if (!SPREADSHEET_ID) return;

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('WM_Log');

    if (!sheet) {
      sheet = ss.insertSheet('WM_Log');
      sheet.appendRow(['Timestamp', 'Division', 'Map', 'Teams', 'When', 'Status', 'Row', 'Author', 'Channel']);
      sheet.setFrozenRows(1);
    }

    const map = entry.map || '';
    const date = entry.whenText || '';
    const teams = `${entry.team1} vs ${entry.team2}`;
    const div = entry.division || '';
    const status = isTentative ? 'Confirming' : (isRematch ? 'Rematch' : 'Scheduled');
    const rowBit = entry.row ? `Row ${entry.row}` : '';
    const authorBit = authorId ? `@${authorId}` : '';
    const channelBit = sourceChannel || '';

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([timestamp, div, map, teams, date, status, rowBit, authorBit, channelBit]);
  } catch (e) {
    console.error('logMatchToWMLog failed:', e);
  }
}

/**
 * Log a structured event to the WM_Log sheet with level, event, message, and JSON details.
 * @param {string} level - Log level (INFO, ERROR, WARN, etc.)
 * @param {string} event - Event name or category
 * @param {string} message - Human-readable log message
 * @param {Object} detailsObj - Optional object with additional details (will be JSON stringified)
 */
function logToWmSheet(level, event, message, detailsObj) {
  try {
    if (!SPREADSHEET_ID) return;

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName(LOG_SHEET);

    if (!sh) {
      sh = ss.insertSheet(LOG_SHEET);
      sh.appendRow(['Timestamp', 'Level', 'Event', 'Message', 'Details (JSON)']);
      sh.setFrozenRows(1);
    }

    const tz = (typeof getTimezone === 'function') ? getTimezone() : Session.getScriptTimeZone();
    const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

    sh.appendRow([
      timestamp,
      String(level || 'INFO'),
      String(event || ''),
      String(message || ''),
      detailsObj ? JSON.stringify(detailsObj) : ''
    ]);
  } catch (e) {
    console.error('logToWmSheet failed:', e);
  }
}