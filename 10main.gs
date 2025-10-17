// =======================
// store.gs – Per-week and global schedule storage
// =======================
/** Internal helper to form the script property key for weekly store. */
function _weekStoreKey_(wk) {
  return `WEEKLY_STORE_${wk}`;
}

/** Load the per-week store (schedules and shoutcasters) for week key `wk`. */
function loadWeekStore_(wk) {
  const sp = PropertiesService.getScriptProperties();
  const raw = sp.getProperty(_weekStoreKey_(wk));
  if (!raw) return { schedules: {}, shoutcasters: {} };
  try {
    const obj = JSON.parse(raw);
    if (!obj.schedules) obj.schedules = {};
    if (!obj.shoutcasters) obj.shoutcasters = {};
    return obj;
  } catch (e) {
    return { schedules: {}, shoutcasters: {} };
  }
}

/** Save the per-week store object for week key `wk`. */
function saveWeekStore_(wk, obj) {
  PropertiesService.getScriptProperties()
    .setProperty(_weekStoreKey_(wk), JSON.stringify(obj || { schedules: {}, shoutcasters: {} }));
}

/** Stable match key (ignores home/away order) for two teams in a division. */
function matchKey_(division, team1, team2) {
  const t1 = normalizeTeam_(team1);
  const t2 = normalizeTeam_(team2);
  const [a, b] = [t1, t2].sort();
  return `${division}|${a}|${b}`;
}

function _msgIdsKey_(wk) { return 'WEEKLY_MSG_IDS::' + String(wk || ''); }

/** Load IDs with full back-compat and normalize into a single shape. */
function _loadMsgIds_(wk) {
  var raw = PropertiesService.getScriptProperties().getProperty(_msgIdsKey_(wk));
  var obj = raw ? (function () { try { return JSON.parse(raw); } catch (_) { return null; } })() : null;
  if (!obj) obj = {};

  // Normalize expected fields
  var header = obj.header ? String(obj.header) : '';
  var table = obj.table ? String(obj.table) : '';
  var rematch = obj.rematch ? String(obj.rematch) : '';

  var tables = Array.isArray(obj.tables) ? obj.tables.map(String) : [];
  var rematches = Array.isArray(obj.rematches) ? obj.rematches.map(String) : [];

  // Back-compat: legacy 'cluster' = [header, ...tables]
  if ((!header || !tables.length) && Array.isArray(obj.cluster)) {
    var c = obj.cluster.map(String);
    if (!header && c.length) header = c[0] || header;
    if (!tables.length && c.length > 1) tables = c.slice(1);
  }
  // If single table present but no tables[], reflect it
  if (table && !tables.length) tables = [table];
  // If single rematch present but no rematches[], reflect it
  if (rematch && !rematches.length) rematches = [rematch];

  return {
    header: header,
    table: table,           // single weekly table (preferred new shape)
    tables: tables,          // legacy multi-page tables (kept for back-compat)
    rematch: rematch,        // single rematches post (preferred new shape)
    rematches: rematches     // legacy multi-post rematches (if any)
  };
}

/** Save IDs in both new and legacy-friendly shapes. */
function _saveMsgIds_(wk, ids) {
  var out = {
    header: String(ids.header || ''),
    table: String(ids.table || ''),
    rematch: String(ids.rematch || ''),
    tables: Array.isArray(ids.tables) ? ids.tables.map(String) : (ids.table ? [String(ids.table)] : []),
    rematches: Array.isArray(ids.rematches) ? ids.rematches.map(String) : (ids.rematch ? [String(ids.rematch)] : [])
  };
  // Legacy cluster: [header, ...tables]
  out.cluster = [out.header].concat(out.tables);
  PropertiesService.getScriptProperties().setProperty(_msgIdsKey_(wk), JSON.stringify(out));
  return out;
}

function _clearMsgIds_(wk) {
  PropertiesService.getScriptProperties().deleteProperty(_msgIdsKey_(wk));
}

function deleteWeeklyClusterByKey_(wk) {
  var ids = _loadMsgIds_(wk);
  var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
    (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
  if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

  if (ids.header) { try { deleteMessage_(channelId, ids.header); } catch (e) { } }
  if (ids.weekly) { try { deleteMessage_(channelId, ids.weekly); } catch (e) { } }
  if (ids.rematches) { try { deleteMessage_(channelId, ids.rematches); } catch (e) { } }

  _clearMsgIds_(wk);
  return true;
}

// =======================
// sheets.gs – Functions for reading and parsing the Google Sheets data
// =======================

// Where things live:
function _gridMeta_() {
  return {
    firstLabelRow: 27,   // A27, A38, A49, ...
    firstMapRow: 28,   // A28, A39, A50, ...
    firstDateRow: 29,   // A29, A40, A51, ...
    stride: 11,
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
  var mm = +m[1], dd = +m[2], yy = m[3] ? +m[3] : null; if (yy && yy < 100) yy += 2000;
  var y = yy || (new Date()).getFullYear();
  var iso = Utilities.formatString('%04d-%02d-%02d', y, mm, dd);
  var d = new Date(iso + 'T00:00:00-04:00'); return isNaN(d.getTime()) ? null : d;
}

function _formatWeekRangeET_(d) {
  var tz = 'America/New_York', t = new Date(d.getTime());
  var dow = (+Utilities.formatDate(t, tz, 'u')); // 1..7 (Mon..Sun)
  var start = new Date(t.getTime()); start.setDate(start.getDate() - (dow - 1));
  var end = new Date(start.getTime()); end.setDate(start.getDate() + 6);
  var left = Utilities.formatDate(start, tz, 'MMM d'), right = Utilities.formatDate(end, tz, 'MMM d');
  var lm = Utilities.formatDate(start, tz, 'MMM'), rm = Utilities.formatDate(end, tz, 'MMM');
  return (lm === rm) ? (left + '–' + Utilities.formatDate(end, tz, 'MMM d')) : (left + '–' + right);
}

function _findActiveIndexByDate_(sheet) {
  var G = _gridMeta_(), tz = 'America/New_York';
  var todayEt = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00-04:00');
  var i = 0, lastGood = -1;
  while (i < 200) {
    var dateRow = G.firstDateRow + i * G.stride;
    if (dateRow > sheet.getMaxRows()) break;
    var s = sheet.getRange(dateRow, 1).getDisplayValue().trim();
    if (!s) { i++; continue; }
    var d = _parseSheetDateET_(s);
    if (d) { lastGood = i; if (d.getTime() >= todayEt.getTime()) return i; }
    i++;
  }
  return (lastGood >= 0 ? lastGood : 0);
}

// Top is the header row (A27, A38, A49, ...)
function _blockTopForIndex_(idx) {
  var G = _gridMeta_();
  return G.firstLabelRow + (idx | 0) * G.stride;  // 27 + k*11
}

function weekKey_(week) {
  var tz = 'America/New_York';
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
    const mapCell = sh.getRange(row, COL_MAP).getValue();
    const dateCell = sh.getRange(row + 1, COL_MAP).getValue();
    if (!mapCell || !dateCell) break;
    const map = String(mapCell).trim();
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
    if (hinted && hinted > 0) return hinted | 0;
  } catch (_) { }

  // 1) scan this division for best match (map+date → map-only → date-only)
  var sh = getSheetByName_(division);
  if (!sh) return 0;
  var G = _gridMeta_();
  function norm(s) { return String(s || '').trim().toLowerCase(); }
  function toIso(d) { return Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'); }
  function parseDate(s) { return _parseSheetDateET_ ? _parseSheetDateET_(s) : new Date(s); }

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
  const idx = blockIndexForTop_(sheet, topRow);
  const mapRow = GRID.startRow + GRID.blockHeight * idx;
  const dateRow = mapRow + 1;
  const labelRow = mapRow - 1;
  const mapTxt = _readA_(sheet, mapRow) || _readA_(sheet, mapRow + 1) || _readA_(sheet, mapRow - 1);
  const dateTxt = _readA_(sheet, dateRow) || _readA_(sheet, dateRow + 1) || _readA_(sheet, dateRow - 1);
  const lblTxt = _readA_(sheet, labelRow) || _readA_(sheet, labelRow + 1) || _readA_(sheet, labelRow - 1);
  const tz = getTz_();
  const refYr = Number(Utilities.formatDate(new Date(), tz, 'yyyy'));
  const dObj = parseDateFromText_(dateTxt, refYr);
  const iso = dObj ? Utilities.formatDate(dObj, tz, 'yyyy-MM-dd') : '';
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
  var G = _gridMeta_(); var gold = getSheetByName_('Gold');
  if (!gold) throw new Error('Sheet "Bronze" not found');
  var idx = _findActiveIndexByDate_(gold);

  var mapRef = gold.getRange(G.firstMapRow + idx * G.stride, 1).getDisplayValue().trim();
  var dateTx = gold.getRange(G.firstDateRow + idx * G.stride, 1).getDisplayValue().trim();
  var label = gold.getRange(G.firstLabelRow + idx * G.stride, 1).getDisplayValue().trim();
  var date = _parseSheetDateET_(dateTx);
  if (!date) throw new Error('Could not parse default date at A' + (G.firstDateRow + idx * G.stride) + ' on Gold');

  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze', 'Silver', 'Gold'];
  var blocks = {}; for (var i = 0; i < divs.length; i++) blocks[divs[i]] = { top: _blockTopForIndex_(idx) };

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

  var label = String(sh.getRange(top + 0, 1).getDisplayValue() || '').trim(); // A(top)
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
  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze', 'Silver', 'Gold'];
  var canon = canonicalDivision || divs[0] || 'Bronze';

  var top = (typeof resolveDivisionBlockTop_ === 'function') ? resolveDivisionBlockTop_(canon, week) : 0;
  if (!top) return week; // nothing to do

  var meta = deriveWeekMetaFromDivisionTop_(canon, top);
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
    : (typeof getSheetByName_ === 'function') ? getSheetByName_(division)
      : null;
  if (!sh || !top) return [];

  var firstGridRow = top + 1;         // <-- IMPORTANT: start one row below header
  var rows = 10;                      // matches per block
  var band = sh.getRange(firstGridRow, 2, rows, 7).getDisplayValues(); // B..H

  function isBye(s) { return /^\s*BYE\s*$/i.test(String(s || '')); }

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
    firstMapRow: 28,   // A28, A39, A50, ...
    firstDateRow: 29,   // A29, A40, A51, ...
    stride: 11,
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
      var mapRow = G.firstMapRow + bi * G.stride;
      var dateRow = G.firstDateRow + bi * G.stride;
      if (dateRow > maxRows) break;

      var label = String(sh.getRange(labelRow, 1).getDisplayValue() || '').trim();
      var mapRef = String(sh.getRange(mapRow, 1).getDisplayValue() || '').trim();
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
        var wl1 = row[0];
        var home = String(row[1] || '').trim();
        var sc1 = row[2];
        var wl2 = row[4];
        var away = String(row[5] || '').trim();
        var sc2 = row[6];

        if (!home && !away) continue;
        if (isBye(home) || isBye(away)) continue;

        var finishedByScore = isNumCell(sc1) && isNumCell(sc2);
        var finishedByWLT = isWLT(wl1) && isWLT(wl2);
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

// =======================
// relay.gs – Discord relay HTTP calls and related helpers
// =======================

// ---------- RELAY HTTP CORE ----------

/* =========================
   Relay base / headers / fetch
   ========================= */
/** Script Property helper */
function _sp_(k, dflt) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v != null && v !== '') ? String(v) : (dflt == null ? '' : String(dflt));
}

/** Relay base URL (no trailing slash) */
function getRelayBase_() {
  var cands = [
    _sp_('RELAY_BASE'),
    _sp_('DISCORD_RELAY_BASE'),
    _sp_('WM_RELAY_BASE_URL'),
    (typeof RELAY_BASE !== 'undefined' ? RELAY_BASE : ''),
    (typeof DISCORD_RELAY_BASE !== 'undefined' ? DISCORD_RELAY_BASE : ''),
    (typeof WM_RELAY_BASE_URL !== 'undefined' ? WM_RELAY_BASE_URL : '')
  ];
  for (var i = 0; i < cands.length; i++) {
    var v = String(cands[i] || '').trim();
    if (v) { if (v.endsWith('/')) v = v.slice(0, -1); return v; }
  }
  throw new Error('Relay base URL missing (set RELAY_BASE).');
}

function getRelayPaths_() {
  var paths = {
    messages: _sp_('RELAY_PATH_MESSAGES', '/messages'),
    message: _sp_('RELAY_PATH_MESSAGE', '/message'),     // used as /message/:channelId/:messageId
    reply: _sp_('RELAY_PATH_REPLY', '/reply'),       // your server.js
    post: _sp_('RELAY_PATH_POST', '/reply'),       // synonym (old code may use "post")
    edit: _sp_('RELAY_PATH_EDIT', '/edit'),
    del: _sp_('RELAY_PATH_DELETE', '/delete'),      // used as /delete/:channelId/:messageId
    dm: _sp_('RELAY_PATH_DM', '/dm'),
    react: _sp_('RELAY_PATH_REACT', '/react'),
    health: _sp_('RELAY_PATH_HEALTH', '/health'),
    whoami: _sp_('RELAY_PATH_WHOAMI', '/whoami')
  };
  return paths;
}

/** Build headers for talking to the relay (adds shared secret in common formats). */
function getRelayHeaders_() {
  var secret =
    _sp_('RELAY_AUTH') ||
    _sp_('WM_RELAY_SHARED_SECRET') ||
    (typeof RELAY_AUTH !== 'undefined' ? RELAY_AUTH : '') ||
    (typeof WM_RELAY_SHARED_SECRET !== 'undefined' ? WM_RELAY_SHARED_SECRET : '');
  var h = { 'Content-Type': 'application/json' };
  if (secret) h['X-Relay-Auth'] = String(secret);  // your server.js expects this
  return h;
}

/** Normalize a path/URL. Accepts absolute URLs or relative paths. */
function _normalizeRelayUrl_(path) {
  if (typeof path !== 'string' || !path) {
    throw new Error('relayFetch_: path is missing or not a string');
  }
  // If caller passed a full URL, use as-is
  if (/^https?:\/\//i.test(path)) return path;
  var base = getRelayBase_();
  return base + (path.charAt(0) === '/' ? path : ('/' + path));
}


/** Optional: central place to tune timeouts for relay calls. */
function getRelayTimeoutMs_() {
  // Default 20s; adjust if your Cloud Run/Functions are slower
  var sp = PropertiesService.getScriptProperties();
  var v = sp.getProperty('RELAY_TIMEOUT_MS');
  var n = v ? parseInt(v, 10) : 20000;
  return isNaN(n) ? 20000 : Math.max(5000, n);
}

/** Fetch wrapper */
function relayFetch_(path, opt) {
  opt = opt || {};
  var url = _normalizeRelayUrl_(path);

  var params = {
    method: (opt.method || 'get').toLowerCase(),
    headers: Object.assign({}, getRelayHeaders_(), (opt.headers || {})),
    muteHttpExceptions: true,
    timeout: (function () { var n = parseInt(_sp_('RELAY_TIMEOUT_MS', '20000'), 10); return isNaN(n) ? 20000 : Math.max(5000, n); })()
  };

  if (opt.method && /post|put|patch|delete/i.test(opt.method) && typeof opt.payload !== 'undefined') {
    params.payload = (typeof opt.payload === 'string') ? opt.payload : JSON.stringify(opt.payload);
    if (!params.headers['Content-Type']) params.headers['Content-Type'] = 'application/json';
  }

  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('relayFetch_ HTTP ' + code + ' for ' + url + ': ' + body);
  }
  try { return JSON.parse(body); } catch (_) { return body; }
}

/** Parse JSON text safely (returns null on failure). */
function tryParseJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------- RELAY API WRAPPERS ----------

function handleIncomingDiscordEvent_(payload) {
  var text = contentFromRelay_(payload);
  if (!text) return { ok: false, error: 'empty' };

  var parsed = parseScheduleMessage_v3(text); // your parser
  if (!parsed.ok) return parsed;

  // group by wkKey and update
  var groups = {};
  parsed.pairs.forEach(function (p) { (groups[p.weekKey] = groups[p.weekKey] || []).push(p); });
  for (var wk in groups) {
    updateTablesMessageFromPairs_(wk, groups[wk]);
  }
  return { ok: true };
}

function contentFromRelay_(payload) {
  if (payload == null) return '';

  // Fast path: already a string
  if (typeof payload === 'string') return _normalizeWhitespace_(payload);

  // Try common wrappers
  var msg = payload;
  if (msg.message && typeof msg.message === 'object') msg = msg.message;
  else if (msg.data && typeof msg.data === 'object') msg = msg.data;
  else if (msg.d && typeof msg.d === 'object') msg = msg.d; // gateway-style

  // 1) Direct content
  var parts = [];
  if (msg.content && typeof msg.content === 'string') {
    parts.push(msg.content);
  }

  // 2) Embeds (title/description/fields) if no or minimal content
  if ((!parts.length || _isJustPings_(parts.join(' '))) && Array.isArray(msg.embeds) && msg.embeds.length) {
    parts.push(_textFromEmbeds_(msg.embeds));
  }

  // 3) Referenced (reply) message content, if present
  var ref = msg.referenced_message || (msg.message && msg.message.referenced_message);
  if ((!parts.length || _isJustPings_(parts.join(' '))) && ref && typeof ref.content === 'string') {
    parts.push(ref.content);
  }

  // 4) Fallback to any “clean_content” style fields if your relay provides them
  if (!parts.length && typeof msg.clean_content === 'string') {
    parts.push(msg.clean_content);
  }

  // 5) If still nothing, try attachments names as a hint (rarely useful for scheduling)
  if (!parts.length && Array.isArray(msg.attachments) && msg.attachments.length) {
    var names = msg.attachments.map(function (a) { return a && a.filename ? a.filename : ''; })
      .filter(Boolean)
      .join(' ');
    if (names) parts.push(names);
  }

  // 6) Final normalize
  var text = _normalizeWhitespace_(parts.filter(Boolean).join('\n').trim());

  // Strip common noise that often slips through relays; keep it *light*
  text = text.replace(/<[@#][!&]?\d+>/g, ' ')      // <@123>, <@!123>, <#123>, <@&role>
    .replace(/<:[a-z0-9_]+:\d+>/gi, ' ')  // <:emoji:12345>
    .replace(/:[a-z0-9_]+:/gi, ' ');      // :emoji:

  return _normalizeWhitespace_(text);
}

/* ----------------------- helpers ----------------------- */
function _textFromEmbeds_(embeds) {
  var out = [];
  for (var i = 0; i < embeds.length; i++) {
    var e = embeds[i] || {};
    if (e.title) out.push(String(e.title));
    if (e.description) out.push(String(e.description));
    if (Array.isArray(e.fields)) {
      for (var j = 0; j < e.fields.length; j++) {
        var f = e.fields[j] || {};
        // Concatenate name + value, since some relays put content in fields
        var line = [f.name, f.value].filter(Boolean).join(': ');
        if (line) out.push(String(line));
      }
    }
    if (e.footer && e.footer.text) {
      // footers often include “edited” or timestamps; usually not useful → skip
    }
  }
  return out.filter(Boolean).join('\n').trim();
}

/* ----------------------- Fetch ----------------------- */

function _fetchSingleMessageInclusive_(channelId, messageId) {
  // 1) Try a dedicated single-message endpoint
  if (typeof fetchMessageById_ === 'function') {
    try {
      var m = fetchMessageById_(channelId, messageId);
      if (m && m.id) return m;
    } catch (e) { }
  }

  // 2) Try "around" if your relay supports it
  try {
    var aroundPage = fetchChannelMessages_(channelId, { around: String(messageId), limit: 1 }) || [];
    for (var i = 0; i < aroundPage.length; i++) {
      if (String(aroundPage[i].id) === String(messageId)) return aroundPage[i];
    }
  } catch (e) { }

  // 3) Last resort: fetch "after = (messageId - 1)" using string arithmetic
  try {
    var prev = _decStringMinusOne_(String(messageId));
    if (prev) {
      var maybe = fetchChannelMessages_(channelId, { after: prev, limit: 1 }) || [];
      for (var j = 0; j < maybe.length; j++) {
        if (String(maybe[j].id) === String(messageId)) return maybe[j];
      }
    }
  } catch (e) { }

  return null;
}

function fetchChannelMessages_(channelId, params) {
  params = params || {};
  var p = getRelayPaths_();
  var qs = 'channelId=' + encodeURIComponent(channelId);
  if (params.after) qs += '&after=' + encodeURIComponent(params.after);
  if (params.around) qs += '&around=' + encodeURIComponent(params.around);
  if (params.limit) qs += '&limit=' + encodeURIComponent(params.limit);
  return relayFetch_(p.messages + '?' + qs, { method: 'get' }) || [];
}

function fetchMessageById_(channelId, messageId) {
  var p = getRelayPaths_();
  var path = (p.message || '/message') + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  var obj = relayFetch_(path, { method: 'get' });
  return (obj && obj.id) ? obj : null;
}

/* ----------------------- Post ----------------------- */

/** POST text message */
function postChannelMessage_(channelId, content) {
  var p = getRelayPaths_();
  var path = p.reply || p.post || '/reply';
  var payload = { channelId: String(channelId), content: String(content || '') };
  var res = relayFetch_(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  if (!id) try { logLocal_('WARN', 'postChannelMessage_ no id', { res: res }); } catch (_) { }
  return id;
}

function postChannelMessageAdvanced_(channelId, content, embeds) {
  var p = getRelayPaths_();
  var path = p.reply || p.post || '/reply';
  var payload = { channelId: String(channelId), content: String(content || ''), embeds: embeds || [] };
  var res = relayFetch_(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  if (!id) try { logLocal_('WARN', 'postChannelMessageAdvanced_ no id', { res: res }); } catch (_) { }
  return id;
}

/* ----------------------- Edit ----------------------- */
function editChannelMessage_(channelId, messageId, newContent) {
  var p = getRelayPaths_();
  var path = p.edit || '/edit';
  var payload = { channelId: String(channelId), messageId: String(messageId), content: String(newContent || '') };
  var res = relayFetch_(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  return id || String(messageId);
}

function editChannelMessageAdvanced_(channelId, messageId, content, embeds) {
  var p = getRelayPaths_();
  var path = p.edit || '/edit';
  var payload = { channelId: String(channelId), messageId: String(messageId), content: String(content || ''), embeds: embeds || [] };
  var res = relayFetch_(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  return id || String(messageId);
}

/* ----------------------- Delete ----------------------- */
function deleteMessage_(channelId, messageId) {
  var p = getRelayPaths_();
  var base = p.del || '/delete';
  var path = base + '/' + encodeURIComponent(channelId) + '/' + encodeURIComponent(messageId);
  var res = relayFetch_(path, { method: 'delete' }) || {};
  return !(res && res.ok === false);
}

function postReaction_(channelId, messageId, emoji) {
  var p = getRelayPaths_();
  var path = p.react || '/react';
  var payload = { channelId: String(channelId), messageId: String(messageId), emoji: String(emoji) };
  var res = relayFetch_(path, { method: 'post', payload: payload }) || {};
  return (res && res.ok === false) ? false : true;
}

function postDM_(userId, content) {
  var p = getRelayPaths_();
  var path = p.dm || '/dm';
  var payload = { userId: String(userId), content: String(content || '') };
  var res = relayFetch_(path, { method: 'post', payload: payload }) || {};
  var id = (res && res.id) ? String(res.id) : (res && res.data && res.data.id ? String(res.data.id) : '');
  if (!id) try { logLocal_('WARN', 'postDM_ no id', { res: res }); } catch (_) { }
  return id || '';
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
  const link = msgId ? buildDiscordMessageLink_(RESULTS_LOG_CHANNEL_ID, msgId) : '';
  const linkBit = link ? ` [jump](${link})` : '';
  const rowBit = row ? `Row ${row}` : 'Unmapped';
  const status = parsed.status || 'Scheduled';
  const emoji = status === 'Confirming' ? EMOJI_EDIT : EMOJI_OK;

  return `${emoji} **${parsed.division}** • \`${mapShown}\` • ${rowBit} — **${left} vs ${right}** (${status})${by}${linkBit}`;
}

function logParsingSummary_(successCount, tentativeCount, sourceChannel) {
  const emoji = EMOJI_OK; // or something custom
  const total = successCount + tentativeCount;
  const msg = `${emoji} Parsed ${total} matches (${successCount} scheduled, ${tentativeCount} tentative)` +
    (sourceChannel ? ` — from #${sourceChannel}` : '');
  sendLog_(msg); // To WM_Log
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
  sendLog_(message); // to WM_Log
}


// =======================
// board.gs – Weekly board rendering and posting
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
  var wkKey = (typeof weekKey_ === 'function') ? weekKey_(week) : String(week.weekKey || '');
  if (!wkKey) {
    var dIso = Utilities.formatDate(week.date, 'America/New_York', 'yyyy-MM-dd');
    var mRef = String(week.mapRef || '').trim();
    wkKey = dIso + '|' + mRef;
  }

  var channelId = PropertiesService.getScriptProperties().getProperty('WEEKLY_POST_CHANNEL_ID') ||
    (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' ? WEEKLY_POST_CHANNEL_ID : '');
  if (!channelId) throw new Error('WEEKLY_POST_CHANNEL_ID missing');

  var store = (typeof loadWeekStore_ === 'function') ? loadWeekStore_(wkKey) : null;
  var header = (typeof renderHeaderEmbedPayload_ === 'function') ? renderHeaderEmbedPayload_(week) : { embeds: [] };

  // ======== build Weekly Tables body (prefer your working functions) ========
  var weeklyBody = '';
  if (typeof renderWeeklyTablesBody_ === 'function') {
    // your preferred “worked last” implementation
    var body = renderWeeklyTablesBody_(week, store);
    weeklyBody = body ? _ensureFence_((body)) : '';
  } else if (typeof renderTablesPages_ === 'function') {
    // fallback: join pages into ONE message
    var pages = renderTablesPages_(week, store) || [];
    var joined = (Array.isArray(pages) ? pages : [String(pages || '')]).filter(Boolean).join('\n\n');
    weeklyBody = joined ? _ensureFence_(joined) : '';
  } else {
    // last-resort: try existing split renderer (if present)
    if (typeof renderCurrentWeekTablesSplit_ === 'function') {
      var split = renderCurrentWeekTablesSplit_(week) || [];
      weeklyBody = split.length ? _ensureFence_(split.filter(Boolean).join('\n\n')) : '';
    }
  }

  // ======== build Rematches (raw; chunk later) ========
  var remBody = '';
  if (typeof renderRematchesTableBody_ === 'function') {
    remBody = String(renderRematchesTableBody_(week) || '');
    remBody = _stripFence_(remBody.trim());
  }

  var ids = _loadMsgIds_(wkKey);  // expects {header, table, rematch, tables[], rematches[]}

  // Hashes
  var headerHash = _safeHeaderHash_(header);
  var weeklyHash = weeklyBody ? ((typeof sha256Hex_ === 'function') ? sha256Hex_(weeklyBody) : weeklyBody.length) : '';
  // var remHashSig = remBody ? ('REM\n' + remBody) : '';
  var remHash = remBody ? ((typeof sha256Hex_ === 'function') ? sha256Hex_(remBody) : remBody.length) : '';

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
  _saveMsgIds_(wkKey, ids);
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
  var notice = formatWeeklyNotice_(week, actionWord);
  try { sendLog_(notice); } catch (_) { }

  try {
    logLocal_('INFO', 'weekly.board.notice', {
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
  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze', 'Silver', 'Gold'];
  var order = ['Bronze', 'Silver', 'Gold'].filter(function (d) { return divs.indexOf(d) !== -1; });
  var parts = [];
  for (var i = 0; i < order.length; i++) {
    var tbl = renderDivisionCurrentTable_(order[i], week, store);
    if (tbl) parts.push(tbl);
  }
  return parts;
}

function renderDivisionCurrentTable_(division, week, store, mapName) {
  var W = _getTableWidths_();
  var header = _formatVsHeader_(W.COL1) + ' | ' + _padR_('Scheduled', W.COL2) + ' | ' + _padR_('Shoutcaster', W.COL3);
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

    var vsCell = _formatVsCell_(home, away, W.COL1);
    var row = vsCell + ' | ' + _padR_(sched, W.COL2) + ' | ' + _padR_(cast, W.COL3);
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
  var tz = week.tz || getTz_();
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
  var seasonInfo = getSeasonInfo_();
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

  var divs = (typeof getDivisionSheets_ === 'function')
    ? getDivisionSheets_()
    : ['Bronze', 'Silver', 'Gold'];

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
  var sh = getSheetByName_(division);
  if (!sh) return '';

  var G = _gridMeta_();
  var top = resolveDivisionBlockTop_(division, week);
  if (!top) return '';

  // Grid band for this block
  var firstMatchRow = top + 1;           // header at top, data starts at next row
  var numRows = G.matchesPerBlock; // 10
  var numCols = 8;                 // A..H

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
  var sep = _repeat_('-', header.length);

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
  var body = [header, sep].concat(rows).join('\n');
  return title + '```text\n' + division + '\n' + body + '\n```';
}

/**
 * Join Bronze, Silver, Gold pretty tables into ONE body (plain content).
 * Expects renderDivisionWeekTablePretty_(division, matches, label) to return a fenced block.
 */
function renderWeeklyTablesBody_(week) {
  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze', 'Silver', 'Gold'];
  var chunks = [];

  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var top = (typeof resolveDivisionBlockTop_ === 'function') ? resolveDivisionBlockTop_(div, week) : 0;
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
  if (typeof _getTableWidths_ !== 'function' || typeof _padC_ !== 'function') return '';
  var W = _getTableWidths_();

  // Header line (exactly like weekly)
  var hdr = (typeof _formatVsHeader_ === 'function')
    ? _formatVsHeader_(W.COL1)
    : _padC_('Home  vs  Away', W.COL1);
  hdr = hdr + ' | ' + _padC_('Scheduled', W.COL2) + ' | ' + _padC_('Shoutcaster', W.COL3);

  var fullLen = hdr.length;
  var sep = (typeof _repeat_ === 'function') ? _repeat_('-', fullLen) : new Array(fullLen + 1).join('-');

  // Center a banner label around the FIRST '|' divider (between COL1 and COL2)
  function centerAtDivider(label) {
    var rep = (typeof _repeat_ === 'function') ? _repeat_ : function (s, n) { return new Array(n + 1).join(s); };
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
    var leftW = Math.floor((W.COL1 - 3) / 2);
    var rightW = W.COL1 - 3 - leftW;
    var l = (typeof _padR_ === 'function') ? _padR_(home, leftW) : String(home || '').padEnd(leftW, ' ');
    var r = (typeof _padL_ === 'function') ? _padL_(away, rightW) : String(away || '').padStart(rightW, ' ');
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
  var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  var dt = new Date(y, m - 1, d); // local date (Apps Script runs server-side but okay for day granularity)
  return { date: dt, mapRef: mapRef, weekKey: wkKey };
}

/** Canonicalize division label. */
function _canonDivision_(d) {
  if (!d) return '';
  var s = String(d).trim().toLowerCase();
  if (s === 'bronze' || s === 'b') return 'Bronze';
  if (s === 'silver' || s === 's') return 'Silver';
  if (s === 'gold' || s === 'g') return 'Gold';
  // fallback: capitalize first letter
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ensure the week store has expected shape. */
function _ensureStoreShape_(store) {
  if (!store || typeof store !== 'object') return;
  if (!store.meta) store.meta = {};
  if (!store.sched) store.sched = {};   // per-division scheduled rows: { [div]: { [rowIndex]: {epochSec?, whenText, home, away} } }
  if (!store.cast) store.cast = {};   // optional: shoutcaster info per row
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

  var norm = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
    if (!div || !home || !away) { unmatched.push({ reason: 'bad_input', pair: p }); continue; }

    var top = (typeof resolveDivisionBlockTop_ === 'function')
      ? resolveDivisionBlockTop_(div, wkMeta)
      : 0;
    if (!top) {
      unmatched.push({ reason: 'block_top_not_found', division: div, pair: p });
      continue;
    }

    var rowIndex = _findMatchRowIndex_(div, top, home, away); // 0..9 or -1
    if (rowIndex < 0) {
      unmatched.push({ reason: 'row_not_found', division: div, pair: p });
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

  return { ok: true, weekKey: weekKey, updated: updated, unmatched: unmatched, store: store };
}

// =======================
// parser.gs – Discord message parsing logic
// =======================
/** Build alias→canon map from the General sheet list. Cached per execution. */
function _getMapAliasCatalog_() {
  var canonList = (typeof getAllMapsList_ === 'function') ? getAllMapsList_() : [];
  var aliasToCanon = {};
  for (var i = 0; i < canonList.length; i++) {
    var canon = String(canonList[i] || '').trim();
    if (!canon) continue;
    var aliases = _aliasesForMap_(canon);
    for (var j = 0; j < aliases.length; j++) {
      aliasToCanon[aliases[j]] = canon; // last wins (fine)
    }
  }
  return aliasToCanon;
}

/** Generate useful aliases for a canonical map id like "dod_railyard_b6". */
function _aliasesForMap_(canon) {
  var c = String(canon || '').toLowerCase();

  // Normalize once
  var noUnders = c.replace(/_/g, ' ');
  var noDod = c.replace(/^dod_/, '');
  var noDodUnd = noDod.replace(/_/g, ' ');

  // Optional version-stripping (e.g., _b6 → base “railyard”)
  var base = c.replace(/_b\d+$/i, '');
  var baseNoU = base.replace(/_/g, ' ');
  var baseNoD = base.replace(/^dod_/, '');
  var baseNoDU = baseNoD.replace(/_/g, ' ');

  // Unique set
  var set = {};
  [
    c,
    noUnders,
    noDod,
    noDodUnd,
    base,
    baseNoU,
    baseNoD,
    baseNoDU
  ].forEach(function (a) {
    a = a.trim();
    if (a) set[a] = true;
  });

  return Object.keys(set);
}

/**
 * Extract a map hint from free text using the alias catalog.
 * Matches whole-word-ish with underscores/hyphens/space flexibility,
 * and prefers longer aliases first to avoid short collisions.
 */
function _extractMapHint_(text) {
  var t = String(text || '').toLowerCase();
  // relaxed version where underscores and hyphens are treated like spaces
  var relax = t.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  var aliasToCanon = _getMapAliasCatalog_();
  var aliases = Object.keys(aliasToCanon);

  // Sort longest first to avoid partial overshadowing (e.g., "rail" vs "railyard b6")
  aliases.sort(function (a, b) { return b.length - a.length; });

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  for (var i = 0; i < aliases.length; i++) {
    var alias = aliases[i];

    // Build a regex that matches the alias as words, allowing underscores or spaces
    // Example alias "railyard b6" will match "railyard_b6", "railyard b6", " RAILYARD   B6 "
    var pattern = '\\b' + esc(alias).replace(/_/g, '[ _]*') + '\\b';
    var re = new RegExp(pattern, 'i');

    if (re.test(t) || re.test(relax)) {
      return aliasToCanon[alias];
    }
  }
  return null;
}

// Optional team synonym map from Script Properties (JSON)
function _teamSynonyms_() {
  try {
    var sp = PropertiesService.getScriptProperties().getProperty('TEAM_SYNONYMS_JSON');
    return sp ? JSON.parse(sp) : {};
  } catch (_) { return {}; }
}

function _stripDiscordNoise_(s) {
  var t = String(s || '');

  // remove mentions <@123>, <@!123>, <@&role>, <#channel>
  t = t.replace(/<[@#][!&]?\d+>/g, ' ');
  // remove :emoji: and <:emoji:123456> and @name with flags
  t = t.replace(/<:[a-z0-9_]+:\d+>/gi, ' ')
    .replace(/:[a-z0-9_]+:/gi, ' ');
  // collapse multiple spaces
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function _extractDivisionHint_(s) {
  var m = s.match(/\b(bronze|silver|gold)\b\s*:?/i);
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : null;
}

// --- Enhanced _splitVsSides_ to handle "between A and B" and strip division hints ---
function _splitVsSides_(s) {
  var norm = s.replace(/\s*-\s*/g, ' - ');


  // Support "between A and B"
  var betweenMatch = norm.match(/between\s+(.+?)\s+and\s+(.+)/i);
  if (betweenMatch) {
    return { a: betweenMatch[1].trim(), b: betweenMatch[2].trim() };
  }

  var parts = norm.split(/\bvs\b| v\. |\/\/| - /i);
  if (parts.length < 2) return null;


  var a = parts[0], b = parts.slice(1).join(' ');
  a = a.replace(/^(bronze|silver|gold)\s*:?\s*/i, '').trim();
  b = b.replace(/^(bronze|silver|gold)\s*:?\s*/i, '').trim();


  // Strip trailing punctuation and lowercase 'the'
  a = a.replace(/^the\s+/i, '').replace(/[!?.]+$/, '').trim();
  b = b.replace(/^the\s+/i, '').replace(/[!?.]+$/, '').trim();


  return { a: a, b: b };
}

// --- Normalize ordinal suffixes in dates (e.g., 12th → 12) ---
function _stripOrdinalSuffixes_(rawDate) {
  return rawDate.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
}

// --- Sanitize raw text for parsing (ignore second timezones, remove foreign weekday mentions) ---
function _cleanScheduleText_(raw) {
  return raw
    .replace(/\/\s*Domingo.*$/i, '')
    .replace(/\b\d{1,2}:\d{2}\s*(BRT|CET|UTC|GMT|JST|PST|PT|ART|IST).*/gi, '')
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/tentative|confirm.*later|likely postponed|we'?ll confirm/gi, '');
}

// --- Enhanced Team Alias Resolver ---
function resolveTeamAlias_(rawInput) {
  __TEAM_ALIAS_CACHE = null; // Always force reload from sheet
  const aliasMap = loadTeamAliases_();
  const upper = String(rawInput || '').trim().toUpperCase();
  return aliasMap[upper] || rawInput;
}


// --- Enhanced _matchTeam_ to use aliases ---
function _matchTeam_(snippet, forcedDivision) {
  var idx = (typeof getTeamIndexCached_ === 'function') ? getTeamIndexCached_() : null;
  if (!idx || !idx.teams || !idx.teams.length) return null;


  var syn = _teamSynonyms_();
  var resolved = resolveTeamAlias_(snippet);
  var s = _normalizeTeamText_(resolved);
  if (syn[s]) s = _normalizeTeamText_(syn[s]);


  var best = null, bestScore = -1;
  for (var i = 0; i < idx.teams.length; i++) {
    var t = idx.teams[i];
    if (forcedDivision && String(t.division || '').toLowerCase() !== String(forcedDivision || '').toLowerCase()) continue;


    var cand = _normalizeTeamText_(t.name);
    var sc = _scoreTeamMatch_(s, cand);
    if (Array.isArray(t.aliases)) {
      for (var j = 0; j < t.aliases.length; j++) {
        var al = _normalizeTeamText_(t.aliases[j]);
        sc = Math.max(sc, _scoreTeamMatch_(s, al));
      }
    }
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  if (!best || bestScore < 2) return null;
  return { name: best.name, division: best.division };
}


function _normalizeTeamText_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _scoreTeamMatch_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 10;
  if (b.indexOf(a) >= 0) return Math.min(8, a.length); // partial contained
  // token overlap
  var at = a.split(' '), bt = b.split(' ');
  var hits = 0;
  for (var i = 0; i < at.length; i++) {
    if (!at[i]) continue;
    for (var j = 0; j < bt.length; j++) {
      if (bt[j] && (bt[j] === at[i] || bt[j].startsWith(at[i]) || at[i].startsWith(bt[j]))) { hits++; break; }
    }
  }
  return hits;
}

function _parseWhenFlexible_(s, hintDiv, hintMap) {
  var tz = 'America/New_York';
  var lower = s.toLowerCase();

  // Known “TBD/postponed”
  if (/\b(tbd|to be determined|postponed|next week|time tbd)\b/.test(lower)) {
    return { whenText: 'TBD' };
  }

  // 4.1 explicit numeric date (9/28[/2025] or 9-28-2025)
  var mD = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  var dateObj = null;
  if (mD) {
    var mm = +mD[1], dd = +mD[2], yy = mD[3] ? +mD[3] : null;
    if (yy && yy < 100) yy += 2000;
    var baseYear = yy || new Date().getFullYear();
    dateObj = new Date(Date.UTC(baseYear, mm - 1, dd));
  }

  // 4.2 textual month (october 5(th))
  if (!dateObj) {
    var monMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    var mM = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/);
    if (mM) {
      var mon = monMap[mM[1]]; var d = +mM[2]; var y = mM[3] ? +mM[3] : new Date().getFullYear();
      dateObj = new Date(Date.UTC(y, mon, d));
    }
  }

  // 4.3 “Sunday 1530 est” or “Monday 15th 10pm”
  var dowIdx = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, thur: 4, fri: 5, sat: 6 };
  var mDow = lower.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/);
  if (!dateObj && mDow) {
    var now = new Date();
    var targetDow = dowIdx[mDow[1].slice(0, 3)];
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var delta = (targetDow - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // “this Sunday” usually means upcoming
    d.setDate(d.getDate() + delta);

    // If we also have “15th|5th” day-of-month, align to that in current/next month
    var mNth = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
    if (mNth) {
      var nth = +mNth[1];
      var try1 = new Date(d.getFullYear(), d.getMonth(), nth);
      var try2 = new Date(d.getFullYear(), d.getMonth() + 1, nth);
      // choose the one that matches the desired dow and is not in the past
      var cand = [try1, try2].filter(function (x) { return x.getDay() === targetDow; }).sort(function (a, b) { return a - b; })[0];
      if (cand) d = cand;
    }
    dateObj = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  // time: “9est”, “9:30 pm”, “1530 est”, “10east”
  var mT = lower.match(/\b(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(e[ds]?t|east)?\b/);
  var hh = 21, mm = 0; // default 9:00 PM if unspecified (your rule)
  if (mT) {
    hh = +mT[1];
    mm = mT[2] ? +mT[2] : (mT[1].length === 3 ? +mT[1].slice(1) : 0); // handle 930
    var ap = mT[3] ? mT[3].toLowerCase() : '';
    if (!ap && hh <= 12) ap = 'pm'; // default PM when ambiguous
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }

  // If still no date, but we have a division/map hint → use that week’s default Sunday
  if (!dateObj) {
    var wk = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : {};
    if (typeof syncHeaderMetaToTables_ === 'function') wk = syncHeaderMetaToTables_(wk, hintDiv || 'Bronze');
    if (wk && wk.date) {
      var d = wk.date;
      dateObj = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }
  if (!dateObj) return null;

  // Build ET datetime at hh:mm
  var y = dateObj.getUTCFullYear(), m = dateObj.getUTCMonth(), d2 = dateObj.getUTCDate();
  // Make a Date in ET by string (lets Google set offset DST-aware)
  var local = Utilities.formatDate(new Date(Date.UTC(y, m, d2)), tz, 'yyyy-MM-dd');
  var dt = new Date(local + 'T' + (('0' + (hh | 0)).slice(-2)) + ':' + (('0' + (mm | 0)).slice(-2)) + ':00');
  var epoch = Math.floor(dt.getTime() / 1000);

  var whenText = Utilities.formatDate(dt, tz, 'h:mm a') + ' ET';
  return { epochSec: epoch, whenText: whenText };
}

// --- Enhanced _chooseWeekForPair_ with weekList threaded into helpers ---
function _chooseWeekForPair_(division, home, away, weekList, hintMap, rawText, when) {
  var wk = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : {};
  if (typeof syncHeaderMetaToTables_ === 'function') wk = syncHeaderMetaToTables_(wk, division || 'Bronze');


  if (hintMap) {
    var wByMap = _findWeekByMapAndPair_(division, hintMap, home, away, weekList);
    if (wByMap) return wByMap;
  }


  if (when && typeof when.epochSec === 'number') {
    var d = new Date(when.epochSec * 1000);
    var wByDate = _findWeekByDateAndPair_(division, d, home, away, weekList);
    if (wByDate) return wByDate;
  }


  var lower = String(rawText || '').toLowerCase();
  if (/\b(make[- ]?up|postponed|rematch)\b/.test(lower)) {
    var wPast = _findPastUnplayedWeekForPair_(division, home, away, weekList);
    if (wPast) return wPast;
  }


  return wk;
}

// --- Helper function updates to support weekList injection ---
function _findWeekByMapAndPair_(division, map, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  map = map.toLowerCase();
  return weekList.find(w => w.division === division && w.map.toLowerCase() === map && _hasTeamsInWeek_(w, home, away));
}


function _findWeekByDateAndPair_(division, dateObj, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  return weekList.find(w => {
    if (w.division !== division) return false;
    var weekDate = new Date(w.defaultDate);
    return _isSameWeek_(dateObj, weekDate) && _hasTeamsInWeek_(w, home, away);
  });
}


function _findPastUnplayedWeekForPair_(division, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  for (var i = 0; i < weekList.length; i++) {
    var wk = weekList[i];
    if (wk.division !== division) continue;
    if (_hasTeamsInWeek_(wk, home, away) && !wk.played) return wk;
  }
  return null;
}


function _isSameWeek_(d1, d2) {
  var startOfWeek = date => {
    var day = new Date(date);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - day.getDay());
    return day;
  };

  return startOfWeek(d1).getTime() === startOfWeek(d2).getTime();
}


function _hasTeamsInWeek_(week, home, away) {
  if (!week || !Array.isArray(week.matches)) return false;
  return week.matches.some(m => m.home === home && m.away === away);
}

function _sameTeam_(a, b) {
  return _normalizeTeamText_(a) === _normalizeTeamText_(b);
}



function _pollAndProcessFromId_(channelId, startId, opt) {
  var successCount = 0;
  var tentativeCount = 0;
  opt = opt || {};
  var inclusive = !!opt.inclusive;

  var processed = 0;
  var updatedPairs = 0;
  var errors = [];
  var lastId = startId ? String(startId) : '';

  // 0) If inclusive: try to fetch/process the start message itself
  if (inclusive && startId) {
    try {
      var msg0 = _fetchSingleMessageInclusive_(channelId, String(startId)); // best-effort
      if (msg0) {
        var res0 = _processOneDiscordMessage_(msg0);
        processed++;
        if (res0 && res0.updated) updatedPairs += res0.updated;
        lastId = String(msg0.id || lastId);
      }
    } catch (e) {
      errors.push('inclusive fetch failed: ' + String(e && e.message || e));
    }
  }

  // 1) Now walk forward “after” the (possibly same) startId
  var cursor = startId || lastId || '';
  var pageLimit = 100; // how many to fetch per page (relay dependent)
  var loops = 0, SAFETY = 50; // don’t infinite-loop

  while (loops++ < SAFETY) {
    var page = [];
    try {
      // Your relay uses `after` semantics: returns messages with id > after
      page = fetchChannelMessages_(channelId, { after: cursor, limit: pageLimit }) || [];
    } catch (e) {
      errors.push('fetch page failed: ' + String(e && e.message || e));
      break;
    }
    if (!page.length) break;

    // Ensure chronological (Discord often returns newest first)
    page.sort(function (a, b) { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; });

    for (var i = 0; i < page.length; i++) {
      var msg = page[i];
      try {
        var res = _processOneDiscordMessage_(msg);
        processed++;
        if (res && res.updated) {
          updatedPairs += res.updated;
          if (res.tentative) tentativeCount++;
          else successCount++;
        }
        lastId = String(msg.id || lastId);
      } catch (e) {
        errors.push('process ' + String(msg && msg.id) + ': ' + String(e && e.message || e));
      }
    }
    // advance cursor to last processed id
    cursor = lastId;
    // If fewer than pageLimit, we reached the end
    if (page.length < pageLimit) break;
  }

  // 2) Persist last pointer
  if (lastId) _setPointer_(lastId);

  logParsingSummary_(successCount, tentativeCount, opt.channelName || 'match-alerts');

  return {
    processed: processed,
    updatedPairs: updatedPairs,
    errors: errors,
    lastPointer: lastId
  }
}

/** Process one Discord message through: content → parse → update */
function _processOneDiscordMessage_(msg) {
  if (!msg || !msg.content) return { updated: 0 };

  let parsed = null;
  let raw = null;
  sendLog(`👀 Message ID ${msg.id}: raw="${msg.content.slice(0, 100)}..."`);
  sendLog(`🧪 Parsed: ${JSON.stringify(parsed)}`);
  try {
    raw = msg.content;
    parsed = parseScheduleMessage_v3(raw);
    if (!parsed || !parsed.team1 || !parsed.team2 || !parsed.division) {
      sendLog(`⚠️ Skipped message ID: ${msg?.id} — unable to parse.`);
      return { updated: 0 };
    }


    const isTentative = parsed.status === 'Confirming' || parsed.tentative;
    const isRematch = parsed.isRematch || false;


    // Log this parsed result
    logMatchToWMLog_(parsed, msg.author?.id || msg.authorId, msg.channel?.name || msg.channelName || msg.channel, isTentative, isRematch);


    // Write match time to sheet in Column E
    try {
      const sheet = SpreadsheetApp.getActive().getSheetByName(parsed.division);
      if (sheet && parsed.row && parsed.whenText) {
        sheet.getRange(parsed.row, 5).setValue(parsed.whenText); // Column E = 5
      }
    } catch (e) {
      sendLog(`⚠️ Error writing to sheet: ${e.message}`);
    }

    const line = formatScheduleConfirmationLine_(parsed, parsed.row, msg.author?.id, msg.id);
    relayPost_('/reply', { channelId: String(RESULTS_LOG_CHANNEL_ID), content: line });

  }
  catch (e) {
    sendLog(`❌ Error processing message ID ${msg?.id}: ${e.message}`);
    return { updated: 0 };
  }

  return {
    updated: 1,
    tentative: isTentative,
    parsed: parsed
  };
}

/**
 * Parse a Discord message (string) into schedule update pairs.
 * Returns { ok, pairs: [{division, home, away, epochSec?, whenText, weekKey}], trace }
 */
function parseScheduleMessage_v3(text) {
  var trace = [];
  __TEAM_ALIAS_CACHE = null;
  try {
    var raw = String(text || '');
    raw = _cleanScheduleText_(raw);
    var cleaned = _stripDiscordNoise_(raw);
    trace.push('cleaned=' + cleaned);

    // division + map hints
    var hintDiv = _extractDivisionHint_(cleaned);
    var hintMap = _extractMapHint_(cleaned);
    if (hintDiv) trace.push('hintDiv=' + hintDiv);
    if (hintMap) trace.push('hintMap=' + hintMap);

    // teams
    var sides = _splitVsSides_(cleaned);
    if (!sides || !sides.a || !sides.b) {
      return { ok: false, error: 'no_vs', trace: trace };
    }
    trace.push('sides=' + JSON.stringify(sides));

    var matchA = _matchTeam_(sides.a, hintDiv);
    var matchB = _matchTeam_(sides.b, hintDiv);
    if (!matchA || !matchB) {
      return { ok: false, error: 'team_not_found', detail: { a: !!matchA, b: !!matchB }, trace: trace };
    }
    if (!hintDiv && matchA.division && matchB.division && matchA.division !== matchB.division) {
      return { ok: false, error: 'cross_division', trace: trace, detail: { a: matchA, b: matchB } };
    }
    var division = hintDiv || matchA.division || matchB.division;
    trace.push('division=' + division);

    // when
    var when = _parseWhenFlexible_(cleaned, hintDiv, hintMap);
    if (when && when.whenText) trace.push('when=' + JSON.stringify(when));

    // which block/week?
    var week = _chooseWeekForPair_(div, home.name, away.name, weekList, mapHint, raw, when);
    if (!week || !week.date) {
      return { ok: false, error: 'week_not_found', trace: trace };
    }
    if (typeof syncHeaderMetaToTables_ === 'function') week = syncHeaderMetaToTables_(week, division);
    var wkKey = (typeof weekKey_ === 'function') ? weekKey_(week) : (Utilities.formatDate(week.date, 'America/New_York', 'yyyy-MM-dd') + '|' + (week.mapRef || ''));

    var pair = {
      division: division,
      home: matchA.name,
      away: matchB.name,
      whenText: (when && when.whenText) ? when.whenText : 'TBD',
      weekKey: wkKey
    };
    if (when && typeof when.epochSec === 'number') pair.epochSec = when.epochSec;

    return { ok: true, pairs: [pair], trace: trace };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), trace: trace };
  }
}

function logToWmSheet_(level, event, message, detailsObj) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sh = ss.getSheetByName(LOG_SHEET) || ss.insertSheet(LOG_SHEET);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['Timestamp', 'Level', 'Event', 'Message', 'Details (JSON)']);
      sh.hideSheet(); // keep it tidy
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

// ----- Minimal persistent storage for Twitch links -----

function _saveTwitchForUser_(userId, twitchUrl) {
  const key = 'TWITCH_URL__' + String(userId);
  _props_().setProperty(key, String(twitchUrl));
}

function server_getTwitchUrl(secret, userId) {
  try {
    _checkSecret_(secret);
    const key = 'TWITCH_URL__' + String(userId);
    const url = _props_().getProperty(key) || '';
    return _ok_({ userId: String(userId), twitchUrl: url });
  } catch (e) {
    return _err_(e);
  }
}