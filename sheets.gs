// =======================
// sheets.gs
// Functions for reading and indexing the Google Sheet
// =======================

/** Get the sheet object by division name. */
function getSheetByName_(div){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); // SPREADSHEET_ID is in config.gs
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

/** Return the aligned (upcoming) week or null. */
function getAlignedUpcomingWeekOrReport_(){
  const today = startOfDay_(new Date());
  for (const div of DIVISIONS) {
    const sh = getSheetByName_(div); if (!sh) continue;
    const blocks = getAllBlocks_(sh);
    for (const bk of blocks){
      const wkStart = startOfDay_(bk.weekDate);
      const wkEnd   = endOfDay_(bk.weekDate);
      if (today <= wkEnd) {
        const blocksByDiv = {};
        for (const d of DIVISIONS){
          const sh2 = getSheetByName_(d);
          if (!sh2) continue;
          const bk2 = getAllBlocks_(sh2).find(x => fmtDay_(x.weekDate) === fmtDay_(bk.weekDate));
          if (bk2) blocksByDiv[d] = { top: bk2.top, weekName: bk2.weekName };
        }
        return { date: bk.weekDate, map: bk.map, headerWeekName: bk.weekName, blocks: blocksByDiv };
      }
    }
  }
  return null;
}

/** Build fast index for a given week. */
function buildWeekMatchIndex_(week){
  const idx = {};
  for (const div of DIVISIONS){
    const sh = getSheetByName_(div); if (!sh) continue;
    const top = week.blocks[div].top;
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
