// =======================
// 55_rendering.gs - Discord Message Rendering
// =======================
// Purpose: Discord embed/table formatting, weekly board construction
// Dependencies: 00_config.gs, 05_util.gs, 10_storage.gs, 20_sheets.gs, 30_relay.gs, 40_logging.gs
// Used by: 70_updates.gs, webapp endpoints
//
// Functions in this module:
// - upsertWeeklyDiscordMessage_(week)
// - renderCurrentWeekTablesSplit_(week, store)
// - renderDivisionCurrentTable_(division, week, store, mapName)
// - _renderDivisionTableSafely_(division, week, store)
// - _extractTableRows_(rendered)
// - renderHeaderEmbedPayload_(week)
// - renderTablesPages_(week, store)
// - renderDivisionWeekTable_(division, week)
// - renderWeeklyTablesBody_(week)
// - renderRematchesTableBody_()
//
// Total: 10 functions
// =======================

// ----- Create Weekly Tables -----
/***** MAIN: upsert header + weekly tables (1 msg) + rematches (N msgs if needed) *****/
function upsertWeeklyDiscordMessage_(week) {
  // Normalize week
  week = week || {};
  if (!week.date && typeof getAlignedUpcomingWeekOrReport_ === 'function') {
    var w2 = getAlignedUpcomingWeekOrReport_(); if (w2 && w2.date) week = w2;
  }
  if (!week || !week.date) throw new Error('No aligned week (week.date missing)');

  // Keep header meta in sync with grid (choose your canonical division)
  if (typeof syncHeaderMetaToTables_ === 'function') {
    week = syncHeaderMetaToTables_(week, 'Gold');
  }

  // Compute wkKey
  var wkKey = (typeof weekKey === 'function') ? weekKey(week) : String(week.weekKey || '');
  if (!wkKey) {
    var dIso = Utilities.formatDate(week.date, 'America/New_York', 'yyyy-MM-dd');
    var mRef = String(week.mapRef || '').trim();
    wkKey = dIso + '|' + mRef;
  }

  var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
    (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
  if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

  var store = (typeof loadWeekStore === 'function') ? loadWeekStore(wkKey) : null;
  var header = (typeof renderHeaderEmbedPayload_ === 'function') ? renderHeaderEmbedPayload_(week) : { embeds: [] };

  // ======== build Weekly Tables body (prefer your working functions) ========
  var weeklyBody = '';
  if (typeof renderWeeklyTablesBody_ === 'function') {
    // your preferred "worked last" implementation
    var body = renderWeeklyTablesBody_(week, store);
    weeklyBody = body ? ensureFence((body)) : '';
  } else if (typeof renderTablesPages_ === 'function') {
    // fallback: join pages into ONE message
    var pages = renderTablesPages_(week, store) || [];
    var joined = (Array.isArray(pages) ? pages : [String(pages || '')]).filter(Boolean).join('\n\n');
    weeklyBody = joined ? ensureFence(joined) : '';
  } else {
    // last-resort: try existing split renderer (if present)
    if (typeof renderCurrentWeekTablesSplit_ === 'function') {
      var split = renderCurrentWeekTablesSplit_(week) || [];
      weeklyBody = split.length ? ensureFence(split.filter(Boolean).join('\n\n')) : '';
    }
  }

  // ======== build Rematches (raw; chunk later) ========
  var remBody = '';
  if (typeof renderRematchesTableBody_ === 'function') {
    remBody = String(renderRematchesTableBody_(week) || '');
    remBody = stripFence(remBody.trim());
  }

  var ids = loadMsgIds(wkKey);  // expects {header, table, rematch, tables[], rematches[]}

  // Hashes
  var headerHash = safeHeaderHash(header);
  var weeklyHash = weeklyBody ? ((typeof sha256Hex === 'function') ? sha256Hex(weeklyBody) : weeklyBody.length) : '';
  // var remHashSig = remBody ? ('REM\n' + remBody) : '';
  var remHash = remBody ? ((typeof sha256Hex === 'function') ? sha256Hex(remBody) : remBody.length) : '';

  // Prior hashes
  var mainKey = 'WEEKLY_MSG_HASHES::' + wkKey;
  var remKey = 'WEEKLY_REMATCH_HASH::' + wkKey;
  var prevMain = (function () { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(mainKey) || '{}'); } catch (_) { return {}; } })();
  var prevRem = (function () { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(remKey) || '{}'); } catch (_) { return {}; } })();
  var prevHeaderHash = prevMain.header || '';
  var prevWeeklyHash = prevMain.table || '';
  var prevRemHash = prevRem.rematch || '';

  var actionHeader = 'noop', actionWeekly = 'noop', actionRem = 'noop';

  // 1) Header
  try {
    if (!ids.header) {
      ids.header = postChannelMessageAdvanced_(channelId, '', header.embeds);
      actionHeader = ids.header ? 'created' : 'noop';
    } else if (prevHeaderHash !== headerHash) {
      editChannelMessageAdvanced_(channelId, ids.header, '', header.embeds);
      actionHeader = 'edited';
    }
  } catch (e) {
    // create once if edit path failed (bad id)
    ids.header = postChannelMessageAdvanced_(channelId, '', header.embeds);
    actionHeader = ids.header ? 'created' : 'noop';
  }

  // 2) Weekly tables (single message)
  if (weeklyBody) {
    try {
      if (!ids.table) {
        ids.table = postChannelMessage_(channelId, weeklyBody);
        actionWeekly = ids.table ? 'created' : 'noop';
      } else if (prevWeeklyHash !== weeklyHash) {
        editChannelMessage_(channelId, ids.table, weeklyBody);
        actionWeekly = 'edited';
      }
    } catch (e) {
      ids.table = postChannelMessage_(channelId, weeklyBody);
      actionWeekly = ids.table ? 'created' : 'noop';
    }
  }
  // 3) Rematches — create if missing, else edit if changed, or delete if now gone
  try {
    if (remBody) {
      if (!ids.rematch) {
        ids.rematch = postChannelMessage_(channelId, remBody);
        // (you may set an actionRematch variable to 'created' if ids.rematch is truthy)
      } else if (prevRemHash !== remHash) {
        editChannelMessage_(channelId, ids.rematch, remBody);
        // set actionRematch = 'edited'
      }
    } else {
      // If no rematches content but an old message exists, delete it
      if (ids.rematch) {
        try { deleteMessage_(channelId, ids.rematch); } catch (e) { /* log error if needed */ }
        ids.rematch = '';  // clear the stored ID since it's deleted
        // you could set actionRematch = 'deleted'
      }
    }
  }
  catch (e) {
    // Fallback: if edit failed (e.g., unknown message ID), try posting afresh
    if (remBody) {
      try {
        ids.rematch = postChannelMessage_(channelId, remBody);
        // actionRematch = 'created';
      } catch (e2) {
        throw new Error('Failed to upsert rematches: ' + (e2 && e2.message));
      }
    }
  }


  // Persist IDs + hashes
  ids.header = ids.header ? [ids.header] : [];
  ids.tables = ids.table ? [ids.table] : [];
  ids.rematches = ids.rematch ? [ids.rematch] : [];
  saveMsgIds(wkKey, ids);
  PropertiesService.getScriptProperties().setProperty(mainKey, JSON.stringify({
    header: headerHash,
    table: weeklyHash,
    rematch: remHash
  }));


  // Result
  var created = [], edited = [];
  if (actionHeader === 'created' && ids.header) created.push(ids.header);
  if (actionHeader === 'edited' && ids.header) edited.push(ids.header);
  if (actionWeekly === 'created' && ids.table) created.push(ids.table);
  if (actionWeekly === 'edited' && ids.table) edited.push(ids.table);
  if (actionRem === 'created' && ids.rematches && ids.rematches.length) created = created.concat(ids.rematches);
  if (actionRem === 'edited' && ids.rematches && ids.rematches.length) edited = edited.concat(ids.rematches);

  // --- Compose & emit human notice (SAFE even if created/edited are not defined) ---

  // Safely read arrays if present; otherwise default empty
  var _created = (typeof created !== 'undefined' && Array.isArray(created)) ? created : [];
  var _edited = (typeof edited !== 'undefined' && Array.isArray(edited)) ? edited : [];
  var _deleted = (typeof deleted !== 'undefined' && Array.isArray(deleted)) ? deleted : [];
  var createdCount = _created.length;
  var editedCount = _edited.length;
  var deletedCount = _deleted.length;
  // Prefer explicit action, otherwise infer from counts
  var actionWord = (function () {
    if (createdCount && editedCount) return 'Posted/Edited';
    if (createdCount) return 'Posted';
    if (editedCount) return 'Edited';
    if (deletedCount) return 'Deleted';
    if (typeof action === 'string' && action === 'skipped_no_change') return 'Up-to-date';
    return 'Posted/Edited'; // conservative default
  })();

  // Build and send the notice
  var notice = formatWeeklyNotice(week, actionWord);
  try { sendLog_(notice); } catch (_) { }

  try {
    logLocal('INFO', 'weekly.board.notice', {
      text: notice,
      wkKey: String(wkKey || ''),
      headerId: (ids && ids.header) ? String(ids.header) : null,
      tableId: (ids && ids.tables && ids.tables[0]) ? String(ids.tables[0]) : null,
      action: actionWord,
      counts: { created: createdCount, edited: editedCount, deleted: deletedCount }
    });
  } catch (_) { }

  return {
    ok: true,
    weekKey: wkKey,
    channelId: channelId,
    headerId: ids.header || '',
    tableId: ids.table || '',
    rematchIds: ids.rematches || [],
    action: (created.length ? 'created' : (edited.length ? 'edited' : 'no_change')),
    messageIds: [ids.header, ids.table].concat(ids.rematches || []).filter(Boolean)
  };
}

function renderCurrentWeekTablesSplit_(week, store) {
  var divs = (typeof getDivisionSheets === 'function') ? getDivisionSheets() : ['Bronze', 'Silver', 'Gold'];
  var order = ['Bronze', 'Silver', 'Gold'].filter(function (d) { return divs.indexOf(d) !== -1; });
  var parts = [];
  for (var i = 0; i < order.length; i++) {
    var tbl = renderDivisionCurrentTable_(order[i], week, store);
    if (tbl) parts.push(tbl);
  }
  return parts;
}

function renderDivisionCurrentTable_(division, week, store, mapName) {
  var W = getTableWidths();
  var header = formatVsHeader(W.COL1) + ' | ' + padRight('Scheduled', W.COL2) + ' | ' + padRight('Shoutcaster', W.COL3);
  var sep = Array(header.length + 1).join('-');

  var rendered = _renderDivisionTableSafely_(division, week, store);
  var rows = _extractTableRows_(rendered);
  if (!rows.length) return ''; // no rows in this division

  // Re-parse existing lines into (home, away, sched, cast) and reformat with centered vs
  var outRows = [];
  for (var i = 0; i < rows.length; i++) {
    var line = rows[i];
    var parts = line.split('|'); // [vs, sched, cast]
    var vsText = (parts[0] || '').trim();
    var sched = (parts[1] || '').trim();
    var cast = (parts[2] || '').trim();

    var m = vsText.match(/^(.*)\s+vs\s+(.*)$/i);
    var home = m ? m[1].trim() : vsText;
    var away = m ? m[2].trim() : '';

    var vsCell = formatVsCell(home, away, W.COL1);
    var row = vsCell + ' | ' + padRight(sched, W.COL2) + ' | ' + padRight(cast, W.COL3);
    outRows.push(row);
  }

  var title = '**' + String(mapName || '') + ' — ' + division + '**';
  return [title, '```', header, sep].concat(outRows).concat(['```']).join('\n');
}

function _renderDivisionTableSafely_(division, week, store) {
  if (typeof renderDivisionTableBody_ !== 'function') return '';
  try { return renderDivisionTableBody_(division, week, store) || ''; }
  catch (_) { try { return renderDivisionTableBody_(week, store, division) || ''; } catch (e) { return ''; } }
}

// Extract ONLY the data rows from a rendered division table's code fence
// Keeps the inner padded lines (so alignment remains perfect).
function _extractTableRows_(rendered) {
  if (!rendered) return [];
  var s = String(rendered);
  var i1 = s.indexOf('```'); if (i1 < 0) return [];
  var i2 = s.indexOf('```', i1 + 3); if (i2 < 0) return [];
  var body = s.substring(i1 + 3, i2);
  var lines = body.split(/\r?\n/).map(function (x) { return x; });

  // Find header + separator; keep rows after the separator
  var hdrIdx = -1, sepIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (hdrIdx < 0 && /Home\s+vs\s+Away/i.test(lines[i]) && /Shoutcaster/i.test(lines[i])) hdrIdx = i;
    if (hdrIdx >= 0 && /^-[-\s]+$/.test(lines[i])) { sepIdx = i; break; }
  }
  if (sepIdx < 0) return [];

  var rows = lines.slice(sepIdx + 1).filter(function (x) {
    return /\S/.test(x) && !/^```$/.test(x);
  });
  return rows;
}


/** Render the weekly header embed payload for a given `week` object. */
function renderHeaderEmbedPayload_(week) {
  var tz = week.tz || getTimezone();
  var wkKey = String(week.weekKey || '');
  var mapRef = String(week.mapRef || '');
  var season = String(week.seasonWeek || '');
  var label = String(week.label || '');

  // Compute epoch for 9:00 PM on the grid date (parsed in project TZ)
  var keyDate = wkKey.indexOf('|') >= 0 ? wkKey.split('|')[0] : '';
  var epoch = null;
  if (keyDate) {
    var dt = new Date(keyDate + 'T21:00:00');  // <-- no TZ suffix here
    if (!isNaN(dt.getTime())) epoch = Math.floor(dt.getTime() / 1000);
  }
  var seasonInfo = getSeasonInfo();
  var title = String(seasonInfo || '') + ' Weekly Matches';
  if (season) title += ' — ' + season;
  else if (label) title += ' — ' + label;
  else if (keyDate) title += ' — ' + keyDate;

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

  var divs = (typeof getDivisionSheets === 'function')
    ? getDivisionSheets()
    : ['Bronze', 'Silver', 'Gold'];

  // Current-week tables (one per division)
  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var top = (typeof resolveDivisionBlockTop === 'function') ? resolveDivisionBlockTop(div, week) : 0;
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

  // IFF No Rematches Table, post this
  if (!remBody || !/\S/.test(remBody)) { weeklyBody += EMOJI_KTP + '\n\n_No rematches pending for this week._' + EMOJI_KTP; }

  var full = (chunks.join('\n\n') || '').trim();
  if (!full) {
    try { sendLog_ && sendLog_('renderTablesPages_: empty-composition'); } catch (_) { }
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
  var sh = getSheetByName(division);
  if (!sh) return '';

  var G = gridMeta();
  var top = resolveDivisionBlockTop(division, week);
  if (!top) return '';

  // Grid band for this block
  var firstMatchRow = top + 1;           // header at top, data starts at next row
  var numRows = G.matchesPerBlock; // 10
  var numCols = 8;                 // A..H

  // Pull rows A..H but we'll only use C and G for team names
  var band = sh.getRange(firstMatchRow, 1, numRows, numCols).getDisplayValues();

  // Required helpers for your formatting
  if (typeof getTableWidths !== 'function' ||
    typeof formatVsHeader !== 'function' ||
    typeof padCenter !== 'function' ||
    typeof padLeft !== 'function' ||
    typeof padRight !== 'function') {
    return '';
  }

  var W = getTableWidths();
  var header = formatVsHeader(W.COL1) + ' | ' + padCenter('Scheduled', W.COL2) + ' | ' + padCenter('Shoutcaster', W.COL3);
  var sep = repeat('-', header.length);

  var rows = [];
  for (var i = 0; i < band.length; i++) {
    var r = band[i];
    var home = String(r[2] || '').trim(); // C
    var away = String(r[6] || '').trim(); // G
    if (!home && !away) continue;
    if (/^\s*BYE\s*$/i.test(home) || /^\s*BYE\s*$/i.test(away)) continue;

    var vs = (typeof formatVsRow === 'function')
      ? formatVsRow(home, away, W.COL1)
      : padRight(home, Math.floor((W.COL1 - 3) / 2)) + ' vs ' + padLeft(away, Math.ceil((W.COL1 - 3) / 2));

    rows.push(vs + ' | ' + padCenter('TBD', W.COL2) + ' | ' + padCenter('-', W.COL3));
  }
  if (!rows.length) return '';

  var title = '';
  var body = [header, sep].concat(rows).join('\n');
  return title + '```text\n' + division + '\n' + body + '\n```';
}

/**
 * Join Bronze, Silver, Gold pretty tables into ONE body (plain content).
 * Expects renderDivisionWeekTablePretty_(division, matches, label) to return a fenced block.
 */
function renderWeeklyTablesBody_(week) {
  var divs = (typeof getDivisionSheets === 'function') ? getDivisionSheets() : ['Bronze', 'Silver', 'Gold'];
  var chunks = [];

  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var top = (typeof resolveDivisionBlockTop === 'function') ? resolveDivisionBlockTop(div, week) : 0;
    if (!top) continue;

    var matches = (typeof getMatchesForDivisionWeek_ === 'function') ? getMatchesForDivisionWeek_(div, top) : [];
    if (!matches || !matches.length) continue;

    var block = (typeof renderDivisionWeekTable_ === 'function') ? renderDivisionWeekTable_(div, matches, div) : '';
    if (block && /\S/.test(block)) chunks.push(block);
  }

  return (chunks.join('\n\n') || '').trim();
}

/**
 * Single combined rematches table (one code fence).
 * Grouped by map → division; banner lines centered on the first '|' divider.
 */
function renderRematchesTableBody_() {
  var makeups = getMakeupMatchesAllDivs_();
  makeups = Array.isArray(makeups) ? makeups.slice() : [];
  if (!makeups.length) return '';

  function isBye(s) { return /^\s*BYE\s*$/i.test(String(s || '')); }
  makeups = makeups.filter(function (x) { return x && x.home && x.away && !isBye(x.home) && !isBye(x.away); });
  if (!makeups.length) return '';

  // Required helpers/widths used by your weekly tables
  if (typeof getTableWidths !== 'function' || typeof padCenter !== 'function') return '';
  var W = getTableWidths();

  // Header line (exactly like weekly)
  var hdr = (typeof formatVsHeader === 'function')
    ? formatVsHeader(W.COL1)
    : padCenter('Home  vs  Away', W.COL1);
  hdr = hdr + ' | ' + padCenter('Scheduled', W.COL2) + ' | ' + padCenter('Shoutcaster', W.COL3);

  var fullLen = hdr.length;
  var sep = (typeof repeat === 'function') ? repeat('-', fullLen) : new Array(fullLen + 1).join('-');

  // Center a banner label around the FIRST '|' divider (between COL1 and COL2)
  function centerAtDivider(label) {
    var rep = (typeof repeat === 'function') ? repeat : function (s, n) { return new Array(n + 1).join(s); };
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
    if (typeof formatVsRow === 'function') return formatVsRow(home, away, W.COL1);
    var leftW = Math.floor((W.COL1 - 3) / 2);
    var rightW = W.COL1 - 3 - leftW;
    var l = (typeof padRight === 'function') ? padRight(home, leftW) : String(home || '').padEnd(leftW, ' ');
    var r = (typeof padLeft === 'function') ? padLeft(away, rightW) : String(away || '').padStart(rightW, ' ');
    return l + ' vs ' + r;
  }

  // Sort: map ASC → division Bronze→Silver→Gold → home/away alpha
  var DIV_ORDER = { Bronze: 0, Silver: 1, Gold: 2 };
  makeups.sort(function (a, b) {
    var ma = String(a.mapRef || '').toLowerCase(), mb = String(b.mapRef || '').toLowerCase();
    if (ma !== mb) return ma < mb ? -1 : 1;
    var da = (DIV_ORDER[a.division] != null) ? DIV_ORDER[a.division] : 99;
    var db = (DIV_ORDER[b.division] != null) ? DIV_ORDER[b.division] : 99;
    if (da !== db) return da - db;
    var ha = String(a.home || '').toLowerCase(), hb = String(b.home || '').toLowerCase();
    if (ha !== hb) return ha < hb ? -1 : 1;
    var aa = String(a.away || '').toLowerCase(), ab = String(b.away || '').toLowerCase();
    return (aa < ab) ? -1 : (aa > ab ? 1 : 0);
  });

  var out = [];
  out.push('**Make-ups & Rematches**');
  out.push('```text');
  out.push(hdr);
  out.push(sep);

  var currentMap = null, currentDiv = null;

  for (var i = 0; i < makeups.length; i++) {
    var it = makeups[i];
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

    var row = vsCell(it.home, it.away) + ' | ' + padCenter('TBD', W.COL2) + ' | ' + padCenter('-', W.COL3);
    out.push(row);
  }

  out.push('```');
  return out.join('\n');
}
