// =======================
// 40_logging.gs - Logging & Notifications
// =======================
// Purpose: Discord/sheet logging, confirmation messages, parse summaries
// Dependencies: 00_config.gs, 05_util.gs, 30_relay.gs
// Used by: 55_rendering.gs, 60_parser.gs, 70_updates.gs
//
// Functions in this module:
// - sendLog_(msg)
// - formatScheduleConfirmationLine_(parsed, row, authorId, msgId)
// - logParsingSummary_(successCount, tentativeCount, sourceChannel)
// - logMatchToWMLog_(entry, authorId, sourceChannel, isTentative, isRematch)
// - logToWmSheet_(level, event, message, detailsObj)
//
// Total: 5 functions
// =======================

// ----- LOGGING -----

/** Append a log entry (timestamped) to console and optionally to Discord log channel. */
function logLocal(level, event, data) {
  try {
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const line = `[${level}] ${ts} ${event} ${data ? JSON.stringify(data) : ''}`;
    console.log(line);
  } catch (e) {
    // If console logging fails for any reason, do nothing.
  }
}

/** Send a brief log message to the results log channel (if configured) and write to sheet. */
function sendLog(msg) {
  // Send to Discord log channel
  try {
    if (typeof postChannelMessage_ === 'function' && RESULTS_LOG_CHANNEL_ID) {
      postChannelMessage_(RESULTS_LOG_CHANNEL_ID, msg);
    }
  } catch (e) {
    console.error('sendLog_ Discord post failed:', e);
  }

  // Write to WM_Log sheet
  try {
    if (!SPREADSHEET_ID) {
      console.error('sendLog_: SPREADSHEET_ID not configured');
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
    console.error('sendLog_ sheet write failed:', e);
  }
}

function formatScheduleConfirmationLine_(parsed, row, authorId, msgId) {
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

function logParsingSummary_(successCount, tentativeCount, sourceChannel) {
  const emoji = EMOJI_OK;
  const total = successCount + tentativeCount;
  const msg = `${emoji} Parsed ${total} matches (${successCount} scheduled, ${tentativeCount} tentative)` +
    (sourceChannel ? ` — from #${sourceChannel}` : '');
  sendLog_(msg);
}

function logMatchToWMLog_(entry, authorId, sourceChannel, isTentative, isRematch) {
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
    console.error('logMatchToWMLog_ failed:', e);
  }
}

function logToWmSheet_(level, event, message, detailsObj) {
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
    console.error('logToWmSheet_ failed:', e);
  }
}
