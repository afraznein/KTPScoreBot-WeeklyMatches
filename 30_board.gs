// =======================
// board.gs – Weekly board rendering and posting
// =======================

// ----- Create Weekly Tables -----

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

  // ---- Compose content (header + two plain-text bodies)
  var header = (typeof renderHeaderEmbedPayload_ === 'function') ? renderHeaderEmbedPayload_(week) : null;

  var weeklyBody = (typeof renderWeeklyTablesBody_ === 'function') ? renderWeeklyTablesBody_(week) : '';
  var makeupsArr = (typeof getMakeupMatchesAllDivs_ === 'function') ? getMakeupMatchesAllDivs_(week) : [];
  var remBody    = (typeof renderRematchesTableBody_ === 'function') ? renderRematchesTableBody_(makeupsArr) : '';

  // If no rematches, append a note to weekly body
  if (!remBody || !/\S/.test(remBody)) {
    if (weeklyBody && /\S/.test(weeklyBody)) {
      weeklyBody += '\n\n*No rematches currently pending.*';
    }
    remBody = ''; // ensure empty
  }

  // ---- Upsert: header + weekly + rematches (plain content for tables)
  var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
                  (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
  if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

  // ---- Upsert: header + one tables message, with safe fallbacks
var ids = _loadMsgIds_(wkKey); // { header, table, tables[], rematch? }

// Hashes
var headerHash = _safeHeaderHash_(header); // your helper that strips footer/timestamp etc
var tableBody  = (pages && pages.length) ? String(pages[0] || '') : '';
var tableHash  = tableBody ? sha256Hex_(tableBody) : '';

// Load previous hashes
var hashKey = 'WEEKLY_MSG_HASHES::' + wkKey;
var prev = (function(){ try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(hashKey) || '{}'); } catch (e) { return {}; } })();
var prevHeaderHash = prev.header || '';
var prevTableHash  = prev.table  || '';

var actionHeader = 'noop', actionTable = 'noop';

// 1) Header — create if missing, else edit only if changed
try {
  if (!ids.header) {
    ids.header = postChannelMessageAdvanced_(channelId, '', header.embeds);
    actionHeader = ids.header ? 'created' : 'noop';
  } else if (prevHeaderHash !== headerHash) {
    // only edit if we have a valid id
    editChannelMessageAdvanced_(channelId, ids.header, '', header.embeds);
    actionHeader = 'edited';
  }
} catch (e) {
  // If edit failed due to missing/invalid ID, fall back to create once
  try {
    ids.header = postChannelMessageAdvanced_(channelId, '', header.embeds);
    actionHeader = ids.header ? 'created' : 'noop';
  } catch (e2) {
    throw new Error('Failed to upsert header: ' + (e2 && e2.message));
  }
}

// 2) Tables — create if missing, else edit only if changed
try {
  if (tableBody) {
    if (!ids.table) {
      ids.table = postChannelMessage_(channelId, tableBody);
      actionTable = ids.table ? 'created' : 'noop';
    } else if (prevTableHash !== tableHash) {
      editChannelMessage_(channelId, ids.table, tableBody);
      actionTable = 'edited';
    }
  }
} catch (e) {
  // If edit failed due to missing/invalid ID, fall back to create once
  try {
    ids.table = postChannelMessage_(channelId, tableBody);
    actionTable = ids.table ? 'created' : 'noop';
  } catch (e2) {
    throw new Error('Failed to upsert tables: ' + (e2 && e2.message));
  }
}

// Normalize legacy fields and persist
ids.tables = ids.table ? [ids.table] : [];
ids = _saveMsgIds_(wkKey, ids);

// Save new hashes
PropertiesService.getScriptProperties().setProperty(hashKey, JSON.stringify({ header: headerHash, table: tableHash }));

// Build result + helpful context
var created = [], edited = [];
if (actionHeader === 'created' && ids.header) created.push(ids.header);
if (actionHeader === 'edited'  && ids.header) edited.push(ids.header);
if (actionTable  === 'created' && ids.table)  created.push(ids.table);
if (actionTable  === 'edited'  && ids.table)  edited.push(ids.table);

var result = {
  ok: true,
  weekKey: wkKey,
  channelId: channelId,
  headerId: ids.header || '',
  tableId:  ids.table  || '',
  action:   (created.length ? 'created' : (edited.length ? 'edited' : 'no_change')),
  prevHash: { header: prevHeaderHash, table: prevTableHash },
  newHash:  { header: headerHash,     table: tableHash },
  created: created,
  edited:  edited,
  messageIds: [ids.header, ids.table].filter(Boolean)
};

// Optional: log a concise trace for WM_LOG / debug
try { logLocal_('INFO','weekly.board.upsert', { wkKey: wkKey, ids: { header: ids.header, table: ids.table }, actions: { header: actionHeader, table: actionTable } }); } catch (_){}

return result;

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
 * Compose ONE Discord message body for current week Bronze / silver / gold current tables
 * and ONE Discord message body for rematches (if they exist) grouped by map then division
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

  // inside renderTablesPages_(week, store) AFTER the three current week tables:
  var makeupsArr = (typeof getMakeupMatchesAllDivs_ === 'function') ? getMakeupMatchesAllDivs_(week) : [];
  var remBody = (typeof renderRematchesTableBody_ === 'function') ? renderRematchesTableBody_(makeupsArr) : '';
  if (remBody && /\S/.test(remBody)) {
    if (chunks.length) chunks.push(''); // blank line before the single rematches table
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
 * Join Bronze, Silver, Gold pretty tables into ONE body (plain content).
 * Expects renderDivisionWeekTablePretty_(division, matches, label) to return a fenced block.
 */
function renderWeeklyTablesBody_(week) {
  var divs = (typeof getDivisionSheets_==='function') ? getDivisionSheets_() : ['Bronze','Silver','Gold'];
  var chunks = [];

  for (var i=0;i<divs.length;i++){
    var div = divs[i];
    var top = (typeof resolveDivisionBlockTop_==='function') ? resolveDivisionBlockTop_(div, week) : 0;
    if (!top) continue;

    var matches = (typeof getMatchesForDivisionWeek_==='function') ? getMatchesForDivisionWeek_(div, top) : [];
    if (!matches || !matches.length) continue;

    var block = (typeof renderDivisionWeekTable_==='function') ? renderDivisionWeekTable_(div, matches, div) : '';
    if (block && /\S/.test(block)) chunks.push(block);
  }

  return (chunks.join('\n\n') || '').trim();
}

/**
 * Single combined rematches table (one code fence).
 * Grouped by map → division; banner lines centered on the first '|' divider.
 */
function renderRematchesTableBody_(items) {
  items = Array.isArray(items) ? items.slice() : [];
  if (!items.length) return '';

  function isBye(s){ return /^\s*BYE\s*$/i.test(String(s||'')); }
  items = items.filter(function(x){ return x && x.home && x.away && !isBye(x.home) && !isBye(x.away); });
  if (!items.length) return '';

  // Required helpers/widths used by your weekly tables
  if (typeof _getTableWidths_ !== 'function' || typeof _padC_ !== 'function') return '';
  var W = _getTableWidths_();

  // Header line (exactly like weekly)
  var hdr = (typeof _formatVsHeader_ === 'function')
    ? _formatVsHeader_(W.COL1)
    : _padC_('Home  vs  Away', W.COL1);
  hdr = hdr + ' | ' + _padC_('Scheduled', W.COL2) + ' | ' + _padC_('Shoutcaster', W.COL3);

  var fullLen = hdr.length;
  var sep = (typeof _repeat_ === 'function') ? _repeat_('-', fullLen) : new Array(fullLen+1).join('-');

  // Center a banner label around the FIRST '|' divider (between COL1 and COL2)
  function centerAtDivider(label) {
    var rep = (typeof _repeat_ === 'function') ? _repeat_ : function(s,n){ return new Array(n+1).join(s); };
    label = ' ' + String(label || '').trim() + ' ';
    var L = Math.min(label.length, fullLen);

    // position of the '|' in "COL1 + ' | ' + ...": the pipe is at COL1+1 (0-based)
    var dividerIndex = W.COL1 + 1;

    // start index so that label's center aligns to the divider column
    var start = Math.max(0, dividerIndex - Math.floor(L / 2));
    if (start + L > fullLen) start = fullLen - L;

    return rep(' ', start) + label.slice(0, L) + rep(' ', fullLen - start - L);
  }

  // vs cell identical to weekly tables
  function vsCell(home, away) {
    if (typeof _formatVsRow_ === 'function') return _formatVsRow_(home, away, W.COL1);
    var leftW  = Math.floor((W.COL1 - 3) / 2);
    var rightW = W.COL1 - 3 - leftW;
    var l = (typeof _padR_==='function') ? _padR_(home, leftW) : String(home||'').padEnd(leftW, ' ');
    var r = (typeof _padL_==='function') ? _padL_(away, rightW): String(away||'').padStart(rightW,' ');
    return l + ' vs ' + r;
  }

  // Sort: map ASC → division Bronze→Silver→Gold → home/away alpha
  var DIV_ORDER = { Bronze:0, Silver:1, Gold:2 };
  items.sort(function(a,b){
    var ma = String(a.mapRef||'').toLowerCase(), mb = String(b.mapRef||'').toLowerCase();
    if (ma !== mb) return ma < mb ? -1 : 1;
    var da = (DIV_ORDER[a.division] != null) ? DIV_ORDER[a.division] : 99;
    var db = (DIV_ORDER[b.division] != null) ? DIV_ORDER[b.division] : 99;
    if (da !== db) return da - db;
    var ha = String(a.home||'').toLowerCase(), hb = String(b.home||'').toLowerCase();
    if (ha !== hb) return ha < hb ? -1 : 1;
    var aa = String(a.away||'').toLowerCase(), ab = String(b.away||'').toLowerCase();
    return (aa < ab) ? -1 : (aa > ab ? 1 : 0);
  });

  var out = [];
  out.push('**Make-ups & Rematches**');
  out.push('```text');
  out.push(hdr);
  out.push(sep);

  var currentMap = null, currentDiv = null;

  for (var i = 0; i < items.length; i++) {
    var it  = items[i];
    var map = it.mapRef || 'TBD';
    var div = it.division || '';

    if (map !== currentMap) {
      currentMap = map;
      currentDiv = null;
      out.push(centerAtDivider(map)); // map banner centered on the divider
    }
    /*if (div && div !== currentDiv) {
      currentDiv = div;
      out.push(centerAtDivider(div)); // division banner centered on the divider
    }*/ 

    var row = vsCell(it.home, it.away) + ' | ' + _padC_('TBD', W.COL2) + ' | ' + _padC_('-', W.COL3);
    out.push(row);
  }

  out.push('```');
  return out.join('\n');
}

// ----- Update Tables from User Input -----

/** Parse "YYYY-MM-DD|map" into a week object with a real Date in local ET. */
function _weekFromKey_(wkKey) {
  var parts = String(wkKey || '').split('|');
  var iso = parts[0] || '';
  var mapRef = parts[1] || '';
  var y = +iso.slice(0,4), m = +iso.slice(5,7), d = +iso.slice(8,10);
  var dt = new Date(y, m-1, d); // local date (Apps Script runs server-side but okay for day granularity)
  return { date: dt, mapRef: mapRef, weekKey: wkKey };
}

/** Canonicalize division label. */
function _canonDivision_(d) {
  if (!d) return '';
  var s = String(d).trim().toLowerCase();
  if (s === 'bronze' || s === 'b') return 'Bronze';
  if (s === 'silver' || s === 's') return 'Silver';
  if (s === 'gold'   || s === 'g') return 'Gold';
  // fallback: capitalize first letter
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ensure the week store has expected shape. */
function _ensureStoreShape_(store) {
  if (!store || typeof store !== 'object') return;
  if (!store.meta)  store.meta  = {};
  if (!store.sched) store.sched = {};   // per-division scheduled rows: { [div]: { [rowIndex]: {epochSec?, whenText, home, away} } }
  if (!store.cast)  store.cast  = {};   // optional: shoutcaster info per row
}

/**
 * Find the row index (0..9) of a match in the block for a division.
 * - top is the header row (A27/A38/…), grid is rows (top+1..top+10)
 * - compares names in C (home) and G (away)
 */
function _findMatchRowIndex_(division, top, home, away) {
  var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(division) : null;
  if (!sh) return -1;

  var gridStartRow = top + 1;
  var rows = 10; // grid size
  var band = sh.getRange(gridStartRow, 2, rows, 7).getDisplayValues(); // B..H

  var norm = function(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  };
  var nh = norm(home), na = norm(away);

  for (var i = 0; i < band.length; i++) {
    var r = band[i]; // [B,C,D,E,F,G,H]
    var ch = norm(r[1]); // C
    var ca = norm(r[5]); // G
    if (ch && ca && ch === nh && ca === na) return i;
  }

  // Soft match: allow partial on either side if unique
  var candidates = [];
  for (var j = 0; j < band.length; j++) {
    var rr = band[j];
    var ch2 = norm(rr[1]), ca2 = norm(rr[5]);
    if (!ch2 && !ca2) continue;
    var hit = (ch2 && (ch2.indexOf(nh) >= 0 || nh.indexOf(ch2) >= 0)) &&
              (ca2 && (ca2.indexOf(na) >= 0 || na.indexOf(ca2) >= 0));
    if (hit) candidates.push(j);
  }
  return (candidates.length === 1) ? candidates[0] : -1;
}

/**
 * Update the weekly tables from parsed pairs and re-render Discord.
 * @param {string} weekKey  "YYYY-MM-DD|map_ref"
 * @param {Array<Object>} pairs  [{division, home, away, whenText, epochSec? , weekKey?}, ...]
 * @returns {{ok:boolean, weekKey:string, updated:number, unmatched:Array, store:any}}
 */
function updateTablesMessageFromPairs_(weekKey, pairs) {
  // --- 0) Normalize inputs
  pairs = Array.isArray(pairs) ? pairs : [];
  if (!weekKey) {
    // fallback: take the weekKey from the first pair, if present
    weekKey = (pairs[0] && pairs[0].weekKey) ? String(pairs[0].weekKey) : '';
  }
  if (!weekKey || weekKey.indexOf('|') < 0) {
    throw new Error('updateTablesMessageFromPairs_: missing/invalid weekKey');
  }

  // --- 1) Derive a "week" object from weekKey (YYYY-MM-DD|map)
  var wkMeta = _weekFromKey_(weekKey);          // {date, mapRef, weekKey}
  // Allow the sheet to align blocks/canonical division tops etc.
  if (typeof syncHeaderMetaToTables_ === 'function') {
    // Use Gold (or Bronze) as canonical to ensure blocks map is present
    wkMeta = syncHeaderMetaToTables_(wkMeta, 'Gold');
  }

  // --- 2) Load the store, ensure shape
  var store = (typeof loadWeekStore_ === 'function') ? (loadWeekStore_(weekKey) || {}) : {};
  _ensureStoreShape_(store);

  // --- 3) For each pair, locate row inside the division's block and persist schedule
  var updated = 0;
  var unmatched = [];

  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i] || {};
    var div = _canonDivision_(p.division);
    var home = String(p.home || '').trim();
    var away = String(p.away || '').trim();
    if (!div || !home || !away) { unmatched.push({ reason:'bad_input', pair:p }); continue; }

    var top = (typeof resolveDivisionBlockTop_ === 'function')
      ? resolveDivisionBlockTop_(div, wkMeta)
      : 0;
    if (!top) {
      unmatched.push({ reason:'block_top_not_found', division:div, pair:p });
      continue;
    }

    var rowIndex = _findMatchRowIndex_(div, top, home, away); // 0..9 or -1
    if (rowIndex < 0) {
      unmatched.push({ reason:'row_not_found', division:div, pair:p });
      continue;
    }

    // Persist schedule in store: store.sched[division][rowIndex] = { epochSec?, whenText }
    if (!store.sched[div]) store.sched[div] = {};
    if (!store.sched[div][rowIndex]) store.sched[div][rowIndex] = {};

    var rec = store.sched[div][rowIndex];
    if (typeof p.epochSec === 'number') rec.epochSec = p.epochSec;
    if (p.whenText) rec.whenText = String(p.whenText);

    // (Optional) keep names here to help renderers or debugging
    rec.home = home; rec.away = away;

    updated++;
  }

  // --- 4) Save the store and re-render/update Discord (edit in place)
  if (typeof saveWeekStore_ === 'function') saveWeekStore_(weekKey, store);
  try {
    if (typeof upsertWeeklyDiscordMessage_ === 'function') {
      upsertWeeklyDiscordMessage_(wkMeta); // this will read the same store by weekKey
    }
  } catch (e) {
    // keep going but include error hint in payload
    store._upsertError = String(e && e.message || e);
  }

  return { ok:true, weekKey:weekKey, updated:updated, unmatched:unmatched, store:store };
}