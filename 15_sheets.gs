// =======================
// sheets.gs – Functions for reading and parsing the Google Sheets data
// =======================

// Where things live:
function _gridMeta_() {
  return {
    firstLabelRow: 27,   // A27, A38, A49, ...
    firstMapRow:   28,   // A28, A39, A50, ...
    firstDateRow:  29,   // A29, A40, A51, ...
    stride:        11,
    matchesPerBlock: 10  // rows 28..37
  };
}

/** Returns the "General" sheet (change name here if yours differs). */
function getGeneralSheet_() {
  if (typeof getSheetByName_ === 'function') return getSheetByName_('General');
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName('General');
}

/** Load all canonical maps from General!J2:J (non-blank). */
function getAllMapsList_() {
  var sh = getGeneralSheet_();
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

function _parseSheetDateET_(s) {
  s = String(s || '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (!m) { var d0 = new Date(s); return isNaN(d0.getTime()) ? null : d0; }
  var mm=+m[1], dd=+m[2], yy=m[3]?+m[3]:null; if (yy && yy<100) yy += 2000;
  var y = yy || (new Date()).getFullYear();
  var iso = Utilities.formatString('%04d-%02d-%02d', y, mm, dd);
  var d = new Date(iso + 'T00:00:00-04:00'); return isNaN(d.getTime()) ? null : d;
}

function _formatWeekRangeET_(d) {
  var tz='America/New_York', t=new Date(d.getTime());
  var dow = (+Utilities.formatDate(t, tz, 'u')); // 1..7 (Mon..Sun)
  var start = new Date(t.getTime()); start.setDate(start.getDate() - (dow - 1));
  var end = new Date(start.getTime()); end.setDate(start.getDate() + 6);
  var left = Utilities.formatDate(start, tz, 'MMM d'), right = Utilities.formatDate(end, tz, 'MMM d');
  var lm = Utilities.formatDate(start, tz, 'MMM'), rm = Utilities.formatDate(end, tz, 'MMM');
  return (lm===rm) ? (left+'–'+Utilities.formatDate(end,tz,'MMM d')) : (left+'–'+right);
}

function _findActiveIndexByDate_(sheet) {
  var G=_gridMeta_(), tz='America/New_York';
  var todayEt = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00-04:00');
  var i=0, lastGood=-1;
  while (i<200) {
    var dateRow = G.firstDateRow + i*G.stride;
    if (dateRow > sheet.getMaxRows()) break;
    var s = sheet.getRange(dateRow,1).getDisplayValue().trim();
    if (!s) { i++; continue; }
    var d = _parseSheetDateET_(s);
    if (d) { lastGood=i; if (d.getTime() >= todayEt.getTime()) return i; }
    i++;
  }
  return (lastGood>=0 ? lastGood : 0);
}

// Top is the header row (A27, A38, A49, ...)
function _blockTopForIndex_(idx) {
  var G = _gridMeta_();
  return G.firstLabelRow + (idx|0) * G.stride;  // 27 + k*11
}

function weekKey_(week) {
  var tz='America/New_York';
  var d = (week && week.date instanceof Date) ? week.date : (week && week.date ? new Date(week.date) : null);
  var iso = d && !isNaN(d.getTime()) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
  var map = String(week && week.mapRef || '').trim();
  return iso + '|' + map;
}

/** Build the canonical team map (team name uppercase → canonical name). */
function getCanonicalTeamMap_() {
  const cached = cacheGetJson_('WM_TEAM_CANON');
  if (cached) return cached;
  const map = {};
  for (const div of DIVISIONS) {
    const sh = getSheetByName_(div);
    if (!sh) continue;
    const vals = sh.getRange(TEAM_CANON_RANGE).getValues().flat();
    for (const v of vals) {
      const name = String(v || '').trim();
      if (!name) continue;
      map[name.toUpperCase()] = name.toUpperCase();
    }
  }
  cachePutJson_('WM_TEAM_CANON', map, LOOKUP_CACHE_TTL_SEC);
  return map;
}

/** Get all weekly blocks for a division sheet (array of block meta objects). */
function getAllBlocks_(sh) {
  const blocks = [];
  let row = GRID.startRow;
  while (true) {
    const mapCell  = sh.getRange(row, COL_MAP).getValue();
    const dateCell = sh.getRange(row + 1, COL_MAP).getValue();
    if (!mapCell || !dateCell) break;
    const map      = String(mapCell).trim();
    const weekDate = new Date(dateCell);
    const headerWeekName = sh.getRange(row - 1, COL_MAP).getValue();
    blocks.push({
      top: row,
      map: map,
      mapLower: normalizeMap_(map),
      weekDate: weekDate,
      weekName: headerWeekName
    });
    row += GRID.blockHeight;
  }
  return blocks;
}

/**
 * Locate the block "top" row for a division in the grid.
 * Priority:
 *   1) Honor week.blocks[division].top (if provided)
 *   2) Best scan match on this division sheet:
 *      - map + date match (score 3)
 *      - map-only match   (score 2)
 *      - date-only match  (score 1)
 *   3) Fallback to _findActiveIndexByDate_(sheet)
 *
 * Returns: integer top row (>=1) or 0 if not found.
 */
// Honor the hint first; otherwise find by map/date; otherwise fall back to active index.
function resolveDivisionBlockTop_(division, week) {
  // 0) honor hint
  try {
    var hinted = week && week.blocks && week.blocks[division] && week.blocks[division].top;
    if (hinted && hinted > 0) return hinted|0;
  } catch (_) {}

  // 1) scan this division for best match (map+date → map-only → date-only)
  var sh = getSheetByName_(division);
  if (!sh) return 0;
  var G = _gridMeta_();
  function norm(s){ return String(s||'').trim().toLowerCase(); }
  function toIso(d){ return Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'); }
  function parseDate(s){ return _parseSheetDateET_ ? _parseSheetDateET_(s) : new Date(s); }

  var tgtMap = norm(week && week.mapRef);
  var tgtDate = (week && week.date) ? (week.date instanceof Date ? week.date : new Date(week.date)) : null;
  var tgtIso = (tgtDate && !isNaN(tgtDate.getTime())) ? toIso(tgtDate) : '';

  var bestIdx = -1, bestScore = -1, bestTie = 9e15;
  for (var i=0; i<200; i++) {
    var mapRow  = G.firstMapRow  + i*G.stride;
    var dateRow = G.firstDateRow + i*G.stride;
    if (mapRow > sh.getMaxRows()) break;

    var map  = norm(sh.getRange(mapRow, 1).getDisplayValue());
    var dTxt = sh.getRange(dateRow,1).getDisplayValue();
    var d    = parseDate(dTxt);
    var iso  = (d && !isNaN(d.getTime())) ? toIso(d) : '';

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
  if (bestIdx >= 0) return _blockTopForIndex_(bestIdx);

  // 2) fallback to active-by-date
  if (typeof _findActiveIndexByDate_ === 'function') {
    var idx = _findActiveIndexByDate_(sh);
    return _blockTopForIndex_(idx);
  }
  return 0;
}

/** Determine the block index (0-based) for the block starting at `topRow` in `sheet`. */
function blockIndexForTop_(sheet, topRow) {
  const blocks = getAllBlocks_(sheet) || [];
  if (!blocks.length) return 0;
  let idx = 0;
  for (let i = 0; i < blocks.length; i++) {
    const t = blocks[i].top;
    const nextTop = (blocks[i + 1] && blocks[i + 1].top) || Infinity;
    if (topRow >= t && topRow < nextTop) {
      idx = i;
      break;
    }
    if (topRow >= t) idx = i;
  }
  return idx;
}

/** Safe read of column A at a given row (returns trimmed display value or ''). */
function _readA_(sheet, row) {
  try {
    return String(sheet.getRange('A' + row).getDisplayValue() || '').trim();
  } catch (e) {
    return '';
  }
}

/** Extract the map and date for the block at `topRow` of `sheet`. */
function getWeekMetaAt_(sheet, topRow) {
  if (!sheet || !topRow) {
    return { idx: 0, dateISO: '', rawDate: '', map: '', date: null, seasonWeek: '' };
  }
  const idx    = blockIndexForTop_(sheet, topRow);
  const mapRow = GRID.startRow + GRID.blockHeight * idx;
  const dateRow = mapRow + 1;
  const labelRow = mapRow - 1;
  const mapTxt  = _readA_(sheet, mapRow) || _readA_(sheet, mapRow + 1) || _readA_(sheet, mapRow - 1);
  const dateTxt = _readA_(sheet, dateRow) || _readA_(sheet, dateRow + 1) || _readA_(sheet, dateRow - 1);
  const lblTxt  = _readA_(sheet, labelRow) || _readA_(sheet, labelRow + 1) || _readA_(sheet, labelRow - 1);
  const tz    = getTz_();
  const refYr = Number(Utilities.formatDate(new Date(), tz, 'yyyy'));
  const dObj  = parseDateFromText_(dateTxt, refYr);
  const iso   = dObj ? Utilities.formatDate(dObj, tz, 'yyyy-MM-dd') : '';
  return {
    idx: idx,
    dateISO: iso,
    rawDate: dateTxt,
    map: (mapTxt || '').trim(),
    date: dObj,
    seasonWeek: (lblTxt || '').trim()
  };
}

function getAlignedUpcomingWeekOrReport_() {
  var G=_gridMeta_(); var gold = getSheetByName_('Gold');
  if (!gold) throw new Error('Sheet "Bronze" not found');
  var idx = _findActiveIndexByDate_(gold);

  var mapRef = gold.getRange(G.firstMapRow   + idx*G.stride, 1).getDisplayValue().trim();
  var dateTx = gold.getRange(G.firstDateRow  + idx*G.stride, 1).getDisplayValue().trim();
  var label  = gold.getRange(G.firstLabelRow + idx*G.stride, 1).getDisplayValue().trim();
  var date   = _parseSheetDateET_(dateTx);
  if (!date) throw new Error('Could not parse default date at A' + (G.firstDateRow + idx*G.stride) + ' on Gold');

  var divs = (typeof getDivisionSheets_==='function') ? getDivisionSheets_() : ['Bronze','Silver','Gold'];
  var blocks = {}; for (var i=0;i<divs.length;i++) blocks[divs[i]] = { top: _blockTopForIndex_(idx) };

  var week = {
    date: date,
    mapRef: mapRef || '',
    seasonWeekTitle: label || '',
    range: _formatWeekRangeET_(date),
    blocks: blocks
  };
  week.weekKey = weekKey_(week);
  return week;
}

// Pull meta for a division from its block header row (top = header row: A27/A38/A49…)
function deriveWeekMetaFromDivisionTop_(division, top) {
  var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(division) : null;
  if (!sh || !top) return null;
  var tz = 'America/New_York';

  var label  = String(sh.getRange(top + 0, 1).getDisplayValue() || '').trim(); // A(top)
  var mapRef = String(sh.getRange(top + 1, 1).getDisplayValue() || '').trim(); // A(top+1)
  var dateTx = String(sh.getRange(top + 2, 1).getDisplayValue() || '').trim(); // A(top+2)

  var date = (typeof _parseSheetDateET_ === 'function') ? _parseSheetDateET_(dateTx) : new Date(dateTx);
  if (date && isNaN(date.getTime())) date = null;

  var range = date ? _formatWeekRangeET_(date) : '';
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
 */
function syncHeaderMetaToTables_(week, canonicalDivision) {
  week = week || {};
  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze','Silver','Gold'];
  var canon = canonicalDivision || divs[0] || 'Bronze';

  var top = (typeof resolveDivisionBlockTop_ === 'function') ? resolveDivisionBlockTop_(canon, week) : 0;
  if (!top) return week; // nothing to do

  var meta = deriveWeekMetaFromDivisionTop_(canon, top);
  if (!meta) return week;

  week.seasonWeekTitle = meta.label || week.seasonWeekTitle || '';
  week.mapRef          = meta.mapRef || week.mapRef || '';
  week.date            = meta.date   || week.date || null;
  week.range           = meta.range  || week.range || '';
  if (typeof meta.epochSec === 'number') week.epochSec = meta.epochSec;

  // unify all division tops to this block
  if (!week.blocks) week.blocks = {};
  for (var i = 0; i < divs.length; i++) week.blocks[divs[i]] = { top: top };

  // refresh weekKey now that meta is in sync
  if (typeof weekKey_ === 'function') week.weekKey = weekKey_(week);
  return week;
}
/**
 * Returns current-week matches for a division.
 * top = header row (A27/A38/…); grid is rows (top+1 .. top+10), cols B..H.
 * Uses C/G for names; skips BYE/blank rows.
 */
function getMatchesForDivisionWeek_(division, top) {
  var sh = (typeof getDivisionSheet_ === 'function') ? getDivisionSheet_(division)
         : (typeof getSheetByName_  === 'function') ? getSheetByName_(division)
         : null;
  if (!sh || !top) return [];

  var firstGridRow = top + 1;         // <-- IMPORTANT: start one row below header
  var rows = 10;                      // matches per block
  var band = sh.getRange(firstGridRow, 2, rows, 7).getDisplayValues(); // B..H

  function isBye(s){ return /^\s*BYE\s*$/i.test(String(s||'')); }

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
function getMakeupMatchesAllDivs_(week) {
  var tz = 'America/New_York';

  // Grid constants for your sheet
  var G = (typeof _gridMeta_ === 'function') ? _gridMeta_() : {
    firstLabelRow: 27,   // A27, A38, A49, ...
    firstMapRow:   28,   // A28, A39, A50, ...
    firstDateRow:  29,   // A29, A40, A51, ...
    stride:        11,
    matchesPerBlock: 10
  };

  // Midnight "today" in ET — blocks < today are eligible as make-ups
  var todayEt = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00-04:00');

  var divisions = (typeof getDivisionSheets_ === 'function')
    ? getDivisionSheets_()
    : ['Bronze', 'Silver', 'Gold'];

  var out = [];

  function isBye(s) {
    return /^\s*BYE\s*$/i.test(String(s || ''));
  }
  function isNumCell(s) {
    return /^\s*\d+\s*$/.test(String(s || ''));
  }
  function isWLT(s) {
    var t = String(s || '').trim().toUpperCase();
    return /^(W|L|T|FF|F|FORFEIT)$/.test(t);
  }
  function parseEtDate(s) {
    if (typeof _parseSheetDateET_ === 'function') return _parseSheetDateET_(s);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function blockHeaderTop(i) {
    // Header row for block index i → A27 + i*11
    return G.firstLabelRow + (i | 0) * G.stride;
  }

  for (var d = 0; d < divisions.length; d++) {
    var division = divisions[d];
    var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(division) : null;
    if (!sh) continue;

    var maxRows = sh.getMaxRows();

    // Scan all potential blocks in this division
    for (var bi = 0; bi < 200; bi++) {
      var labelRow = G.firstLabelRow + bi * G.stride;
      var mapRow   = G.firstMapRow   + bi * G.stride;
      var dateRow  = G.firstDateRow  + bi * G.stride;
      if (dateRow > maxRows) break;

      var label  = String(sh.getRange(labelRow, 1).getDisplayValue() || '').trim();
      var mapRef = String(sh.getRange(mapRow,  1).getDisplayValue() || '').trim();
      var dateTx = String(sh.getRange(dateRow, 1).getDisplayValue() || '').trim();

      // Skip completely empty headers
      if (!label && !mapRef && !dateTx) continue;

      var dft = parseEtDate(dateTx);
      if (!dft) continue;

      // Only include blocks strictly before today (ET)
      if (!(dft.getTime() < todayEt.getTime())) continue;

      // Pull the weekly grid band: rows (headerTop+1) .. (headerTop+10), columns B..H (7 cols)
      var top = blockHeaderTop(bi);                 // A27/A38/...
      var firstGridRow = top + 1;                   // grid starts one row below header
      var band = sh.getRange(firstGridRow, 2, G.matchesPerBlock, 7).getDisplayValues(); // B..H

      for (var r = 0; r < band.length; r++) {
        var row = band[r];
        // [B,  C,   D,  E,  F,   G,   H]
        // [wl1,home,sc1, -, wl2, away, sc2]
        var wl1  = row[0];
        var home = String(row[1] || '').trim();
        var sc1  = row[2];
        var wl2  = row[4];
        var away = String(row[5] || '').trim();
        var sc2  = row[6];

        if (!home && !away) continue;
        if (isBye(home) || isBye(away)) continue;

        var finishedByScore = isNumCell(sc1) && isNumCell(sc2);
        var finishedByWLT   = isWLT(wl1) && isWLT(wl2);
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