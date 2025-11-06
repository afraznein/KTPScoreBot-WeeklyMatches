// =======================
// 20_sheets.gs - Google Sheets Operations
// =======================
// Purpose: Grid reading, block resolution, team/map lookups from spreadsheet
// Dependencies: 00_config.gs, 05_util.gs
// Used by: 30_relay.gs, 55_rendering.gs, 60_parser.gs, 70_updates.gs
//
// Functions in this module:
// Grid/Metadata:
//   gridMeta, getAllMapsList
// Date/Time helpers:
//   parseSheetDateET, formatWeekRangeET
// Block/Week resolution:
//   findActiveIndexByDate, blockTopForIndex, weekKey, resolveDivisionBlockTop
// Sheet reading:
//   readA, getAlignedUpcomingWeekOrReport, deriveWeekMetaFromDivisionTop
// Match data retrieval:
//   syncHeaderMetaToTables, getMatchesForDivisionWeek, getMakeupMatchesAllDivs
//   findMatchAcrossAllWeeks
//
// Total: 15 functions
// =======================

/**
 * Return grid geometry metadata for weekly blocks in sheets.
 * @returns {Object} {firstLabelRow, firstMapRow, firstDateRow, stride, matchesPerBlock}
 */
function gridMeta() {
  return {
    firstLabelRow: 27,   // A27, A38, A49, ...
    firstMapRow: 28,   // A28, A39, A50, ...
    firstDateRow: 29,   // A29, A40, A51, ...
    stride: 11,
    matchesPerBlock: 10  // rows 28..37
  };
}

/**
 * Load all canonical maps from General!J2:J (non-blank).
 * @returns {string[]} Array of canonical map names
 */
function getAllMapsList() {
  var sh = getSheetByName('General');
  if (!sh) return [];
  var max = sh.getMaxRows();
  if (max < 2) return [];
  var vals = sh.getRange(2, 10, max - 1, 1).getDisplayValues(); // J=10
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '').trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * Parse a sheet date string (M/D or M/D/YY) into Date object in ET timezone.
 * @param {string} s - Date string from sheet
 * @returns {Date|null} Date object or null if unparseable
 */
function parseSheetDateET(s) {
  s = String(s || '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (!m) { var d0 = new Date(s); return isNaN(d0.getTime()) ? null : d0; }
  var mm = +m[1], dd = +m[2], yy = m[3] ? +m[3] : null; if (yy && yy < 100) yy += 2000;
  var y = yy || (new Date()).getFullYear();
  var iso = Utilities.formatString('%04d-%02d-%02d', y, mm, dd);
  var d = new Date(iso + 'T00:00:00-04:00'); return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date as a week range string (e.g., "Jan 5–11" or "Dec 28–Jan 3").
 * @param {Date} d - Date within the week
 * @returns {string} Formatted week range string
 */
function formatWeekRangeET(d) {
  var tz = 'America/New_York', t = new Date(d.getTime());
  var dow = (+Utilities.formatDate(t, tz, 'u')); // 1..7 (Mon..Sun)
  var start = new Date(t.getTime()); start.setDate(start.getDate() - (dow - 1));
  var end = new Date(start.getTime()); end.setDate(start.getDate() + 6);
  var left = Utilities.formatDate(start, tz, 'MMM d'), right = Utilities.formatDate(end, tz, 'MMM d');
  var lm = Utilities.formatDate(start, tz, 'MMM'), rm = Utilities.formatDate(end, tz, 'MMM');
  return (lm === rm) ? (left + '–' + Utilities.formatDate(end, tz, 'MMM d')) : (left + '–' + right);
}

/**
 * Find the active week block index by comparing today's date to sheet dates.
 * @param {Sheet} sheet - Division sheet to scan
 * @returns {number} Block index (0-based) or 0 if none found
 */
function findActiveIndexByDate(sheet) {
  var G = gridMeta(), tz = 'America/New_York';
  var todayEt = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00-04:00');
  var i = 0, lastGood = -1;
  while (i < 200) {
    var dateRow = G.firstDateRow + i * G.stride;
    if (dateRow > sheet.getMaxRows()) break;
    var s = sheet.getRange(dateRow, 1).getDisplayValue().trim();
    if (!s) { i++; continue; }
    var d = parseSheetDateET(s);
    if (d) { lastGood = i; if (d.getTime() >= todayEt.getTime()) return i; }
    i++;
  }
  return (lastGood >= 0 ? lastGood : 0);
}

/**
 * Convert block index to header row number (A27, A38, A49, ...).
 * @param {number} idx - Block index (0-based)
 * @returns {number} Header row number (1-based)
 */
function blockTopForIndex(idx) {
  var G = gridMeta();
  return G.firstLabelRow + (idx | 0) * G.stride;  // 27 + k*11
}

/**
 * Generate a week key string "YYYY-MM-DD|mapname" from week object.
 * @param {Object} week - Week object {date: Date, mapRef: string}
 * @returns {string} Week key in format "YYYY-MM-DD|mapname"
 */
function weekKey(week) {
  var tz = 'America/New_York';
  var d = (week && week.date instanceof Date) ? week.date : (week && week.date ? new Date(week.date) : null);
  var iso = d && !isNaN(d.getTime()) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
  var map = String(week && week.mapRef || '').trim();
  return iso + '|' + map;
}

/**
 * Locate the block "top" row for a division in the grid.
 * Priority:
 *   1) Honor week.blocks[division].top (if provided)
 *   2) Best scan match on this division sheet:
 *      - map + date match (score 3)
 *      - map-only match   (score 2)
 *      - date-only match  (score 1)
 *   3) Fallback to findActiveIndexByDate(sheet)
 * @param {string} division - Division name (Bronze/Silver/Gold)
 * @param {Object} week - Week object with optional blocks, mapRef, date
 * @returns {number} Top row number (>=1) or 0 if not found
 */
function resolveDivisionBlockTop(division, week) {
  // 0) honor hint
  try {
    var hinted = week && week.blocks && week.blocks[division] && week.blocks[division].top;
    if (hinted && hinted > 0) return hinted | 0;
  } catch (_) { }

  // 1) scan this division for best match (map+date → map-only → date-only)
  var sh = getSheetByName(division);
  if (!sh) return 0;
  var G = gridMeta();
  function norm(s) { return String(s || '').trim().toLowerCase(); }
  function toIso(d) { return Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'); }
  function parseDate(s) { return parseSheetDateET ? parseSheetDateET(s) : new Date(s); }

  var tgtMap = norm(week && week.mapRef);
  var tgtDate = (week && week.date) ? (week.date instanceof Date ? week.date : new Date(week.date)) : null;
  var tgtIso = (tgtDate && !isNaN(tgtDate.getTime())) ? toIso(tgtDate) : '';

  var bestIdx = -1, bestScore = -1, bestTie = 9e15;
  for (var i = 0; i < 200; i++) {
    var mapRow = G.firstMapRow + i * G.stride;
    var dateRow = G.firstDateRow + i * G.stride;
    if (mapRow > sh.getMaxRows()) break;

    var map = norm(sh.getRange(mapRow, 1).getDisplayValue());
    var dTxt = sh.getRange(dateRow, 1).getDisplayValue();
    var d = parseDate(dTxt);
    var iso = (d && !isNaN(d.getTime())) ? toIso(d) : '';

    if (!map && !iso) continue;

    var score = 0;
    if (tgtMap && map && map === tgtMap) score += 2;
    if (tgtIso && iso && iso === tgtIso) score += 1;

    if (score > 0) {
      var tie = 9e15;
      if (tgtDate && d && !isNaN(d.getTime())) tie = Math.abs(d.getTime() - tgtDate.getTime());
      if (score > bestScore || (score === bestScore && tie < bestTie)) {
        bestScore = score; bestTie = tie; bestIdx = i;
        if (score === 3) break; // perfect
      }
    }
  }
  if (bestIdx >= 0) return blockTopForIndex(bestIdx);

  // 2) fallback to active-by-date
  if (typeof findActiveIndexByDate === 'function') {
    var idx = findActiveIndexByDate(sh);
    return blockTopForIndex(idx);
  }
  return 0;
}

/**
 * Safe read of column A at a given row (returns trimmed display value or '').
 * @param {Sheet} sheet - Google Sheet object
 * @param {number} row - Row number (1-based)
 * @returns {string} Trimmed display value or empty string
 */
function readA(sheet, row) {
  try {
    return String(sheet.getRange('A' + row).getDisplayValue() || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Get the upcoming week metadata from Gold sheet (uses active index by date).
 * @returns {Object} Week object {date, mapRef, seasonWeekTitle, range, blocks, weekKey}
 */
function getAlignedUpcomingWeekOrReport() {
  var G = gridMeta(); var gold = getSheetByName('Gold');
  if (!gold) throw new Error('Sheet "Gold" not found');
  var idx = findActiveIndexByDate(gold);

  var mapRef = gold.getRange(G.firstMapRow + idx * G.stride, 1).getDisplayValue().trim();
  var dateTx = gold.getRange(G.firstDateRow + idx * G.stride, 1).getDisplayValue().trim();
  var label = gold.getRange(G.firstLabelRow + idx * G.stride, 1).getDisplayValue().trim();
  var date = parseSheetDateET(dateTx);
  if (!date) throw new Error('Could not parse default date at A' + (G.firstDateRow + idx * G.stride) + ' on Gold');

  var divs = (typeof getDivisionSheets === 'function') ? getDivisionSheets() : ['Bronze', 'Silver', 'Gold'];
  var blocks = {}; for (var i = 0; i < divs.length; i++) blocks[divs[i]] = { top: blockTopForIndex(idx) };

  var week = {
    date: date,
    mapRef: mapRef || '',
    seasonWeekTitle: label || '',
    range: formatWeekRangeET(date),
    blocks: blocks
  };
  week.weekKey = weekKey(week);
  return week;
}

/**
 * Pull meta for a division from its block header row (top = header row: A27/A38/A49…).
 * @param {string} division - Division name
 * @param {number} top - Header row number (1-based)
 * @returns {Object|null} {label, mapRef, date, range, epochSec} or null if not found
 */
function deriveWeekMetaFromDivisionTop(division, top) {
  var sh = (typeof getSheetByName === 'function') ? getSheetByName(division) : null;
  if (!sh || !top) return null;
  var tz = 'America/New_York';

  var label = String(sh.getRange(top + 0, 1).getDisplayValue() || '').trim(); // A(top)
  var mapRef = String(sh.getRange(top + 1, 1).getDisplayValue() || '').trim(); // A(top+1)
  var dateTx = String(sh.getRange(top + 2, 1).getDisplayValue() || '').trim(); // A(top+2)

  var date = (typeof parseSheetDateET === 'function') ? parseSheetDateET(dateTx) : new Date(dateTx);
  if (date && isNaN(date.getTime())) date = null;

  var range = date ? formatWeekRangeET(date) : '';
  var epochSec = null;
  if (date) {
    var dEt = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
    // default kickoff 9:00 PM ET
    var dt = new Date(dEt + 'T21:00:00-04:00');
    epochSec = Math.floor(dt.getTime() / 1000);
  }
  return { label: label, mapRef: mapRef, date: date, range: range, epochSec: epochSec };
}

/**
 * Make the header meta (label/map/date/range/epoch) come from the SAME
 * block as your current tables. Uses Bronze as canonical, unless you pass another division.
 * Also re-populates week.blocks so all divisions share this top.
 * @param {Object} week - Week object to sync
 * @param {string} canonicalDivision - Division to use as source (defaults to Bronze)
 * @returns {Object} Updated week object with synced metadata
 */
function syncHeaderMetaToTables(week, canonicalDivision) {
  week = week || {};
  var divs = (typeof getDivisionSheets === 'function') ? getDivisionSheets() : ['Bronze', 'Silver', 'Gold'];
  var canon = canonicalDivision || divs[0] || 'Bronze';

  var top = (typeof resolveDivisionBlockTop === 'function') ? resolveDivisionBlockTop(canon, week) : 0;
  if (!top) return week; // nothing to do

  var meta = deriveWeekMetaFromDivisionTop(canon, top);
  if (!meta) return week;

  week.seasonWeekTitle = meta.label || week.seasonWeekTitle || '';
  week.mapRef = meta.mapRef || week.mapRef || '';
  week.date = meta.date || week.date || null;
  week.range = meta.range || week.range || '';
  if (typeof meta.epochSec === 'number') week.epochSec = meta.epochSec;

  // unify all division tops to this block
  if (!week.blocks) week.blocks = {};
  for (var i = 0; i < divs.length; i++) week.blocks[divs[i]] = { top: top };

  // refresh weekKey now that meta is in sync
  if (typeof weekKey === 'function') week.weekKey = weekKey(week);
  return week;
}
/**
 * Returns current-week matches for a division.
 * top = header row (A27/A38/…); grid is rows (top+1 .. top+10), cols B..H.
 * Uses C/G for names; skips BYE/blank rows.
 * @param {string} division - Division name
 * @param {number} top - Header row number (1-based)
 * @returns {Array} Array of match objects {home, away, homeScore, awayScore}
 */
function getMatchesForDivisionWeek(division, top) {
  var sh = (typeof getSheetByName === 'function') ? getSheetByName(division)
      : null;
  if (!sh || !top) return [];

  var firstGridRow = top + 1;         // <-- IMPORTANT: start one row below header
  var rows = 10;                      // matches per block
  var band = sh.getRange(firstGridRow, 2, rows, 7).getDisplayValues(); // B..H

  var out = [];
  for (var i = 0; i < band.length; i++) {
    var r = band[i];                  // [B,  C,   D,  E,  F,   G,   H]
    var home = String(r[1] || '').trim(); // C
    var away = String(r[5] || '').trim(); // G
    if (!home && !away) continue;
    if (isBye(home) || isBye(away)) continue;

    out.push({
      home: home,
      away: away,
      scheduled: String(r[3] || '').trim(), // E (scheduled time)
      rowIndex: i, // Keep track of row index for store lookups
      // handy to keep around (not shown in table yet)
      homeScore: (r[2] === '' || r[2] == null) ? null : r[2], // D
      awayScore: (r[6] === '' || r[6] == null) ? null : r[6]  // H
    });
  }
  return out;
}

/**
 * Collect make-up (unplayed) matches across all divisions.
 *
 * Layout (per block):
 *   A27  = week label
 *   A28  = map
 *   A29  = default date
 *   B28:H37 (10 rows) = weekly grid
 *     B = W/L (home)   C = Team Home    D = Score Home
 *     F = W/L (away)   G = Team Away    H = Score Away
 *
 * A match is "played" if EITHER:
 *   - Both scores (D & H) are numeric, OR
 *   - Both W/L cells (B & F) contain a token like W/L/T/FF/FORFEIT.
 * Everything else is considered an unplayed make-up.
 *
 * Only blocks whose default date is in the PAST (ET) are scanned into results.
 * BYE rows are ignored.
 *
 * @param {Object=} week optional; not required (date/map not used here)
 * @return {Array<Object>} [{ division, mapRef, home, away, date, dateIso, weekLabel }]
 */
function getMakeupMatchesAllDivs(week) {
  var tz = 'America/New_York';

  // Grid constants for your sheet
  var G = (typeof gridMeta === 'function') ? gridMeta() : {
    firstLabelRow: 27,   // A27, A38, A49, ...
    firstMapRow: 28,   // A28, A39, A50, ...
    firstDateRow: 29,   // A29, A40, A51, ...
    stride: 11,
    matchesPerBlock: 10
  };

  // Midnight "today" in ET — blocks < today are eligible as make-ups
  var todayEt = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00-04:00');

  var divisions = (typeof getDivisionSheets === 'function')
    ? getDivisionSheets()
    : ['Bronze', 'Silver', 'Gold'];

  var out = [];

  for (var d = 0; d < divisions.length; d++) {
    var division = divisions[d];
    var sh = (typeof getSheetByName === 'function') ? getSheetByName(division) : null;
    if (!sh) continue;

    var maxRows = sh.getMaxRows();

    // Scan all potential blocks in this division
    for (var bi = 0; bi < 200; bi++) {
      var labelRow = G.firstLabelRow + bi * G.stride;
      var mapRow = G.firstMapRow + bi * G.stride;
      var dateRow = G.firstDateRow + bi * G.stride;
      if (dateRow > maxRows) break;

      var label = String(sh.getRange(labelRow, 1).getDisplayValue() || '').trim();
      var mapRef = String(sh.getRange(mapRow, 1).getDisplayValue() || '').trim();
      var dateTx = String(sh.getRange(dateRow, 1).getDisplayValue() || '').trim();

      // Skip completely empty headers
      if (!label && !mapRef && !dateTx) continue;

      var dft = parseSheetDateET(dateTx);
      if (!dft) continue;

      // Only include blocks strictly before today (ET)
      if (!(dft.getTime() < todayEt.getTime())) continue;

      // Pull the weekly grid band: rows (headerTop+1) .. (headerTop+10), columns B..H (7 cols)
      var top = blockTopForIndex(bi);                 // A27/A38/...
      var firstGridRow = top + 1;                   // grid starts one row below header
      var band = sh.getRange(firstGridRow, 2, G.matchesPerBlock, 7).getDisplayValues(); // B..H

      for (var r = 0; r < band.length; r++) {
        var row = band[r];
        // [B,  C,   D,  E,  F,   G,   H]
        // [wl1,home,sc1, -, wl2, away, sc2]
        var wl1 = row[0];
        var home = String(row[1] || '').trim();
        var sc1 = row[2];
        var wl2 = row[4];
        var away = String(row[5] || '').trim();
        var sc2 = row[6];

        if (!home && !away) continue;
        if (isBye(home) || isBye(away)) continue;

        // Check if match is finished by score or W/L/T markers
        var isNum = function(s) { s = String(s || '').trim(); return s !== '' && !isNaN(Number(s)); };
        var isWLMarker = function(s) { return /^(W|L|T|FF|FORFEIT)$/i.test(String(s || '').trim()); };
        var finishedByScore = isNum(sc1) && isNum(sc2);
        var finishedByWLT = isWLMarker(wl1) && isWLMarker(wl2);
        var played = finishedByScore || finishedByWLT;

        if (!played) {
          out.push({
            division: division,
            mapRef: mapRef || '',
            home: home,
            away: away,
            date: dft,
            dateIso: Utilities.formatDate(dft, tz, 'yyyy-MM-dd'),
            weekLabel: label || ''
          });
        }
      }
    }
  }

  return out;
}

// ----- Back-processing endpoint for matches without map keys -----

/**
 * Helper: Find a match across all week blocks in a division by team names only.
 * Returns { weekKey, blockTop, row, map, date } or null if not found.
 * @param {string} division - Division name (Bronze/Silver/Gold)
 * @param {string} homeTeam - Home team name
 * @param {string} awayTeam - Away team name
 * @returns {Object|null} {weekKey, blockTop, row, map, date} or null if not found
 */
function findMatchAcrossAllWeeks(division, homeTeam, awayTeam) {
  try {
    var sheet = (typeof getSheetByName === 'function') ? getSheetByName(division) : null;
    if (!sheet) return null;

    var G = (typeof gridMeta === 'function') ? gridMeta() : {
      firstMapRow: 28,
      firstDateRow: 29,
      stride: 11,
      matchesPerBlock: 10
    };

    // Normalize team names for comparison
    var homeNorm = (typeof normalizeTeamText === 'function')
      ? normalizeTeamText(homeTeam)
      : String(homeTeam || '').toLowerCase().trim();
    var awayNorm = (typeof normalizeTeamText === 'function')
      ? normalizeTeamText(awayTeam)
      : String(awayTeam || '').toLowerCase().trim();

    // Scan all week blocks (up to 20 weeks)
    for (var blockIdx = 0; blockIdx < 20; blockIdx++) {
      var mapRow = G.firstMapRow + blockIdx * G.stride;
      var dateRow = G.firstDateRow + blockIdx * G.stride;
      var blockTop = mapRow - 1;

      if (mapRow > sheet.getLastRow()) break;

      // Read map and date for this block
      var mapRef = sheet.getRange(mapRow, 1).getDisplayValue().trim();
      var dateTx = sheet.getRange(dateRow, 1).getDisplayValue().trim();

      if (!mapRef || !dateTx) continue; // No more weeks

      // Parse date to create weekKey
      var date = (typeof parseSheetDateET === 'function')
        ? parseSheetDateET(dateTx)
        : new Date(dateTx);
      if (!date) continue;

      var weekKey = Utilities.formatDate(date, 'America/New_York', 'yyyy-MM-dd') + '|' + mapRef.toLowerCase();

      // Check each match row in this block
      var matchStartRow = mapRow + 1; // First match row after map/date
      for (var i = 0; i < G.matchesPerBlock; i++) {
        var rowNum = matchStartRow + i;
        if (rowNum > sheet.getLastRow()) break;

        var cols = (typeof getGridCols === 'function') ? getGridCols() : { T1: 3, T2: 7 };
        var t1 = sheet.getRange(rowNum, cols.T1).getDisplayValue().trim();
        var t2 = sheet.getRange(rowNum, cols.T2).getDisplayValue().trim();

        if (!t1 || !t2) continue;

        var t1Norm = (typeof normalizeTeamText === 'function')
          ? normalizeTeamText(t1)
          : t1.toLowerCase().trim();
        var t2Norm = (typeof normalizeTeamText === 'function')
          ? normalizeTeamText(t2)
          : t2.toLowerCase().trim();

        // Check if teams match
        if (t1Norm === homeNorm && t2Norm === awayNorm) {
          return {
            weekKey: weekKey,
            blockTop: blockTop,
            row: i, // 0-based row index within block
            map: mapRef,
            date: date
          };
        }
      }
    }

    return null; // Not found
  } catch (e) {
    throw new Error('Error searching for match: ' + (e.message || String(e)));
  }
}