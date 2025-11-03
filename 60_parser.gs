// =======================
// 60_parser.gs - Schedule Message Parsing
// =======================
// Purpose: Parse Discord messages, extract teams/dates/maps, match teams
// Dependencies: 00_config.gs, 05_util.gs, 20_sheets.gs, 40_logging.gs
// Used by: 30_relay.gs (event handlers), 70_updates.gs
//
// Functions in this module:
// - _getMapAliasCatalog_()
// - _aliasesForMap_(canon)
// - _extractMapHint_(text)
// - _teamSynonyms_()
// - _stripDiscordNoise_(s)
// - _extractDivisionHint_(s)
// - _splitVsSides_(s)
// - _stripOrdinalSuffixes_(rawDate)
// - _cleanScheduleText_(raw)
// - resolveTeamAlias_(rawInput)
// - _matchTeam_(snippet, forcedDivision)
// - _normalizeTeamText_(s)
// - normalizeTeam_(s)
// - _scoreTeamMatch_(a, b)
// - _parseWhenFlexible_(s, hintDiv, hintMap)
// - _buildWeekListFromSheets_()
// - _chooseWeekForPair_(division, home, away, weekList, hintMap, rawText, when)
// - _findWeekByMapAndPair_(division, map, home, away, weekList)
// - _findWeekByDateAndPair_(division, dateObj, home, away, weekList)
// - _findPastUnplayedWeekForPair_(division, home, away, weekList)
// - _isSameWeek_(d1, d2)
// - _hasTeamsInWeek_(week, home, away)
// - _pollAndProcessFromId_(channelId, startId, opt)
// - _processOneDiscordMessage_(msg)
// - parseScheduleMessage_v3(text)
//
// Total: 25 functions
// =======================
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

  // Split on: vs, vs., v., //, -, or semicolon
  var parts = norm.split(/\bvs\.?\b| v\. |\/\/| - |;/i);
  if (parts.length < 2) return null;


  var a = parts[0], b = parts.slice(1).join(' ');
  a = a.replace(/^(bronze|silver|gold)\s*:?\s*/i, '').trim();
  b = b.replace(/^(bronze|silver|gold)\s*:?\s*/i, '').trim();

  // Strip common date/time patterns from side B
  // Patterns: "Sunday 11/2", "9:00 EST", "26/10 21h", "9pm EDT", etc.
  b = b.replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b.*/i, '').trim();
  b = b.replace(/\b\d{1,2}[:/]\d{1,2}.*$/i, '').trim(); // Times like 9:00, 21h
  b = b.replace(/\b\d{1,2}\s*(am|pm|est|edt|cet|brt).*$/i, '').trim(); // 9pm EST, 4pm est
  b = b.replace(/\b\d{1,2}\/\d{1,2}.*$/i, '').trim(); // Dates like 26/10, 11/2

  // Strip trailing punctuation and lowercase 'the'
  a = a.replace(/^the\s+/i, '').replace(/[!?.]+$/, '').trim();
  b = b.replace(/^the\s+/i, '').replace(/[!?.;]+$/, '').trim();


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
  __TEAM_INDEX_CACHE = null; // Clear team index cache too
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

/** Normalize team name for match key generation (alias to _normalizeTeamText_) */
function normalizeTeam_(s) {
  return _normalizeTeamText_(s);
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

/** Build a list of all weeks from all division sheets */
function _buildWeekListFromSheets_() {
  var weeks = [];
  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze', 'Silver', 'Gold'];
  var G = _gridMeta_();

  for (var d = 0; d < divs.length; d++) {
    var divName = divs[d];
    var sheet = (typeof getSheetByName === 'function') ? getSheetByName(divName) : null;
    if (!sheet) continue;

    // Scan all week blocks in this division
    for (var idx = 0; idx < 20; idx++) { // Assume max 20 weeks
      var mapRow = G.firstMapRow + idx * G.stride;
      var dateRow = G.firstDateRow + idx * G.stride;

      if (mapRow > sheet.getLastRow()) break;

      var mapRef = sheet.getRange(mapRow, 1).getDisplayValue().trim();
      var dateTx = sheet.getRange(dateRow, 1).getDisplayValue().trim();

      if (!mapRef || !dateTx) continue; // No more weeks

      var date = (typeof _parseSheetDateET_ === 'function') ? _parseSheetDateET_(dateTx) : new Date(dateTx);
      if (!date) continue;

      weeks.push({
        division: divName,
        map: mapRef.toLowerCase(),
        date: date,
        top: G.firstMapRow + idx * G.stride - 1 // Header row is one above map row
      });
    }
  }

  return weeks;
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
  try {
    raw = msg.content;
    sendLog_(`👀 Message ID ${msg.id}: raw="${raw.slice(0, 100)}..."`);

    parsed = parseScheduleMessage_v3(raw);
    sendLog_(`🧪 Parsed: ${JSON.stringify(parsed)}`);

    if (!parsed || !parsed.ok || !parsed.team1 || !parsed.team2 || !parsed.division) {
      sendLog_(`⚠️ Skipped message ID: ${msg?.id} — unable to parse.`);
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
      sendLog_(`⚠️ Error writing to sheet: ${e.message}`);
    }

    const line = formatScheduleConfirmationLine_(parsed, parsed.row, msg.author?.id, msg.id);
    relayPost_('/reply', { channelId: String(RESULTS_LOG_CHANNEL_ID), content: line });

  }
  catch (e) {
    sendLog_(`❌ Error processing message ID ${msg?.id}: ${e.message}`);
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
  __TEAM_INDEX_CACHE = null; // Clear team index cache too
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

    // Build week list from spreadsheet (all weeks across all divisions)
    var weekList = _buildWeekListFromSheets_();

    // which block/week?
    var week = _chooseWeekForPair_(division, matchA.name, matchB.name, weekList, hintMap, raw, when);
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

    // For backwards compatibility, flatten first pair into top-level object
    return {
      ok: true,
      pairs: [pair],
      trace: trace,
      // Flattened properties from first pair for legacy callers
      division: pair.division,
      team1: pair.home,
      team2: pair.away,
      whenText: pair.whenText,
      weekKey: pair.weekKey,
      epochSec: pair.epochSec,
      row: week.top ? week.top + 1 : null // First match row in the week block
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), trace: trace };
  }
}


