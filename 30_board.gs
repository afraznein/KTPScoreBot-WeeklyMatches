// =======================
// board.gs – Weekly board rendering and posting
// =======================

function upsertWeeklyDiscordMessage_(week) {
  // ---- Normalize inputs
  week = week || {};
  if (!week.date && typeof getAlignedUpcomingWeekOrReport_ === 'function') {
    // Best-effort fetch if caller passed nothing
    var w2 = getAlignedUpcomingWeekOrReport_();
    if (w2 && w2.date) week = w2;
  }
  if (!week || !week.date) throw new Error('No aligned week (week.date missing)');

  if (typeof syncHeaderMetaToTables_ === 'function') {
    week = syncHeaderMetaToTables_(week, 'Gold'); // Gold as canonical (Should always have a gold division)
  }

  // --- Now compute wkKey from the (possibly updated) week
  var wkKey = (typeof weekKey_ === 'function') ? weekKey_(week) : (String(week.weekKey || '') || '');
  if (!wkKey) {
    var dIso = Utilities.formatDate(week.date, 'America/New_York', 'yyyy-MM-dd');
    var mRef = String(week.mapRef || '').trim();
    wkKey = dIso + '|' + mRef;
  }

  // ---- Compose content
  var store  = (typeof loadWeekStore_ === 'function') ? loadWeekStore_(wkKey) : null;
  var pages  = (typeof renderTablesPages_ === 'function') ? (renderTablesPages_(week, store) || []) : [];
  var header = (typeof renderHeaderEmbedPayload_ === 'function') ? renderHeaderEmbedPayload_(week) : null;

  // Safety: ensure we only ever have ONE tables page in this flow.
  if (Array.isArray(pages) && pages.length > 1) {
    pages = [pages.join('\n\n')];
  }

  // ---- Upsert: header + one tables message, storing IDs and hashes
var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
                (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

// Load existing IDs
var ids = _loadMsgIds_(wkKey);

var headerHash = _safeHeaderHash_(header);
var tableBody  = (pages && pages.length) ? String(pages[0] || '') : '';
var tableHash  = sha256Hex_(tableBody);

// Load previous hashes
var hashKey = 'WEEKLY_MSG_HASHES::' + wkKey;
var prev = (function(){ try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(hashKey) || '{}'); } catch (e) { return {}; } })();
var prevHeaderHash = prev.header || '';
var prevTableHash  = prev.table  || '';

var actionHeader = 'noop';
var actionTable  = 'noop';

// 1) Header
if (!ids.header) {
  ids.header = postChannelMessageAdvanced_(channelId, '', header.embeds);
  actionHeader = 'created';
} else if (prevHeaderHash !== headerHash) {
  editChannelMessageAdvanced_(channelId, ids.header, '', header.embeds);
  actionHeader = 'edited';
}

// 2) Tables (single message)
if (tableBody) {
  if (!ids.table) {
    ids.table = postChannelMessage_(channelId, tableBody);
    actionTable = 'created';
  } else if (prevTableHash !== tableHash) {
    editChannelMessage_(channelId, ids.table, tableBody);
    actionTable = 'edited';
  }
}

// 3) Clean up any legacy extras; then persist IDs
ids.tables = ids.table ? [ids.table] : [];
ids = _saveMsgIds_(wkKey, ids);

// 4) Save new hashes
PropertiesService.getScriptProperties().setProperty(hashKey, JSON.stringify({ header: headerHash, table: tableHash }));

// 5) Return a clear result
var result = {
  ok: true,
  weekKey: wkKey,
  channelId: channelId,
  headerId: ids.header || '',
  tableId:  ids.table  || '',
  action:   (actionHeader === 'created' || actionTable === 'created') ? 'created'
           : (actionHeader === 'edited'  || actionTable === 'edited')  ? 'edited'
           : 'no_change',
  prevHash: { header: prevHeaderHash, table: prevTableHash },
  newHash:  { header: headerHash,     table: tableHash }
};


  // --- Compose & emit human notice (SAFE even if created/edited are not defined) ---

  // Safely read arrays if present; otherwise default empty
  var _created = (typeof created !== 'undefined' && Array.isArray(created)) ? created : [];
  var _edited  = (typeof edited  !== 'undefined' && Array.isArray(edited )) ? edited  : [];
  var _deleted = (typeof deleted !== 'undefined' && Array.isArray(deleted)) ? deleted : [];

  var createdCount = _created.length;
  var editedCount  = _edited.length;
  var deletedCount = _deleted.length;

  // Prefer explicit action, otherwise infer from counts
  var actionWord = (function(){
    if (createdCount && editedCount) return 'Posted/Edited';
    if (createdCount)               return 'Posted';
    if (editedCount)                return 'Edited';
    if (typeof action === 'string' && action === 'skipped_no_change') return 'Up-to-date';
    return 'Posted/Edited'; // conservative default
  })();

  // Build and send the notice
  var notice = formatWeeklyNotice_(week, actionWord);
  try { sendLog_(notice); } catch (_){}

  try {
    logLocal_('INFO','weekly.board.notice', {
      text: notice,
      wkKey: String(wkKey || ''),
      headerId: (ids && ids.header) ? String(ids.header) : null,
      tableId:  (ids && ids.tables && ids.tables[0]) ? String(ids.tables[0]) : null,
      action: actionWord,
      counts: { created: createdCount, edited: editedCount, deleted: deletedCount }
    });
  } catch (_){}

  return result;
}

/** Render the weekly header embed payload for a given `week` object. */
function renderHeaderEmbedPayload_(week) {
  var tz     = week.tz || getTz_();
  var wkKey  = String(week.weekKey || '');
  var mapRef = String(week.mapRef || '');
  var season = String(week.seasonWeek || '');
  var label  = String(week.label || '');

  // Compute epoch for 9:00 PM on the grid date (parsed in project TZ)
  var keyDate = wkKey.indexOf('|') >= 0 ? wkKey.split('|')[0] : '';
  var epoch = null;
  if (keyDate) {
    var dt = new Date(keyDate + 'T21:00:00');  // <-- no TZ suffix here
    if (!isNaN(dt.getTime())) epoch = Math.floor(dt.getTime() / 1000);
  }
  var seasonInfo = getSeasonInfo_();
  var title = String(seasonInfo || '') + ' Weekly Matches';
  if (season)      title += ' — ' + season;
  else if (label)  title += ' — ' + label;
  else if (keyDate)title += ' — ' + keyDate;

  var lines = [];
  if (label) lines.push('**' + label + '**');
  if (mapRef) {
    var mapLine = 'Map: `' + mapRef + '`';
    if (epoch != null) mapLine += ' @ default: <t:' + epoch + ':F> • <t:' + epoch + ':R>';
    lines.push(mapLine);
  }

  return {
    embeds: [{
      title: title,
      description: lines.join('\n'),
      color: (typeof EMBED_COLOR !== 'undefined') ? EMBED_COLOR : 0x48C9B0,
      footer: { text: 'Updated ' + Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a z') }
    }]
  };
}

/**
 * Compose ONE Discord message body:
 *  - Bronze current table
 *  - Silver current table
 *  - Gold   current table
 *  - Make-ups (if any)
 * Returns [string] or [] if nothing to post.
 */
function renderTablesPages_(week, store) {
  var chunks = [];

  var divs = (typeof getDivisionSheets_ === 'function')
    ? getDivisionSheets_()
    : ['Bronze','Silver','Gold'];

  // Current-week tables (one per division)
  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var top = (typeof resolveDivisionBlockTop_ === 'function') ? resolveDivisionBlockTop_(div, week) : 0;
    if (!top) continue;

    var matches = (typeof getMatchesForDivisionWeek_ === 'function') ? getMatchesForDivisionWeek_(div, top) : [];
    if (!matches || !matches.length) continue;

    var block = (typeof renderDivisionWeekTable_ === 'function')
      ? renderDivisionWeekTable_(div, matches, div) : '';
    if (block && /\S/.test(block)) chunks.push(block);
  }

  // Make-ups / rematches
  var makeupsArr = (typeof getMakeupMatchesAllDivs_ === 'function') ? getMakeupMatchesAllDivs_(week) : [];
  var remBody = (typeof renderRematchesTableBody_ === 'function') ? renderRematchesTableBody_(makeupsArr) : '';
  if (remBody && /\S/.test(remBody)) {
    if (chunks.length) chunks.push(''); // spacing before rematches
    chunks.push(remBody);
  }

  var full = (chunks.join('\n\n') || '').trim();
  if (!full) {
    try { sendLog_ && sendLog_('renderTablesPages_: empty-composition'); } catch (_) {}
    return [];
  }
  return [full];
}

/**
 * Render one division table (Bronze/Silver/Gold) for the current block.
 * Strategy:
 *  1) Try legacy rows start (top+2) with declared grid cols
 *  2) If empty, scan for first real match row (skips meta rows)
 *  3) If still empty, try alternate column pairs (C/G, B/F, D/H)
 * Always uses your width helpers to match formatting.
 */
function renderDivisionWeekTable_(division, week) {
  var sh = getSheetByName_(division);
  if (!sh) return '';

  var G = _gridMeta_();
  var top = resolveDivisionBlockTop_(division, week);
  if (!top) return '';

  // Grid band for this block
  var firstMatchRow = top + 1;           // header at top, data starts at next row
  var numRows       = G.matchesPerBlock; // 10
  var numCols       = 8;                 // A..H

  // Pull rows A..H but we’ll only use C and G for team names
  var band = sh.getRange(firstMatchRow, 1, numRows, numCols).getDisplayValues();

  // Required helpers for your formatting
  if (typeof _getTableWidths_ !== 'function' ||
      typeof _formatVsHeader_ !== 'function' ||
      typeof _padC_ !== 'function' ||
      typeof _padL_ !== 'function' ||
      typeof _padR_ !== 'function') {
    return '';
  }

  var W = _getTableWidths_();
  var header = _formatVsHeader_(W.COL1) + ' | ' + _padC_('Scheduled', W.COL2) + ' | ' + _padC_('Shoutcaster', W.COL3);
  var sep    = _repeat_('-', header.length);

  var rows = [];
  for (var i = 0; i < band.length; i++) {
    var r = band[i];
    var home = String(r[2] || '').trim(); // C
    var away = String(r[6] || '').trim(); // G
    if (!home && !away) continue;
    if (/^\s*BYE\s*$/i.test(home) || /^\s*BYE\s*$/i.test(away)) continue;

    var vs = (typeof _formatVsRow_ === 'function')
      ? _formatVsRow_(home, away, W.COL1)
      : _padR_(home, Math.floor((W.COL1 - 3) / 2)) + ' vs ' + _padL_(away, Math.ceil((W.COL1 - 3) / 2));

    rows.push(vs + ' | ' + _padC_('TBD', W.COL2) + ' | ' + _padC_('-', W.COL3));
  }
  if (!rows.length) return '';

  var title = '';
  var body  = [header, sep].concat(rows).join('\n');
  return title + '```text\n' + division + '\n'  + body + '\n```';
}

/**
 * Pretty make-ups/rematches table.
 * Accepts a flat array: [{division, mapRef, home, away, ...}, ...]
 * Groups by map, orders Bronze→Silver→Gold, same column widths as current-week tables.
 */
function renderRematchesTableBody_(items) {
  items = Array.isArray(items) ? items.slice() : [];
  if (!items.length) return '';

  function isBye(s){ return /^\s*BYE\s*$/i.test(String(s||'')); }
  items = items.filter(function(x){ return x && x.home && x.away && !isBye(x.home) && !isBye(x.away); });
  if (!items.length) return '';

  var DIV_ORDER = { Bronze:0, Silver:1, Gold:2 };
  items.sort(function(a,b){
    var ma = String(a.mapRef||'').toLowerCase(), mb = String(b.mapRef||'').toLowerCase();
    if (ma !== mb) return ma < mb ? -1 : 1;
    var da = DIV_ORDER[a.division] != null ? DIV_ORDER[a.division] : 99;
    var db = DIV_ORDER[b.division] != null ? DIV_ORDER[b.division] : 99;
    if (da !== db) return da - db;
    var ha = String(a.home||'').toLowerCase(), hb = String(b.home||'').toLowerCase();
    if (ha !== hb) return ha < hb ? -1 : 1;
    var aa = String(a.away||'').toLowerCase(), ab = String(b.away||'').toLowerCase();
    return (aa < ab) ? -1 : (aa > ab ? 1 : 0);
  });

  if (typeof _getTableWidths_ !== 'function' || typeof _padC_ !== 'function') return '';

  var W = _getTableWidths_();
  var header = (typeof _formatVsHeader_ === 'function')
      ? _formatVsHeader_(W.COL1)
      : _padC_('Home  vs  Away', W.COL1);
  header = header + ' | ' + _padC_('Scheduled', W.COL2) + ' | ' + _padC_('Shoutcaster', W.COL3);
  var sep    = (typeof _repeat_ === 'function') ? _repeat_('-', header.length) : new Array(header.length+1).join('-');

  function vsCell(home, away) {
    if (typeof _formatVsRow_ === 'function') return _formatVsRow_(home, away, W.COL1);
    var leftW  = Math.floor((W.COL1 - 3)/2);
    var rightW = W.COL1 - 3 - leftW;
    return _padR_(home, leftW) + ' vs ' + _padL_(away, rightW);
  }

  var out = [];
  out.push('**Make-ups & Rematches**');

  var currentMap = null;
  for (var i=0;i<items.length;i++){
    var it = items[i];
    var map = it.mapRef || 'TBD';
    if (map !== currentMap) {
      currentMap = map;
      out.push('');
      out.push('**' + currentMap + '**');
    }
    // show division tag inside the block
    out.push('**' + (it.division || '') + '**');
    out.push('```text');
    out.push(header);
    out.push(sep);
    // consume this map+division run
    out.push(vsCell(it.home, it.away) + ' | ' + _padC_('TBD', W.COL2) + ' | ' + _padC_('-', W.COL3));

    // Look-ahead to append more rows for same map+division
    while (i+1 < items.length &&
           (items[i+1].mapRef||'TBD') === currentMap &&
           (items[i+1].division||'') === (it.division||'')) {
      i++;
      var it2 = items[i];
      out.push(vsCell(it2.home, it2.away) + ' | ' + _padC_('TBD', W.COL2) + ' | ' + _padC_('-', W.COL3));
    }
    out.push('```');
  }
  return out.join('\n');
}