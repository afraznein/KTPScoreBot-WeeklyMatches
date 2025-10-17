// =======================
// sheets.gs
// Functions for reading and indexing the Google Sheet

let __SS = null;
function ss_(){ return __SS || (__SS = SpreadsheetApp.openById(SPREADSHEET_ID)); }
// =======================

/** Get the sheet object by division name. */
function getSheetByName_(div){
  const ss = ss_();
  return ss.getSheetByName(div);
}

/** Build the canonical team map (uppercase → canonical). */
function getCanonicalTeamMap_() {
  const cached = cacheGetJson_('WM_TEAM_CANON');
  if (cached) return cached;

  const map = {};
  for (const div of DIVISIONS) {
    const sh = getSheetByName_(div); if (!sh) continue;
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

/**
 * Return the Sheet object for a division by name.
 *
 * @param {string} division One of "Bronze", "Silver", "Gold"
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getDivSheet_(division) {
  if (!division) return null;
  const ss = ss_(); // SPREADSHEET_ID is in config.gs
  const sh = ss.getSheetByName(division);
  return sh || null;
}


/**
 * Return canonical team names for a division (Bronze/Silver/Gold)
 * from range A3:A22. Always uppercase + trimmed.
 *
 * @param {string} division
 * @return {string[]} canonical names
 */
function getCanonicalTeams_(division) {
  const sh = getDivSheet_(division);
  if (!sh) return [];
  const vals = sh.getRange('A3:A22').getValues();
  return vals
    .map(r => String(r[0] || '').trim().toUpperCase())
    .filter(x => !!x);
}


/** Get all weekly blocks for a division sheet. */
function getAllBlocks_(sh){
  const blocks = [];
  let row = GRID.startRow;
  while (true){
    const mapCell = sh.getRange(row, COL_MAP).getValue();
    const dateCell = sh.getRange(row+1, COL_MAP).getValue();
    if (!mapCell || !dateCell) break;

    const map = String(mapCell).trim();
    const weekDate = new Date(dateCell);
    const headerWeekName = sh.getRange(row-1, COL_MAP).getValue();

    blocks.push({
      top: row,
      map,
      mapLower: normalizeMap_(map),
      weekDate,
      weekName: headerWeekName
    });

    row += GRID.blockHeight;
  }
  return blocks;
}

/** Resolve the top row for this division/week.
 * Order: explicit hint → name contains week label/key → closest date in block name → first block → GRID.startRow (3)
 */
function resolveDivisionBlockTop_(division, week) {
  var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(division) : null;
  if (!sh) throw new Error('resolveDivisionBlockTop_: missing sheet for ' + division);

  // 1) Explicit hint
  try {
    if (week && week.blocks && week.blocks[division] && week.blocks[division].top) {
      return week.blocks[division].top;
    }
  } catch (_){}

  // 2) Gather blocks
  var blocks = [];
  try { if (typeof getAllBlocks_ === 'function') blocks = getAllBlocks_(sh) || []; } catch (_){}

  // Helpers to get a readable name for a block
  function blockTop_(b){ return b && (b.top || b.startRow) || null; }
  function blockName_(b, top) {
    var nm = (b && (b.name || b.weekName)) ? String(b.name || b.weekName) : '';
    if (!nm && typeof getWeekNameAt_ === 'function' && top) {
      try { nm = String(getWeekNameAt_(sh, top) || ''); } catch (_){}
    }
    return nm;
  }

  var targets = [];
  try {
    var wkKey = (week && week.weekKey) || (typeof getWeekKeyFromWeek_ === 'function' ? getWeekKeyFromWeek_(week) : '');
    var label = week && week.label;
    if (wkKey) targets.push(_norm_(wkKey));
    if (label) targets.push(_norm_(label));
  } catch (_){}

  // 3) Name contains the target key/label
  for (var i = 0; i < blocks.length; i++) {
    var top = blockTop_(blocks[i]);
    if (!top) continue;
    var nm = _norm_(blockName_(blocks[i], top));
    for (var t = 0; t < targets.length; t++) {
      if (targets[t] && nm.indexOf(targets[t]) !== -1) return top;
    }
  }

  // 4) Date proximity fallback
  var want = week && (week.start || week.date);
  var wantYear = want instanceof Date ? want.getFullYear() : (new Date()).getFullYear();
  if (want instanceof Date && blocks.length) {
    var best = { top:null, score:1e9 };
    for (var j = 0; j < blocks.length; j++) {
      var top2 = blockTop_(blocks[j]); if (!top2) continue;
      var nm2 = blockName_(blocks[j], top2);
      var dt = parseDateFromText_(nm2, wantYear);
      if (!dt) continue;
      var diffDays = Math.abs((dt - want) / 86400000);
      if (diffDays < best.score) best = { top: top2, score: diffDays };
    }
    if (best.top != null && best.score <= 4) return best.top; // within ~half-week
  }

  // 5) Fallbacks
  if (blocks.length) {
    var b0 = blocks[0]; var t0 = blockTop_(b0); if (t0) return t0;
  }
  try { return (GRID && GRID.startRow) ? GRID.startRow : 3; } catch (_){ return 3; }
}

/** Return the aligned (upcoming) week or null. */
function getAlignedUpcomingWeekOrReport_(refDate) {
  var tz = getTz_();
  var now = refDate ? new Date(refDate) : new Date();

  var start = new Date(now);
  start.setHours(0,0,0,0);
  var dow = start.getDay(); // Sun=0..Sat=6; align to Monday
  var mondayDiff = (dow + 6) % 7;
  start.setDate(start.getDate() - mondayDiff);
  if (dow === 6 || dow === 0) start.setDate(start.getDate() + 7); // Sat/Sun → next week

  var end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23,59,59,999);

  var wkKey = (typeof weekKey_ === 'function') ? weekKey_(start)
            : (typeof isoWeekKey_ === 'function') ? isoWeekKey_(start)
            : Utilities.formatDate(start, tz, "yyyy-'W'ww");

  return {
    date: start,
    start: start,
    end: end,
    tz: tz,
    weekKey: wkKey,
    label: Utilities.formatDate(start, tz, "MMM d") + "–" +
           Utilities.formatDate(end,   tz, "MMM d")
  };
}


/** Build fast index for a given week. */
function buildWeekMatchIndex_(week){
  const idx = {};
  for (const div of DIVISIONS){
    const sh = getSheetByName_(div); if (!sh) continue;
    var top = resolveDivisionBlockTop_((divisionName), week);
    const vals = sh.getRange(top,1,GRID.matchesPerBlock,GRID.cols).getValues();
    const map = {};
    for (let i=0;i<vals.length;i++){
      const r = vals[i];
      const home = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
      const away = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
      if (!home || !away) continue;
      const key = [home, away].sort().join('|');
      map[key] = { rowIndex: i, top };
    }
    idx[div] = map;
  }
  return idx;
}

function getWeekMatchIndex_(week){
  const wk = weekKey_(week);
  const k = `WM_IDX_${wk}`;
  const cached = cacheGetJson_(k);
  if (cached) return cached;
  const built = buildWeekMatchIndex_(week);
  cachePutJson_(k, built, LOOKUP_CACHE_TTL_SEC);
  return built;
}

/** Find week name from row offset. */
function getWeekNameAt_(sh, top){
  return sh.getRange(top-1, COL_MAP).getValue();
}

/** Return true if row already has results. */
function hasResult_(row){
  return (row[COL_T1_RESULT-1] || row[COL_T2_RESULT-1] || row[COL_T1_SCORE-1] || row[COL_T2_SCORE-1]);
}

function readTeamsFromRange_(sheet, divName, rangeA1) {
  var values = sheet.getRange(rangeA1).getDisplayValues();
  var out = [];
  var seen = {};
  for (var r = 0; r < values.length; r++) {
    var name = String(values[r][0] || '').trim();
    if (!name) continue;
    // Skip obvious non-team lines you might store in col A
    if (/^#/ .test(name)) continue;          // e.g., #notes
    if (/^week\b/i.test(name)) continue;     // e.g., Week of ...
    if (/^notes?\b/i.test(name)) continue;   // e.g., Notes
    if (seen[name]) continue;
    seen[name] = 1;
    out.push({ division: divName, name: name, aliases: [], abbrev: '', emojiId: '', emojiName: '' });
  }
  return out;
}