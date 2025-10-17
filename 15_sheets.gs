// =======================
// sheets.gs
// Functions for reading and indexing the Google Sheet
// =======================

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

// Prefer the first block whose date >= today (upcoming). If none, last block.
function resolveDivisionBlockTop_(division, week) {
  var sh = getSheetByName_(division);
  if (!sh) throw new Error('resolveDivisionBlockTop_: no sheet for '+division);

  // 0) Honor explicit hint
  if (week && week.blocks && week.blocks[division] && week.blocks[division].top) {
    return week.blocks[division].top;
  }

  var blocks = [];
  try { blocks = getAllBlocks_(sh) || []; } catch(_){}
  if (!blocks.length) return 3; // safe fallback

  // Today's date in league tz
  var now = new Date();
  var tz  = getTz_();
  var todayY = parseInt(Utilities.formatDate(now, tz, 'yyyy'),10);

  // Evaluate each block date
  var annotated = blocks.map(function(b){
    var top = b && (b.top || b.startRow);
    return { top: top, dt: top ? extractBlockDate_(sh, top, todayY) : null, raw:b };
  }).filter(function(x){ return x.top; });

  annotated.sort(function(a,b){
    var ad = a.dt ? a.dt.getTime() : -1;
    var bd = b.dt ? b.dt.getTime() : -1;
    return ad - bd;
  });

  // First dt >= today
  var todayMid = new Date(Utilities.formatDate(now, tz, 'yyyy-MM-dd') + 'T00:00:00' + Utilities.formatDate(now, tz, 'XXX'));
  var upcoming = annotated.filter(function(x){ return x.dt && x.dt.getTime() >= todayMid.getTime(); });
  if (upcoming.length) return upcoming[0].top;

  // Else last block (we're past all of them)
  return annotated[annotated.length-1].top;
}

// ---------- block index + A-column helpers ----------
function blockIndexForTop_(sheet, topRow) {
  var blocks = [];
  try { blocks = getAllBlocks_(sheet) || []; } catch(_){}
  if (!blocks.length) return 0;
  var idx = 0;
  for (var i = 0; i < blocks.length; i++) {
    var t = blocks[i] && (blocks[i].top || blocks[i].startRow);
    var nxt = (blocks[i+1] && (blocks[i+1].top || blocks[i+1].startRow)) || 1e9;
    if (t && topRow >= t && topRow < nxt) { idx = i; break; }
    if (t && topRow >= t) idx = i;
  }
  return idx;
}

function _readA_(sheet, row) {
  try { return String(sheet.getRange('A' + row).getDisplayValue() || '').trim(); } catch (_){ return ''; }
}

/**
 * From the block (via topRow), read MAP and DATE from the A-column meta rows.
 * Defaults: MAP at A28 + 11*i, DATE at A29 + 11*i
 * (can override with GRID_MAP_START_ROW / GRID_DATE_START_ROW / GRID_BLOCK_STRIDE)
 */
function getWeekMetaAt_(sheet, topRow) {
  if (!sheet || !topRow) return { idx:0, dateISO:'', rawDate:'', map:'', date:null, seasonWeek:'' };

  var sp      = PropertiesService.getScriptProperties();
  var stride  = parseInt(sp.getProperty('GRID_BLOCK_STRIDE')    || '11', 10);
  var map0    = parseInt(sp.getProperty('GRID_MAP_START_ROW')    || '28', 10);
  var date0   = parseInt(sp.getProperty('GRID_DATE_START_ROW')   || '29', 10);
  var label0  = parseInt(sp.getProperty('GRID_LABEL_START_ROW')  || '27', 10); // NEW

  var idx     = blockIndexForTop_(sheet, topRow);
  var mapRow  = map0   + stride * idx;
  var dateRow = date0  + stride * idx;
  var lblRow  = label0 + stride * idx;

  var mapTxt  = _readA_(sheet, mapRow)  || _readA_(sheet, mapRow + 1)  || _readA_(sheet, mapRow - 1);
  var dateTxt = _readA_(sheet, dateRow) || _readA_(sheet, dateRow + 1) || _readA_(sheet, dateRow - 1);
  var lblTxt  = _readA_(sheet, lblRow)  || _readA_(sheet, lblRow + 1)  || _readA_(sheet, lblRow - 1);

  var tz   = getTz_();
  var yr   = parseInt(Utilities.formatDate(new Date(), tz, 'yyyy'), 10);
  var dObj = parseDateFromText_(dateTxt, yr);
  var iso  = dObj ? Utilities.formatDate(dObj, tz, 'yyyy-MM-dd') : '';

  return {
    idx: idx,
    dateISO: iso,
    rawDate: dateTxt,
    map: (mapTxt || '').trim(),
    date: dObj,
    seasonWeek: (lblTxt || '').trim()   // NEW
  };
}


/** Choose the week's MAP+DATE by looking at the chosen block per division.
 * Returns { dateISO, map, from: { division, top } }.
 */
function chooseWeekMetaAcrossDivisions_(week) {
  var divs = getDivisionSheets_();
  var votes = {}; // key: dateISO|map -> count
  var labelCount = {}; // seasonWeek -> count
  var firstGood = null;

  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var sh  = getSheetByName_(div);
    if (!sh) continue;
    var top = resolveDivisionBlockTop_(div, week);
    if (!top) continue;

    var meta = getWeekMetaAt_(sh, top);
    if (!meta.dateISO || !meta.map) continue;

    var key = meta.dateISO + '|' + meta.map;
    votes[key] = (votes[key] || 0) + 1;

    var lbl = meta.seasonWeek || '';
    if (lbl) labelCount[lbl] = (labelCount[lbl] || 0) + 1;

    if (!firstGood) {
      firstGood = {
        key: key, dateISO: meta.dateISO, map: meta.map,
        seasonWeek: lbl, from: { division: div, top: top }
      };
    }
  }


  var bestKey = null, bestN = 0;
  for (var k in votes) if (votes[k] > bestN) { bestKey = k; bestN = votes[k]; }

  var bestLabel = '';
  var bestLabelN = 0;
  for (var L in labelCount) if (labelCount[L] > bestLabelN) { bestLabel = L; bestLabelN = labelCount[L]; }

  if (bestKey) {
    var parts = bestKey.split('|');
    return { dateISO: parts[0] || '', map: parts[1] || '', seasonWeek: bestLabel || (firstGood && firstGood.seasonWeek) || '', from: firstGood && firstGood.from };
  }
  return firstGood || { dateISO:'', map:'', seasonWeek:'', from:null };
}

function getSeasonWeekLabelFromGrid_(week) {
  var m = chooseWeekMetaAcrossDivisions_(week);
  return m.seasonWeek || '';
}

/** Final wkKey for posts: "YYYY-MM-DD|map" from the grid */
function getWeekKeyFromGrid_(week) {
  var m = chooseWeekMetaAcrossDivisions_(week);
  return (m.dateISO || '') + '|' + (m.map || '');
}

// Readable block name helper
function _blockName_(sheet, block, top) {
  var nm = block && (block.name || block.weekName) ? String(block.name || block.weekName) : '';
  if (!nm && typeof getWeekNameAt_ === 'function' && top) {
    try { nm = String(getWeekNameAt_(sheet, top) || ''); } catch (_){}
  }
  return nm;
}

// Extract a representative date for a block (from name, else from a few cells)
function extractBlockDate_(sheet, blockTop, refYear) {
  try {
    var nm = _blockName_(sheet, null, blockTop);
    var dt = parseDateFromText_(nm, refYear);
    if (dt) return dt;
  } catch(_){}
  // scan a small window in the block for any date token
  try {
    var end = Math.min(sheet.getLastRow(), blockTop + 10);
    var vals = sheet.getRange(blockTop, 1, Math.max(1, end-blockTop+1), Math.min(6, sheet.getLastColumn())).getDisplayValues();
    var best = null;
    for (var r=0;r<vals.length;r++){
      for (var c=0;c<vals[r].length;c++){
        var d = parseDateFromText_(vals[r][c], refYear);
        if (d) { best = best || d; }
      }
    }
    return best;
  } catch(_){}
  return null;
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

// Convert column letter to 1-based index (A=1, B=2, ...)
function colIdx_(letter) {
  letter = String(letter || '').toUpperCase();
  var n = 0;
  for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n || 1;
}

// Read grid columns from Script Properties, with safe defaults:
// B/F = W/L, C/G = teams, D/H = scores
function getGridCols_() {
  var sp = PropertiesService.getScriptProperties();
  function getOrDef(key, def) { return (sp.getProperty(key) || def); }
  var WL1 = colIdx_(getOrDef('GRID_COL_WL1', 'B'));
  var T1  = colIdx_(getOrDef('GRID_COL_TEAM1', 'C'));
  var S1  = colIdx_(getOrDef('GRID_COL_SCORE1', 'D'));
  var WL2 = colIdx_(getOrDef('GRID_COL_WL2', 'F'));
  var T2  = colIdx_(getOrDef('GRID_COL_TEAM2', 'G'));
  var S2  = colIdx_(getOrDef('GRID_COL_SCORE2', 'H'));
  return { WL1:WL1, T1:T1, S1:S1, WL2:WL2, T2:T2, S2:S2 };
}

function _isBlank_(v) { return !String(v || '').trim(); }
function _hasNumber_(v) { return /\d/.test(String(v || '')); }

// Simple shim so board/scheduler can call this name
function getDivisionSheet_(division){
  return getSheetByName_(division);
}

/**
 * Prefer a pending match in the aligned week block; else scan previous blocks (history).
 * Returns:
 *   { located: { division, absRow, t1, t2, weekObject }, from: 'aligned'|'history' }
 * or null if none.
 */
function locatePendingMatchAlignedThenHistory_(division, alignedWeek, teamA, teamB) {
  var sh = getDivisionSheet_(division);
  if (!sh) return null;

  function isPendingRow_(r){
    var t1r = String(r[COL_T1_RESULT-1]||'').trim();
    var t2r = String(r[COL_T2_RESULT-1]||'').trim();
    var s1  = String(r[COL_T1_SCORE -1]||'').trim();
    var s2  = String(r[COL_T2_SCORE -1]||'').trim();
    return !t1r && !t2r && !s1 && !s2;
  }

  function rowMatches_(r){
    var a = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
    var b = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
    if (!a || !b) return false;
    var A = String(teamA||'').toUpperCase();
    var B = String(teamB||'').toUpperCase();
    if (a === 'BYE' || b === 'BYE') return false;
    return (a===A && b===B) || (a===B && b===A);
  }

  // 1) Try aligned week block first
  try {
    var top = resolveDivisionBlockTop_(division, alignedWeek);
    if (top) {
      var vals = sh.getRange(top, 1, GRID.matchesPerBlock, GRID.cols).getValues();
      for (var i=0;i<vals.length;i++){
        if (rowMatches_(vals[i]) && isPendingRow_(vals[i])) {
          return {
            located: { division: division, absRow: top + i, t1: teamA, t2: teamB, weekObject: alignedWeek },
            from: 'aligned'
          };
        }
      }
    }
  } catch(_){}

  // 2) Scan all blocks (history)
  try {
    var blocks = getAllBlocks_(sh) || [];
    for (var b=0;b<blocks.length;b++){
      var top2 = blocks[b].top;
      var vals2 = sh.getRange(top2, 1, GRID.matchesPerBlock, GRID.cols).getValues();
      for (var j=0;j<vals2.length;j++){
        if (rowMatches_(vals2[j]) && isPendingRow_(vals2[j])) {
          return {
            located: { division: division, absRow: top2 + j, t1: teamA, t2: teamB, weekObject: { date: blocks[b].weekDate, map: blocks[b].map } },
            from: 'history'
          };
        }
      }
    }
  } catch(_){}

  return null;
}

function getOrCreateProfilesSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('Profiles');
  if (!sh) {
    sh = ss.insertSheet('Profiles');
    sh.getRange(1,1,1,4).setValues([['userId','username','twitchUrl','lastPromptAt']]);
  }
  return sh;
}
function getTwitchForUser_(userId) {
  if (!userId) return '';
  var sh = getOrCreateProfilesSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i=1;i<vals.length;i++) {
    if (String(vals[i][0]) === String(userId)) return String(vals[i][2]||'');
  }
  return '';
}
function setTwitchForUser_(userId, username, twitchUrl) {
  if (!userId) return;
  var sh = getOrCreateProfilesSheet_();
  var vals = sh.getDataRange().getValues();
  for (var i=1;i<vals.length;i++) {
    if (String(vals[i][0]) === String(userId)) {
      sh.getRange(i+1,2,1,2).setValues([[username||vals[i][1], twitchUrl||vals[i][2]]]);
      return;
    }
  }
  sh.appendRow([String(userId), String(username||''), String(twitchUrl||''), new Date()]);
}


