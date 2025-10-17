// =======================
// parser.gs
// Message parsing + division detection + match location
// =======================

// ---------- Division tokens ----------

/** Case-insensitive division token detection, incl. [Bronze] and Bronze: */
function divisionFromText_(s) {
  const t = String(s || '');
  if (/\bbronze\b/i.test(t) || /(^|\W)brz(\W|$)/i.test(t) || /\[bronze\]/i.test(t) || /bronze:/i.test(t)) return 'Bronze';
  if (/\bsilver\b/i.test(t) || /(^|\W)sil(\W|$)/i.test(t) || /\[silver\]/i.test(t) || /silver:/i.test(t)) return 'Silver';
  if (/\bgold\b/i.test(t)   || /(^|\W)gld(\W|$)/i.test(t) || /\[gold\]/i.test(t)   || /gold:/i.test(t))   return 'Gold';
  return null;
}

/**
 * Resolve division: prefer explicit token; else infer by finding a PENDING row
 * in aligned week; else earliest pending rematch in history.
 */
function resolveDivision_(msgText, teamA, teamB, alignedWeek) {
  const exp = divisionFromText_(msgText);
  if (exp) return exp;

  const candidates = [];
  for (const div of DIVISIONS) {
    const hit = alignedWeek ? locateMatchInWeek_(div, alignedWeek, teamA, teamB, true) : null;
    if (hit) candidates.push(div);
  }
  if (candidates.length === 1) return candidates[0];

  for (const div of DIVISIONS) {
    const hit = findPendingMatchAcrossHistory_(div, teamA, teamB, alignedWeek ? weekKey_(alignedWeek) : null);
    if (hit) return div;
  }
  return null;
}

// ---------- Canonical team lookup ----------

/** Build a Set of all canonical team names (A3:A22) across all divisions. */
function _allCanonicalTeams_() {
  const set = new Set();
  for (const div of DIVISIONS) {
    const list = getCanonicalTeams_(div); // returns uppercase trimmed names
    for (const nm of list) if (nm) set.add(nm);
  }
  return set;
}

/** If the raw starts with :team_xxx: map to canonical by best partial match. */
function _teamEmojiToCanonical_(raw) {
  const m = String(raw || '').match(/:team_([a-z0-9_]+):/i);
  if (!m) return null;
  const token = m[1].replace(/_/g, ' ').toUpperCase().trim();
  const all = _allCanonicalTeams_();
  // Try startsWith, then contains (space-insensitive)
  const spaceStrip = (s) => s.replace(/\s+/g, '');
  const tokenStripped = spaceStrip(token);
  let best = null;

  for (const name of all) {
    const n = String(name);
    if (n.startsWith(token)) return n;
  }
  for (const name of all) {
    const n = String(name);
    if (spaceStrip(n).includes(tokenStripped)) {
      best = n; break;
    }
  }
  return best;
}

/** Canonicalize a user-entered team string to the exact legend entry. */
function normalizeTeamInputToCanonical_(raw) {
  if (!raw) return '';
  const fromEmoji = _teamEmojiToCanonical_(raw);
  if (fromEmoji) return fromEmoji;

  // Strip edge emojis and trim ends only; keep interior spaces
  let s = removeEdgeEmojisAndTrim_(String(raw));
  s = s.toUpperCase();

  const all = _allCanonicalTeams_();

  // Exact match
  if (all.has(s)) return s;

  // Fuzzy: startsWith then space-insensitive contains
  const spaceStrip = (x) => x.replace(/\s+/g, '');
  const sNo = spaceStrip(s);

  for (const name of all) {
    if (String(name).startsWith(s)) return String(name);
  }
  for (const name of all) {
    if (spaceStrip(String(name)) === sNo) return String(name);
  }
  // No match
  return s; // return normalized input (still uppercase) so caller can warn if not in canonical set
}

// ---------- Emoji / text cleaning ----------

/** Remove discord-style emojis ONLY at the edges, then trim ends. Keep interior spaces. */
function removeEdgeEmojisAndTrim_(s) {
  if (!s) return '';
  let t = String(s);

  // Patterns:
  // - Custom :name: at edges
  // - Custom <:name:id> or <a:name:id> at edges
  // - Unicode emoji at edges (roughly)
  const edgeEmoji = new RegExp([
    // leading custom
    '^(?:\\s*(?::[a-z0-9_~]+:|<a?:[a-z0-9_~]+:\\d+>)\\s*)+',
    // trailing custom
    '(?:\\s*(?::[a-z0-9_~]+:|<a?:[a-z0-9_~]+:\\d+>)\\s*)+$'
  ].join('|'), 'ig');

  // Strip repeatedly at edges
  t = t.replace(/^\s*(?::[a-z0-9_~]+:|<a?:[a-z0-9_~]+:\d+>)\s*/ig, '');
  t = t.replace(/\s*(?::[a-z0-9_~]+:|<a?:[a-z0-9_~]+:\d+>)\s*$/ig, '');

  // Remove a few common leading/trailing unicode emoji blocks at edges
  t = t.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF]+\s*/igu, '');
  t = t.replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}\u2600-\u27BF]+$/igu, '');

  // Final trim of ends only
  return t.trim();
}

// ---------- Map & time parsing ----------

/** Ensure map has dod_ prefix; lowercased. */
function normalizeMapToken_(m) {
  if (!m) return '';
  let x = String(m).trim().toLowerCase();
  if (!/^dod_/.test(x)) x = 'dod_' + x.replace(/^dod[-_]?/, '');
  return x;
}

/** Extract map from text; if absent, use alignedWeek.map (if provided). */
function mapFromText_(text, alignedWeek) {
  const s = String(text || '');
  // prefer explicit dod_* token
  let m = s.match(/\b(dod[_-][a-z0-9_]+)\b/i);
  if (m) return normalizeMapToken_(m[1]);
  // allow bare map token (letters/underscores/digits), try to avoid matching team names — just take the first after 'dod' hint
  m = s.match(/\b(?:map|on)\s+([a-z0-9_]{3,})\b/i);
  if (m) return normalizeMapToken_(m[1]);
  // default to aligned week map
  if (alignedWeek && alignedWeek.map) return normalizeMapToken_(alignedWeek.map);
  return '';
}

/** Extract a time-ish string; if no am/pm, assume PM. Returns simple string. */
function whenStringFromText_(text) {
  const s = String(text || '');
  // common forms: 9, 9pm, 9:00, 9:30 pm, 21:00
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return '';
  let hh = m[1], mm = m[2] || '00', mer = (m[3] || '').toUpperCase();
  if (!mer) mer = 'PM'; // default PM if not specified
  // normalize hour to 1..12 if meridian provided
  let H = parseInt(hh,10);
  if (H < 1 || H > 12) {
    // if 24h form and no mer, convert to 12h-ish; else just keep H:mm
    if (!m[3] && H >= 13 && H <= 23) {
      mer = 'PM';
      if (H > 12) H -= 12;
    }
  }
  return `${H}:${mm} ${mer}`.replace(/\b0(\d):/,'$1:');
}

// ---------- Team pair extraction ----------

/**
 * Split message into two team blobs using vs|vs.|//|:versus: as delimiter.
 * Returns { leftRaw, rightRaw } or null.
 */
function splitTeams_(text) {
  const s = String(text || '');
  const SEP = /\s+(?:vs\.?|\/\/|:versus:)\s+/i;
  const parts = s.split(SEP);
  if (parts.length < 2) return null;
  return { leftRaw: parts[0], rightRaw: parts[1] };
}

/** Parse teams (canonicalized) from message text. */
function extractTeamsCanonical_(text) {
  const split = splitTeams_(text);
  if (!split) return null;
  const left = normalizeTeamInputToCanonical_(split.leftRaw);
  const right = normalizeTeamInputToCanonical_(split.rightRaw);
  return { teamA: left, teamB: right };
}

// ---------- Sheet row state helpers ----------

/** A row is COMPLETE if either W/L cell or either score cell is filled. */
function hasResult_(row){
  const wlHome  = String(row[COL_T1_RESULT-1] || '').trim();
  const wlAway  = String(row[COL_T2_RESULT-1] || '').trim();
  const scHome  = String(row[COL_T1_SCORE-1]  || '').trim();
  const scAway  = String(row[COL_T2_SCORE-1]  || '').trim();
  return !!(wlHome || wlAway || scHome || scAway);
}

/**
 * Find a match in the provided week's block for a division.
 * If requirePending, only return rows with no W/L and no scores.
 * Returns { rowIndex, absRow, rowValues, division, t1, t2, weekObject } or null.
 */
function locateMatchInWeek_(division, week, teamA, teamB, requirePending){
  const sh  = getDivSheet_(division);
  const blk = week && week.blocks && week.blocks[division];
  if (!sh || !blk || !blk.top) return null;

  const vals = sh.getRange(blk.top, 1, GRID.matchesPerBlock, GRID.cols).getValues();
  const A = String(teamA||'').toUpperCase().trim();
  const B = String(teamB||'').toUpperCase().trim();

  for (let i=0;i<vals.length;i++){
    const r = vals[i];
    const home = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
    const away = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
    if (!home || !away) continue;

    const isPair = (home===A && away===B) || (home===B && away===A);
    if (!isPair) continue;

    if (requirePending && hasResult_(r)) continue;

    return {
      rowIndex: i,
      absRow: blk.top + 2 + i,
      rowValues: r,
      division,
      t1: home,
      t2: away,
      weekObject: week
    };
  }
  return null;
}

/**
 * Load all weekly blocks for a division sheet.
 * Each block is 11 rows tall:
 *   - Map at col A, row startRow
 *   - Date at col A, row startRow+1
 *   - Matches from startRow+2 down to startRow+11
 *
 * @param {string} division "Bronze"|"Silver"|"Gold"
 * @return {Array<{startRow:number,map:string,date:Date,weekName:string}>}
 */
function loadAllBlocks_(division) {
  const sh = getDivSheet_(division);
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  const blocks = [];

  // Walk down from first block (row 28), each block is 11 rows
  for (let start = 28; start <= lastRow; start += 11) {
    const mapCell  = String(sh.getRange(start, 1).getValue() || '').trim();
    const dateCell = sh.getRange(start + 1, 1).getValue();
    if (!mapCell) continue; // skip empty rows

    const mapNorm = mapCell.toLowerCase();
    let dateObj = null;
    if (dateCell) {
      try {
        dateObj = (dateCell instanceof Date) ? dateCell : new Date(dateCell);
      } catch (_) {}
    }

    const weekName = String(sh.getRange(start - 1, 1).getValue() || '').trim(); // row 27, 38, 49... holds header

    blocks.push({
      startRow: start,
      map: mapNorm,
      date: dateObj,
      weekName
    });
  }

  return blocks;
}


/**
 * Search all historical blocks for the FIRST pending match between teamA & teamB.
 * Skips rows that have results. Optionally skip a specific weekKey.
 */
function findPendingMatchAcrossHistory_(division, teamA, teamB, skipWeekKey){
  const sh = getDivSheet_(division); if (!sh) return null;
  const blocks = loadAllBlocks_(division); if (!blocks || !blocks.length) return null;

  const A = String(teamA||'').toUpperCase().trim();
  const B = String(teamB||'').toUpperCase().trim();

  for (const b of blocks){
    const fakeWeek = {
      date: b.date,
      map: b.map,
      headerWeekName: b.weekName || '',
      blocks: { [division]: { top: b.startRow } }
    };
    const wkKey = weekKey_(fakeWeek);
    if (skipWeekKey && wkKey === skipWeekKey) continue;

    const vals = sh.getRange(b.startRow, 1, GRID.matchesPerBlock, GRID.cols).getValues();
    for (let i=0;i<vals.length;i++){
      const r = vals[i];
      const home = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
      const away = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
      if (!home || !away) continue;
      const isPair = (home===A && away===B) || (home===B && away===A);
      if (!isPair) continue;
      if (hasResult_(r)) continue; // only pending rows
      return {
        rowIndex: i,
        absRow: b.startRow + 2 + i,
        rowValues: r,
        division,
        t1: home,
        t2: away,
        weekObject: fakeWeek
      };
    }
  }
  return null;
}

/** Prefer aligned-week pending row; else earliest pending in history. */
function locatePendingMatchAlignedThenHistory_(division, alignedWeek, teamA, teamB){
  const alignedKey = alignedWeek ? weekKey_(alignedWeek) : null;
  const inAligned = alignedWeek ? locateMatchInWeek_(division, alignedWeek, teamA, teamB, true) : null;
  if (inAligned) return { located: inAligned, from: 'aligned' };
  const inHistory = findPendingMatchAcrossHistory_(division, teamA, teamB, alignedKey);
  if (inHistory) return { located: inHistory, from: 'history' };
  return { located: null, from: null };
}

// ---------- Top-level message parser ----------

/**
 * Parse a scheduling message. Division is optional (explicit tokens allowed).
 * Map is optional (defaults to aligned week's map). Team order flexible.
 *
 * Returns:
 *  {
 *    teamA, teamB,              // canonical team names (UPPERCASE)
 *    map,                       // normalized map (dod_*)
 *    when,                      // simple time string ('9:00 PM') or ''
 *    division,                  // 'Bronze'|'Silver'|'Gold' or null (explicit only)
 *    divisionExplicit           // boolean (true if division token present)
 *  } or null
 */
function parseScheduleMessage_(text, alignedWeekOpt) {
  const raw = String(text || '');
  const divisionToken = divisionFromText_(raw); // explicit token if present
  const alignedWeek = alignedWeekOpt || getAlignedUpcomingWeekOrReport_();

  // Teams
  const teams = extractTeamsCanonical_(raw);
  if (!teams || !teams.teamA || !teams.teamB) return null;

  // Map (may be omitted)
  const map = mapFromText_(raw, alignedWeek);

  // When
  const when = whenStringFromText_(raw) || '';

  return {
    teamA: teams.teamA,
    teamB: teams.teamB,
    map,
    when,
    division: divisionToken || null,
    divisionExplicit: !!divisionToken
  };
}