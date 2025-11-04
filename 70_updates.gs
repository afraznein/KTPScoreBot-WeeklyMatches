// =======================
// 70_updates.gs - Table Update Logic
// =======================
// Purpose: Apply parsed schedules to Google Sheets and Discord tables
// Dependencies: 00_config.gs, 05_util.gs, 10_storage.gs, 20_sheets.gs, 40_logging.gs, 55_rendering.gs
// Used by: 30_relay.gs (event handlers), 60_parser.gs
//
// Functions in this module:
// - updateTablesMessageFromPairs(weekKey, pairs)
// - weekFromKey(wkKey)
// - canonDivision(d)
// - ensureStoreShape(store)
// - findMatchRowIndex(division, top, home, away)
//
// Total: 5 functions
// =======================

/** Parse "YYYY-MM-DD|map" into a week object with a real Date in local ET. */
function weekFromKey(wkKey) {
  var parts = String(wkKey || '').split('|');
  var iso = parts[0] || '';
  var mapRef = parts[1] || '';
  var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  var dt = new Date(y, m - 1, d); // local date (Apps Script runs server-side but okay for day granularity)
  return { date: dt, mapRef: mapRef, weekKey: wkKey };
}

/** Canonicalize division label. */
function canonDivision(d) {
  if (!d) return '';
  var s = String(d).trim().toLowerCase();
  if (s === 'bronze' || s === 'b') return 'Bronze';
  if (s === 'silver' || s === 's') return 'Silver';
  if (s === 'gold' || s === 'g') return 'Gold';
  // fallback: capitalize first letter
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ensure the week store has expected shape. */
function ensureStoreShape(store) {
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
function findMatchRowIndex(division, top, home, away) {
  var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(division) : null;
  if (!sh) {
    if (typeof sendLog === 'function') sendLog(`🔍 findMatchRowIndex: sheet not found for ${division}`);
    return -1;
  }

  var gridStartRow = top + 1;
  var rows = 10; // grid size
  var band = sh.getRange(gridStartRow, 2, rows, 7).getDisplayValues(); // B..H

  var norm = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  };
  var nh = norm(home), na = norm(away);

  // Diagnostic logging
  if (typeof sendLog === 'function') {
    sendLog(`🔍 Finding match: "${home}" vs "${away}" → normalized: "${nh}" vs "${na}"`);
    sendLog(`🔍 Searching ${division} rows ${gridStartRow}-${gridStartRow + rows - 1} (block top: ${top})`);
  }

  // Exact match first
  for (var i = 0; i < band.length; i++) {
    var r = band[i]; // [B,C,D,E,F,G,H]
    var ch = norm(r[1]); // C (home)
    var ca = norm(r[5]); // G (away)

    if (i < 3 && typeof sendLog === 'function') {
      // Log first 3 rows for debugging
      sendLog(`🔍 Row ${i}: sheet="${r[1]}" vs "${r[5]}" → normalized: "${ch}" vs "${ca}"`);
    }

    if (ch && ca && ch === nh && ca === na) {
      if (typeof sendLog === 'function') sendLog(`✅ Exact match found at row ${i}`);
      return i;
    }
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

  if (candidates.length === 1) {
    if (typeof sendLog === 'function') sendLog(`✅ Fuzzy match found at row ${candidates[0]}`);
    return candidates[0];
  }

  if (typeof sendLog === 'function') {
    sendLog(`❌ No match found. Candidates: ${candidates.length}`);
  }

  return -1;
}

/**
 * Update the weekly tables from parsed pairs and re-render Discord.
 * @param {string} weekKey  "YYYY-MM-DD|map_ref"
 * @param {Array<Object>} pairs  [{division, home, away, whenText, epochSec? , weekKey?}, ...]
 * @returns {{ok:boolean, weekKey:string, updated:number, unmatched:Array, store:any}}
 */
function updateTablesMessageFromPairs(weekKey, pairs) {
  // --- 0) Normalize inputs
  pairs = Array.isArray(pairs) ? pairs : [];
  if (!weekKey) {
    // fallback: take the weekKey from the first pair, if present
    weekKey = (pairs[0] && pairs[0].weekKey) ? String(pairs[0].weekKey) : '';
  }
  if (!weekKey || weekKey.indexOf('|') < 0) {
    throw new Error('updateTablesMessageFromPairs: missing/invalid weekKey');
  }

  // --- 1) Derive a "week" object from weekKey (YYYY-MM-DD|map)
  var wkMeta = weekFromKey(weekKey);          // {date, mapRef, weekKey}
  // Allow the sheet to align blocks/canonical division tops etc.
  if (typeof syncHeaderMetaToTables === 'function') {
    // Use Gold (or Bronze) as canonical to ensure blocks map is present
    wkMeta = syncHeaderMetaToTables(wkMeta, 'Gold');
  }

  // --- 2) Load the store, ensure shape
  var store = (typeof loadWeekStore_ === 'function') ? (loadWeekStore_(weekKey) || {}) : {};
  ensureStoreShape(store);

  // --- 3) For each pair, locate row inside the division's block and persist schedule
  var updated = 0;
  var unmatched = [];

  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i] || {};
    var div = canonDivision(p.division);
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

    var rowIndex = findMatchRowIndex(div, top, home, away); // 0..9 or -1
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
