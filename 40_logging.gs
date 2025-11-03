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
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet('WM_LOG');
      sh.hideSheet();
      sh.appendRow([`Timestamp`,`Level`,`Event`,`Message`,`Details (JSON)`]);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), level, msg, data ? JSON.stringify(data).slice(0,50000) : '']);
  } catch (_){}
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
  const sheet = SpreadsheetApp.getActive().getSheetByName('WM_Log');
  if (!sheet) return;

  const map = entry.map || '';
  const date = entry.whenText || '';
  const teams = `${entry.team1} vs ${entry.team2}`;
  const div = entry.division || '';
  const status = isTentative ? 'Confirming' : (isRematch ? 'Rematch' : 'Scheduled');
  const rowBit = entry.row ? `Row ${entry.row}` : '';
  const authorBit = authorId ? ` by <@${authorId}>` : '';
  const channelBit = sourceChannel ? `from #${sourceChannel}` : '';

  const message = `✅ **${div}** • \`${map}\` • ${teams} • ${date} • ${status} ${rowBit}${authorBit} ${channelBit}`;
  sendLog_(message);
}

function logToWmSheet_(level, event, message, detailsObj) {
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['Timestamp', 'Level', 'Event', 'Message', 'Details (JSON)']);
      sh.hideSheet();
    }
    sh.appendRow([
      Utilities.formatDate(new Date(), getTz_ ? getTz_() : Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      String(level || 'INFO'),
      String(event || ''),
      String(message || ''),
      detailsObj ? JSON.stringify(detailsObj) : ''
    ]);
  } catch (e) {
    // Don't let logging failures break anything
  }
}
