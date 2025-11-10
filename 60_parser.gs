// =======================
// 60_parser.gs - Schedule Message Parsing
// =======================
// Purpose: Parse Discord messages, extract teams/dates/maps, match teams
// Dependencies: 00_config.gs, 05_util.gs, 20_sheets.gs, 40_logging.gs
// Used by: 30_relay.gs (event handlers), 70_updates.gs
//
// Functions in this module:
// Map/Division/Team extraction:
//   getMapAliasCatalog, aliasesForMap, extractMapHint, teamSynonyms
//   stripDiscordNoise, extractDivisionHint, splitVsSides
// Text processing & matching:
//   stripOrdinalSuffixes, cleanScheduleText, resolveTeamAlias
//   matchTeam, scoreTeamMatch, parseWhenFlexible
// Week matching logic:
//   buildWeekListFromSheets, chooseWeekForPair, findWeekByMapAndPair
//   findWeekByDateAndPair, findPastUnplayedWeekForPair, findWeekByMessageTime
//   isSameWeek, hasTeamsInWeek
// Message processing:
//   pollAndProcessFromId, processOneDiscordMessage, parseScheduleMessage_v3
//
// Total: 24 functions
// =======================
// Note: DEBUG_PARSER flag is now in 00_config.gs

// ---- BATCH-LEVEL PERFORMANCE CACHES ----
// These caches persist for the entire batch run (multiple messages)
// Cleared at the start of each batch to ensure fresh data
var BATCH_WEEK_LIST_CACHE = null;      // Caches buildWeekListFromSheets() result (~180 sheet reads saved per message!)
// Note: Team caches (TEAM_ALIAS_CACHE, TEAM_INDEX_CACHE) are defined in 05_util.gs
//
// CACHE SAFETY: The week list cache stores ONLY static match structure (teams, maps, dates, row numbers).
// It does NOT cache scheduled times, scores, or W/L status - those come from column E and the store.
// Therefore, the cache remains valid when you schedule matches (only column E + store are updated).
// Cache should only be cleared when: 1) Starting new batch, 2) Adding new weeks/playoffs to sheets

/**
 * Build alias→canon map from the General sheet list. Cached per execution.
 * @returns {Object} Map of aliases to canonical map names
 */
function getMapAliasCatalog() {
  var canonList = (typeof getAllMapsList === 'function') ? getAllMapsList() : [];
  var aliasToCanon = {};
  for (var i = 0; i < canonList.length; i++) {
    var canon = String(canonList[i] || '').trim();
    if (!canon) continue;
    var aliases = aliasesForMap(canon);
    for (var j = 0; j < aliases.length; j++) {
      aliasToCanon[aliases[j]] = canon; // last wins (fine)
    }
  }
  return aliasToCanon;
}

/**
 * Generate useful aliases for a canonical map id like "dod_railyard_b6".
 * @param {string} canon - Canonical map name
 * @returns {string[]} Array of aliases (with/without dod_, with/without version suffix, etc.)
 */
function aliasesForMap(canon) {
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
 * @param {string} text - Text to search for map name
 * @returns {string|null} Canonical map name or null if not found
 */
function extractMapHint(text) {
  var t = String(text || '').toLowerCase();
  // relaxed version where underscores and hyphens are treated like spaces
  var relax = t.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  var aliasToCanon = getMapAliasCatalog();
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

/**
 * Strip map hint from text (e.g., remove "dod_railyard_b6" from message).
 * Uses both the alias catalog AND a fallback pattern for dod_* maps.
 * @param {string} text - Text to clean
 * @returns {string} Text with map hint removed
 */
function stripMapHint(text) {
  var t = String(text || '');

  // First, try catalog-based removal (accurate)
  var aliasToCanon = getMapAliasCatalog();
  var aliases = Object.keys(aliasToCanon);

  // Sort longest first to avoid partial overshadowing
  aliases.sort(function (a, b) { return b.length - a.length; });

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  for (var i = 0; i < aliases.length; i++) {
    var alias = aliases[i];

    // Build a regex that matches the alias as words, allowing underscores or spaces
    var pattern = '\\b' + esc(alias).replace(/_/g, '[ _]*') + '\\b';
    var re = new RegExp(pattern, 'gi');

    // Remove the map name and clean up extra whitespace
    t = t.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }

  // Fallback: Remove any dod_* pattern (map names not yet in catalog)
  // Matches: dod_mapname, dod_mapname_b6, dod_map_name_b12, etc.
  var dodPattern = /\bdod_[a-z0-9_]+\b/gi;
  t = t.replace(dodPattern, ' ').replace(/\s+/g, ' ').trim();

  return t;
}

/**
 * Optional team synonym map from Script Properties (JSON).
 * @returns {Object} Map of team synonyms or empty object if not configured
 */
function teamSynonyms() {
  try {
    var sp = PropertiesService.getScriptProperties().getProperty('TEAM_SYNONYMS_JSON');
    return sp ? JSON.parse(sp) : {};
  } catch (_) { return {}; }
}

/**
 * Strip Discord formatting noise (mentions, emojis, channels) from text.
 * @param {string} s - Text to clean
 * @returns {string} Cleaned text with Discord markup removed
 */
function stripDiscordNoise(s) {
  var t = String(s || '');

  // Convert versus-related emojis to standard " vs " delimiter before stripping other emojis
  t = t.replace(/<a?:versus:\d+>/gi, ' vs ')   // <:versus:123> or <a:versus:123> (static or animated)
    .replace(/:versus:/gi, ' vs ')             // :versus: shortcode (text)
    .replace(/\ud83c\udd9a/g, ' vs ')          // 🆚 VS Button emoji (Unicode)
    .replace(/⚔️/g, ' vs ')                    // Crossed swords emoji (alternative)
    .replace(/\u2694\ufe0f/g, ' vs ');        // Crossed swords (variant)

  // Convert common flag emoji shortcodes to Unicode (for team identification)
  // Captains often use flag emojis as team shortcuts - preserve them as Unicode
  t = t.replace(/:flag_([a-z]{2}):/gi, function(match, code) {
    // Convert country code to regional indicator symbols (flag emoji)
    // e.g., :flag_ch: → 🇨🇭 (CH), :flag_us: → 🇺🇸 (US)
    var upper = code.toUpperCase();
    var regionalA = String.fromCodePoint(0x1F1E6 + upper.charCodeAt(0) - 65);
    var regionalB = String.fromCodePoint(0x1F1E6 + upper.charCodeAt(1) - 65);
    return regionalA + regionalB;
  });

  // Convert custom Discord emojis to just the name (for team identification via aliases)
  // e.g., <:emo:123> → emo, <a:Team_Emo:456> → Team_Emo (static or animated)
  // Handles both static (<:name:id>) and animated (<a:name:id>) Discord emojis
  // Teams can then be identified by emoji name in _Aliases sheet
  // Supports special characters: letters, numbers, _, -, ~, !, etc.
  t = t.replace(/<a?:([a-z0-9_\-~!.]+):\d+>/gi, function(match, name) {
    return ' ' + name + ' ';
  });

  // remove mentions <@123>, <@!123>, <@&role>, <#channel>
  t = t.replace(/<[@#][!&]?\d+>/g, ' ');

  // remove OTHER emoji shortcodes :emoji: (but versus, flags, and custom Discord emojis were already handled above)
  t = t.replace(/:[a-z0-9_]+:/gi, ' ');

  // collapse multiple spaces
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Extract division hint from text (Bronze/Silver/Gold).
 * @param {string} s - Text to search for division name
 * @returns {string|null} Division name (capitalized) or null if not found
 */
function extractDivisionHint(s) {
  var m = s.match(/\b(bronze|silver|gold)\b\s*:?/i);
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : null;
}

/**
 * Enhanced splitVsSides to handle "between A and B" and strip division hints.
 * Splits matchup text into two teams, handling various separators (vs, vs., //, -, ;).
 * @param {string} s - Matchup text (e.g., "Team A vs Team B")
 * @returns {Object|null} {a: homeTeam, b: awayTeam} or null if cannot split
 */
function splitVsSides(s) {
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

  // Strip common filler words used before times (e.g., "default 9pm", "usual time", "normal time")
  a = a.replace(/\b(default|usual|normal|regular|standard|typical)\b.*$/i, '').trim();
  b = b.replace(/\b(default|usual|normal|regular|standard|typical)\b.*$/i, '').trim();

  return { a: a, b: b };
}

/**
 * Normalize ordinal suffixes in dates (e.g., 12th → 12).
 * @param {string} rawDate - Date string that may contain ordinals
 * @returns {string} Date string with ordinals removed
 */
function stripOrdinalSuffixes(rawDate) { return rawDate.replace(/(\d+)(st|nd|rd|th)/gi, '$1') }

/**
 * Sanitize raw text for parsing (ignore second timezones, remove foreign weekday mentions).
 * @param {string} raw - Raw schedule text
 * @returns {string} Cleaned text ready for parsing
 */
function cleanScheduleText(raw) {
  return raw
    .replace(/\/\s*Domingo.*$/i, '')
    .replace(/\b\d{1,2}:\d{2}\s*(BRT|CET|UTC|GMT|JST|PST|PT|ART|IST).*/gi, '')
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/tentative|confirm.*later|likely postponed|we'?ll confirm/gi, '');
}

/**
 * Enhanced Team Alias Resolver - resolves team names using _Aliases sheet.
 * @param {string} rawInput - Raw team name input
 * @returns {string} Canonical team name or original input if no alias found
 */
function resolveTeamAlias(rawInput) {
  // Don't clear caches - let them persist across messages in the same batch for performance
  const aliasMap = loadTeamAliases();
  const upper = String(rawInput || '').trim().toUpperCase();
  return aliasMap[upper] || rawInput;
}

/**
 * Enhanced matchTeam to use aliases - fuzzy match team name to team index.
 * @param {string} snippet - Team name snippet to match
 * @param {string} forcedDivision - Optional division to restrict search to
 * @returns {Object|null} {name: teamName, division: divisionName} or null if no match
 */
function matchTeam(snippet, forcedDivision) {
  var idx = (typeof getTeamIndexCached === 'function') ? getTeamIndexCached() : null;
  if (!idx || !idx.teams || !idx.teams.length) return null;

  var syn = teamSynonyms();

  // Try resolving the full snippet first
  var resolved = resolveTeamAlias(snippet);
  var s = normalizeTeamText(resolved);
  if (syn[s]) s = normalizeTeamText(syn[s]);

  // If full snippet didn't resolve to an alias, try each word individually
  // This handles cases like "Team_Thunder THUNDER" where captain uses emoji + text
  if (resolved === snippet && snippet.indexOf(' ') > -1) {
    var words = snippet.split(/\s+/);
    for (var w = 0; w < words.length; w++) {
      var wordResolved = resolveTeamAlias(words[w]);
      if (wordResolved !== words[w]) {
        // Found an alias match for this word
        resolved = wordResolved;
        s = normalizeTeamText(resolved);
        if (syn[s]) s = normalizeTeamText(syn[s]);
        break;
      }
    }
  }


  var best = null, bestScore = -1;
  for (var i = 0; i < idx.teams.length; i++) {
    var t = idx.teams[i];
    if (forcedDivision && String(t.division || '').toLowerCase() !== String(forcedDivision || '').toLowerCase()) continue;


    var cand = normalizeTeamText(t.name);
    var sc = scoreTeamMatch(s, cand);
    if (Array.isArray(t.aliases)) {
      for (var j = 0; j < t.aliases.length; j++) {
        var al = normalizeTeamText(t.aliases[j]);
        sc = Math.max(sc, scoreTeamMatch(s, al));
      }
    }
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  if (!best || bestScore < 2) return null;
  return { name: best.name, division: best.division };
}

/**
 * Score how well two team name strings match.
 * @param {string} a - First team name (normalized)
 * @param {string} b - Second team name (normalized)
 * @returns {number} Match score (higher is better, 10 = exact match)
 */
function scoreTeamMatch(a, b) {
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

/**
 * Parse flexible date/time text into structured when data.
 * @param {string} s - Date/time text to parse
 * @param {string} hintDiv - Optional division hint for context
 * @param {string} hintMap - Optional map hint for context
 * @param {Date} referenceDate - Optional reference date for interpreting relative dates (defaults to now)
 * @returns {Object} {whenText: string, epochSec?: number} or {whenText: 'TBD'}
 */
function parseWhenFlexible(s, hintDiv, hintMap, referenceDate) {
  var tz = 'America/New_York';
  var lower = s.toLowerCase();
  var refDate = referenceDate || new Date();

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
    var baseYear = yy || refDate.getFullYear();
    dateObj = new Date(baseYear, mm - 1, dd);
  }

  // 4.2 textual month (october 5(th))
  if (!dateObj) {
    var monMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    var mM = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/);
    if (mM) {
      var mon = monMap[mM[1]]; var d = +mM[2]; var y = mM[3] ? +mM[3] : refDate.getFullYear();
      dateObj = new Date(y, mon, d);
    }
  }

  // 4.3 "Sunday 1530 est" or "Monday 15th 10pm"
  var dowIdx = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, thur: 4, fri: 5, sat: 6 };
  var mDow = lower.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/);
  if (!dateObj && mDow) {
    var targetDow = dowIdx[mDow[1].slice(0, 3)];
    var d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
    var delta = (targetDow - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "this Sunday" usually means upcoming
    d.setDate(d.getDate() + delta);

    // If we also have "15th|5th" day-of-month, align to that in current/next month
    var mNth = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
    if (mNth) {
      var nth = +mNth[1];
      var try1 = new Date(d.getFullYear(), d.getMonth(), nth);
      var try2 = new Date(d.getFullYear(), d.getMonth() + 1, nth);
      // choose the one that matches the desired dow and is not in the past (relative to refDate)
      var refTime = refDate.getTime();
      var cand = [try1, try2].filter(function (x) { return x.getDay() === targetDow && x.getTime() >= refTime; }).sort(function (a, b) { return a - b; })[0];
      if (cand) d = cand;
    }
    // Don't use Date.UTC - keep as local date, we'll handle timezone in the final formatting
    dateObj = d;
  }

  // time: "9est", "9:30 pm", "1530 est", "10east"
  // Require am/pm/est to be present to avoid matching day numbers like "15th"
  var mT = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|est|et|edt|east)\b/);
  var hh = 21, mm = 0; // default 9:00 PM if unspecified (your rule)
  if (mT) {
    hh = +mT[1];
    mm = mT[2] ? +mT[2] : 0;
    var tz = mT[3] ? mT[3].toLowerCase() : '';
    var ap = '';
    if (tz === 'am' || tz === 'pm') {
      ap = tz;
    } else if (!ap && hh <= 12) {
      ap = 'pm'; // default PM when ambiguous
    }
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }

  // If still no date, but we have a division/map hint → use that week's default Sunday
  if (!dateObj) {
    var wk = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : {};
    if (typeof syncHeaderMetaToTables === 'function') wk = syncHeaderMetaToTables(wk, hintDiv || 'Bronze');
    if (wk && wk.date) {
      dateObj = wk.date;
    }
  }
  if (!dateObj) return null;

  // Build ET datetime at hh:mm
  var y = dateObj.getFullYear();
  var m = dateObj.getMonth();
  var d = dateObj.getDate();

  // Build ISO string with explicit ET timezone offset
  // Determine if this date is in EDT (UTC-4) or EST (UTC-5)
  var testDate = new Date(Date.UTC(y, m, d, 12, 0, 0));
  var offset = Utilities.formatDate(testDate, tz, 'Z'); // Returns "-0400" or "-0500"

  // Build ISO 8601 string: "2025-09-15T22:00:00-04:00"
  var isoStr = y + '-' +
    ('0' + (m + 1)).slice(-2) + '-' +
    ('0' + d).slice(-2) + 'T' +
    ('0' + hh).slice(-2) + ':' +
    ('0' + mm).slice(-2) + ':00' +
    offset.slice(0, 3) + ':' + offset.slice(3); // Convert "-0400" to "-04:00"

  var dt = new Date(isoStr);
  var epoch = Math.floor(dt.getTime() / 1000);

  // Include date in format: "3:00 PM ET 9/15"
  var whenText = Utilities.formatDate(dt, tz, 'h:mm a') + ' ET ' + Utilities.formatDate(dt, tz, 'M/d');
  return { epochSec: epoch, whenText: whenText };
}

/**
 * Build a list of all weeks from all division sheets.
 * Includes matches array for each week to enable matchup searching.
 * Uses batch-level cache to avoid redundant sheet reads (major performance improvement).
 * @param {boolean} forceRefresh - Force cache refresh (optional, defaults to false)
 * @returns {Array} Array of week objects {division, map, date, defaultDate, top, matches: [{home, away}]}
 */
function buildWeekListFromSheets(forceRefresh) {
  // Check batch cache first (huge performance gain - avoids ~180 sheet reads per message)
  if (!forceRefresh && BATCH_WEEK_LIST_CACHE) {
    return BATCH_WEEK_LIST_CACHE;
  }

  var weeks = [];
  var divs = (typeof getDivisionSheets === 'function') ? getDivisionSheets() : ['Bronze', 'Silver', 'Gold'];
  var G = gridMeta();

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

      var date = (typeof parseSheetDateET === 'function') ? parseSheetDateET(dateTx) : new Date(dateTx);
      if (!date) continue;

      var top = G.firstMapRow + idx * G.stride - 1; // Header row is one above map row

      // Read match grid (10 rows starting from mapRow - map/date rows also contain matches)
      var gridStartRow = mapRow;
      var matches = [];
      try {
        var matchData = sheet.getRange(gridStartRow, COL_T1_NAME, 10, 5).getDisplayValues(); // C..G (home, sched, away columns)
        for (var r = 0; r < matchData.length; r++) {
          var homeTeam = matchData[r][0].trim(); // Column C
          var awayTeam = matchData[r][4].trim(); // Column G
          if (homeTeam && awayTeam) {
            matches.push({ home: homeTeam, away: awayTeam });
          }
        }
        // Debug: Log first week's matches for each division
        if (DEBUG_PARSER && typeof sendLog === 'function' && idx === 0) {
          sendLog(`📋 ${divName} Week 1 (${mapRef}, ${dateTx}): ${matches.length} matches`);
          if (matches.length > 0) {
            sendLog(`   First match: ${matches[0].home} vs ${matches[0].away}`);
          }
        }
      } catch (e) {
        // If reading fails, just create an empty matches array
        if (typeof sendLog === 'function') {
          sendLog(`⚠️ Failed to read matches for ${divName} week ${idx}: ${e.message}`);
        }
      }

      weeks.push({
        division: divName,
        map: mapRef.toLowerCase(),
        date: date,
        defaultDate: date, // Add this for compatibility
        top: top,
        matches: matches
      });
    }
  }

  // Cache the result for subsequent messages in this batch
  BATCH_WEEK_LIST_CACHE = weeks;
  return weeks;
}

/**
 * Enhanced chooseWeekForPair with weekList threaded into helpers.
 * Choose the correct week block for a match based on map hint, date, or context.
 * @param {string} division - Division name
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {Array} weekList - List of all weeks from buildWeekListFromSheets()
 * @param {string} hintMap - Optional map hint
 * @param {string} rawText - Original raw text for context clues
 * @param {Object} when - Optional when object {epochSec, whenText}
 * @param {Date} messageDate - Optional Discord message timestamp for historical matching
 * @returns {Object} Week metadata object with weekKey, map, date, etc.
 */
function chooseWeekForPair(division, home, away, weekList, hintMap, rawText, when, messageDate) {
  var wk = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : {};
  if (typeof syncHeaderMetaToTables === 'function') wk = syncHeaderMetaToTables(wk, division || 'Bronze');

  // 1. Try map hint first (most explicit)
  if (hintMap) {
    var wByMap = findWeekByMapAndPair(division, hintMap, home, away, weekList);
    if (wByMap) return wByMap;
  }

  // 2. Try date hint from parsed time
  if (when && typeof when.epochSec === 'number') {
    var d = new Date(when.epochSec * 1000);
    if (DEBUG_PARSER && typeof sendLog === 'function') {
      sendLog(`🔎 Step 2: Trying date matching for ${home} vs ${away} on ${d.toISOString()}`);
    }
    var wByDate = findWeekByDateAndPair(division, d, home, away, weekList);
    if (wByDate) {
      if (DEBUG_PARSER && typeof sendLog === 'function') sendLog(`✅ Step 2: Found week by date`);
      return wByDate;
    } else {
      if (DEBUG_PARSER && typeof sendLog === 'function') sendLog(`❌ Step 2: No week found by date (matchup may not exist in that week)`);
    }
  }

  // 3. Check for make-up keywords
  var lower = String(rawText || '').toLowerCase();
  if (/\b(make[- ]?up|postponed|rematch)\b/.test(lower)) {
    var wPast = findPastUnplayedWeekForPair(division, home, away, weekList);
    if (wPast) return wPast;
  }

  // 4. NEW: Use message timestamp as fallback for historical parsing
  if (messageDate && typeof findWeekByMessageTime === 'function') {
    if (DEBUG_PARSER && typeof sendLog === 'function') {
      sendLog(`🔎 Step 4: Trying message timestamp matching for ${home} vs ${away} (msg posted ${messageDate.toISOString()})`);
    }
    var wByMsgTime = findWeekByMessageTime(division, messageDate, home, away, weekList);
    if (wByMsgTime) {
      if (DEBUG_PARSER && typeof sendLog === 'function') sendLog(`✅ Step 4: Found week by message timestamp`);
      return wByMsgTime;
    } else {
      if (DEBUG_PARSER && typeof sendLog === 'function') sendLog(`❌ Step 4: No week found by message timestamp (matchup may not exist in any week)`);
    }
  }

  // 5. Final fallback: current week
  if (DEBUG_PARSER && typeof sendLog === 'function') {
    sendLog(`⚠️ Step 5: Falling back to current week (no historical match found)`);
  }
  return wk;
}

/**
 * Helper function to find week by map and team pair.
 * @param {string} division - Division name
 * @param {string} map - Map name
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {Array} weekList - List of all weeks
 * @returns {Object|null} Week object or null if not found
 */
function findWeekByMapAndPair(division, map, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  map = map.toLowerCase();
  return weekList.find(w => w.division === division && w.map.toLowerCase() === map && hasTeamsInWeek(w, home, away));
}

/**
 * Helper function to find week by date and team pair.
 * Finds the week CLOSEST to the target date that has this matchup (for historical parsing).
 * @param {string} division - Division name
 * @param {Date} dateObj - Date object to match against
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {Array} weekList - List of all weeks
 * @returns {Object|null} Week object or null if not found
 */
function findWeekByDateAndPair(division, dateObj, home, away, weekList) {
  if (!Array.isArray(weekList) || !dateObj) return null;

  var targetTime = dateObj.getTime();
  var candidates = [];

  // Find all weeks with this matchup
  for (var i = 0; i < weekList.length; i++) {
    var w = weekList[i];
    if (w.division !== division) continue;
    if (!hasTeamsInWeek(w, home, away)) continue;

    var weekDate = new Date(w.defaultDate || w.date);
    var weekTime = weekDate.getTime();

    // Calculate time distance from target date (absolute value)
    var timeDiff = Math.abs(weekTime - targetTime);

    candidates.push({
      week: w,
      weekTime: weekTime,
      timeDiff: timeDiff
    });
  }

  if (candidates.length === 0) return null;

  // Sort by CLOSEST to target date (smallest time difference)
  candidates.sort(function(a, b) {
    return a.timeDiff - b.timeDiff;
  });

  if (DEBUG_PARSER && typeof sendLog === 'function') {
    var chosen = candidates[0];
    var chosenDate = new Date(chosen.weekTime);
    var targetDate = new Date(targetTime);
    var daysDiff = Math.round(chosen.timeDiff / (24 * 60 * 60 * 1000));
    sendLog(`✅ Chose week ${daysDiff} days from target date (${targetDate.toISOString().slice(0, 10)} → ${chosenDate.toISOString().slice(0, 10)})`);
  }

  return candidates[0].week;
}

/**
 * Helper function to find a past unplayed week for a team pair (for make-ups/rematches).
 * @param {string} division - Division name
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {Array} weekList - List of all weeks
 * @returns {Object|null} Week object or null if not found
 */
function findPastUnplayedWeekForPair(division, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  for (var i = 0; i < weekList.length; i++) {
    var wk = weekList[i];
    if (wk.division !== division) continue;
    if (hasTeamsInWeek(wk, home, away) && !wk.played) return wk;
  }
  return null;
}

/**
 * Find week for a team pair based on Discord message timestamp.
 * Finds the week CLOSEST to the message date that has this matchup (for historical parsing).
 * Used as fallback when message has no map/date hints.
 * @param {string} division - Division name
 * @param {Date} messageDate - Date when the Discord message was posted
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {Array} weekList - List of all weeks
 * @returns {Object|null} Week object or null if not found
 */
function findWeekByMessageTime(division, messageDate, home, away, weekList) {
  if (!Array.isArray(weekList) || !messageDate) return null;

  var msgTime = messageDate.getTime();
  var candidates = [];

  if (DEBUG_PARSER && typeof sendLog === 'function') {
    sendLog(`🔍 findWeekByMessageTime: Looking for ${home} vs ${away} in ${division}, total weeks: ${weekList.length}`);
  }

  // Find all weeks with this matchup in the division
  for (var i = 0; i < weekList.length; i++) {
    var wk = weekList[i];
    if (wk.division !== division) continue;

    // Debug: Show what matches this week has
    if (DEBUG_PARSER && typeof sendLog === 'function' && i < 3) {
      var matchCount = wk.matches ? wk.matches.length : 0;
      var sample = wk.matches && wk.matches[0] ? (wk.matches[0].home + ' vs ' + wk.matches[0].away) : 'none';
      sendLog(`  Week ${i} (${wk.division}, ${wk.map}): ${matchCount} matches, sample: ${sample}`);
    }

    if (!hasTeamsInWeek(wk, home, away)) continue;

    var weekDate = new Date(wk.defaultDate || wk.date);
    var weekTime = weekDate.getTime();

    // Calculate time distance from message date (absolute value)
    var timeDiff = Math.abs(weekTime - msgTime);

    candidates.push({
      week: wk,
      weekTime: weekTime,
      timeDiff: timeDiff
    });
  }

  if (candidates.length === 0) return null;

  // Sort by CLOSEST to message date (smallest time difference)
  candidates.sort(function(a, b) {
    return a.timeDiff - b.timeDiff;
  });

  if (DEBUG_PARSER && typeof sendLog === 'function') {
    var chosen = candidates[0];
    var chosenDate = new Date(chosen.weekTime);
    var daysDiff = Math.round(chosen.timeDiff / (24 * 60 * 60 * 1000));
    sendLog(`✅ Chose week ${daysDiff} days from message date: ${chosenDate.toISOString().slice(0, 10)}`);
  }

  return candidates[0].week;
}

/**
 * Check if two dates are in the same week (Sunday-based).
 * @param {Date} d1 - First date
 * @param {Date} d2 - Second date
 * @returns {boolean} True if dates are in same week
 */
function isSameWeek(d1, d2) {
  var startOfWeek = date => {
    var day = new Date(date);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - day.getDay());
    return day;
  };

  return startOfWeek(d1).getTime() === startOfWeek(d2).getTime();
}

/**
 * Check if a week contains a specific match (by team names).
 * Checks both team orders since captains may schedule in either direction.
 * @param {Object} week - Week object with matches array
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @returns {boolean} True if week contains this matchup (in either order)
 */
function hasTeamsInWeek(week, home, away) {
  if (!week || !Array.isArray(week.matches)) return false;
  return week.matches.some(m =>
    (m.home === home && m.away === away) ||
    (m.home === away && m.away === home)
  );
}

/**
 * Poll and process Discord messages from a starting message ID.
 * Performance-optimized with batch limits and time monitoring.
 * @param {string} channelId - Discord channel ID to poll
 * @param {string} startId - Starting message ID
 * @param {Object} opt - Options {inclusive: boolean, maxProcess: number, maxTime: number, skipScheduled: boolean}
 * @returns {Object} {processed: number, updatedPairs: number, skippedPairs: number, errors: array, lastPointer: string, stoppedEarly: boolean, stopReason: string, elapsedMs: number}
 */
function pollAndProcessFromId(channelId, startId, opt) {
  var successCount = 0;
  var tentativeCount = 0;
  opt = opt || {};
  var inclusive = !!opt.inclusive;

  // Performance optimization: limit messages per execution
  var maxProcess = opt.maxProcess || POLL_MAX_MESSAGES_PER_RUN || 5;
  var startTime = Date.now();
  var maxTime = opt.maxTime || POLL_SOFT_DEADLINE_MS || 270000; // 4.5 minutes default

  var processed = 0;
  var updatedPairs = 0;
  var skippedPairs = 0;
  var errors = [];
  var lastId = startId ? String(startId) : '';
  var stoppedEarly = false;
  var stopReason = '';

  // Pass channelId through options for message link building
  opt.channelId = channelId;

  // Clear batch-level caches at start of batch for fresh data
  // This dramatically improves performance by avoiding ~180 sheet reads per message
  BATCH_WEEK_LIST_CACHE = null;

  // Clear team data caches (defined in 05_util.gs) to ensure fresh data per batch
  if (typeof TEAM_ALIAS_CACHE !== 'undefined') TEAM_ALIAS_CACHE = null;
  if (typeof TEAM_INDEX_CACHE !== 'undefined') TEAM_INDEX_CACHE = null;

  // 0) If inclusive: try to fetch/process the start message itself
  if (inclusive && startId) {
    try {
      var msg0 = fetchSingleMessageInclusive(channelId, String(startId)); // best-effort
      if (msg0) {
        try {
          var res0 = processOneDiscordMessage(msg0, startTime, opt);
          if (res0 && res0.updated) updatedPairs += res0.updated;
          if (res0 && res0.skipped) skippedPairs += res0.skipped;
          lastId = String(msg0.id || lastId);
        } catch (e) {
          errors.push('process ' + String(msg0.id) + ': ' + String(e && e.message || e));
        } finally {
          // Always increment processed count for the inclusive message
          processed++;
          if (DEBUG_PARSER && typeof logToSheet === 'function') {
            logToSheet(`📈 Processed inclusive message, count: ${processed}`);
          }
        }
      }
    } catch (e) {
      errors.push('inclusive fetch failed: ' + String(e && e.message || e));
    }
  }

  // 1) Now walk forward "after" the (possibly same) startId
  var cursor = startId || lastId || '';
  var pageLimit = 100; // how many to fetch per page (relay dependent)
  var loops = 0, SAFETY = 50; // don't infinite-loop

  while (loops++ < SAFETY) {
    // Check execution time before fetching next page
    if (typeof getRemainingTime === 'function') {
      var timeCheck = getRemainingTime(startTime, maxTime);
      if (timeCheck.shouldStop) {
        stoppedEarly = true;
        stopReason = 'time_limit';
        sendLog(`⏱️ Time limit approaching (${timeCheck.percentUsed}% used), stopping at ${processed} messages`);
        break;
      }
    }

    // Check batch limit
    if (processed >= maxProcess) {
      stoppedEarly = true;
      stopReason = 'batch_limit';
      sendLog(`📦 Batch limit reached (${maxProcess} messages), will resume in next execution`);
      break;
    }

    var page = [];
    try {
      // Your relay uses `after` semantics: returns messages with id > after
      page = fetchChannelMessages(channelId, { after: cursor, limit: pageLimit }) || [];
    } catch (e) {
      errors.push('fetch page failed: ' + String(e && e.message || e));
      break;
    }
    if (!page.length) break;

    // Ensure chronological (Discord often returns newest first)
    page.sort(function (a, b) { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; });

    for (var i = 0; i < page.length; i++) {
      // Check time and batch limits before processing each message
      if (processed >= maxProcess) {
        stoppedEarly = true;
        stopReason = 'batch_limit';
        sendLog(`📦 Batch limit reached (${maxProcess} messages)`);
        break;
      }

      if (typeof getRemainingTime === 'function') {
        var tc = getRemainingTime(startTime, maxTime);
        if (tc.shouldStop) {
          stoppedEarly = true;
          stopReason = 'time_limit';
          sendLog(`⏱️ Time limit approaching (${tc.percentUsed}% used), stopping at ${processed} messages`);
          break;
        }
      }

      var msg = page[i];
      try {
        var res = processOneDiscordMessage(msg, startTime, opt);
        if (res && res.updated) {
          updatedPairs += res.updated;
          if (res.tentative) tentativeCount++;
          else successCount++;
        }
        if (res && res.skipped) {
          skippedPairs += res.skipped;
        }
        lastId = String(msg.id || lastId);
      } catch (e) {
        errors.push('process ' + String(msg && msg.id) + ': ' + String(e && e.message || e));
      } finally {
        // Always increment processed count, whether success, skip, or error
        processed++;
        if (DEBUG_PARSER && typeof logToSheet === 'function') {
          logToSheet(`📈 Processed count incremented to: ${processed}`);
        }
      }
    }

    // If we stopped early in the inner loop, break outer loop too
    if (stoppedEarly) break;

    // advance cursor to last processed id
    cursor = lastId;
    // If fewer than pageLimit, we reached the end
    if (page.length < pageLimit) break;
  }

  // 2) Persist last pointer
  if (lastId) setPointer(lastId);

  // Calculate execution stats
  var elapsed = Date.now() - startTime;
  var elapsedSec = Math.round(elapsed / 1000);
  var percentUsed = Math.round((elapsed / maxTime) * 100);

  // Enhanced logging with stats
  logParsingSummary(successCount, tentativeCount, opt.channelName || 'match-alerts');

  if (stoppedEarly) {
    sendLog(`📊 Batch complete: ${processed} messages in ${elapsedSec}s (${percentUsed}% time used) - stopped: ${stopReason}`);
  } else {
    sendLog(`📊 Batch complete: ${processed} messages in ${elapsedSec}s (${percentUsed}% time used) - finished all available`);
  }

  return {
    processed: processed,
    updatedPairs: updatedPairs,
    skippedPairs: skippedPairs,
    errors: errors,
    lastPointer: lastId,
    stoppedEarly: stoppedEarly,
    stopReason: stopReason,
    elapsedMs: elapsed
  };
}

/**
 * Process one Discord message through: content → parse → update.
 * @param {Object} msg - Discord message object {id, content, author, channel}
 * @param {number} startTime - Start time timestamp for timeout prevention
 * @param {Object} options - Optional {skipScheduled: boolean}
 * @returns {Object} {updated: number, tentative?: boolean, parsed?: object, skipped?: boolean, reason?: string}
 */
function processOneDiscordMessage(msg, startTime, options) {
  options = options || {};
  if (!msg || !msg.content) return { updated: 0 };

  // Optional time check to prevent processing if we're running out of time
  if (startTime && typeof getRemainingTime === 'function') {
    var timeCheck = getRemainingTime(startTime);
    if (timeCheck.shouldStop) {
      sendLog(`⏱️ Skipping message ${msg.id} - time limit approaching`);
      return { updated: 0, skipped: true, reason: 'timeout_prevention' };
    }
  }

  let parsed = null;
  let raw = null;
  let isTentative = false;
  let isRematch = false;
  let updateResult = null;  // Declare here so it's accessible throughout the function
  try {
    raw = msg.content;

    // Log raw message to sheet (always log for parse failures to aid debugging)
    if (typeof logToSheet === 'function') {
      logToSheet(`👀 Message ID ${msg.id}: raw="${raw.slice(0, 150)}..."`);
    }

    // Extract timestamp from Discord message (if available)
    var messageDate = null;
    if (msg.timestamp) {
      // Discord provides ISO timestamp string
      messageDate = new Date(msg.timestamp);
      if (DEBUG_PARSER) sendLog(`📅 Message timestamp from msg.timestamp: ${messageDate.toISOString()}`);
    } else if (msg.id) {
      // Extract timestamp from Discord snowflake ID
      // Discord epoch is 2015-01-01T00:00:00.000Z (1420070400000 ms)
      var snowflake = BigInt(msg.id);
      var discordEpoch = 1420070400000;
      var timestampMs = Number(snowflake >> BigInt(22)) + discordEpoch;
      messageDate = new Date(timestampMs);
      if (DEBUG_PARSER) sendLog(`📅 Message timestamp from snowflake ${msg.id}: ${messageDate.toISOString()}`);
    } else {
      if (DEBUG_PARSER) sendLog(`📅 No message timestamp available`);
    }

    parsed = parseScheduleMessage_v3(raw, messageDate);

    // Log parsed result to sheet only (verbose - DEBUG mode only)
    if (DEBUG_PARSER && typeof logToSheet === 'function') {
      logToSheet(`🧪 Parsed: ${JSON.stringify(parsed)}`);
    }

    if (!parsed || !parsed.ok || !parsed.team1 || !parsed.team2 || !parsed.division) {
      sendLog(`⚠️ Skipped message ID: ${msg?.id} — unable to parse.`);
      return { updated: 0 };
    }

    isTentative = parsed.status === 'Confirming' || parsed.tentative;
    isRematch = parsed.isRematch || false;

    // Log this parsed result
    logMatchToWMLog(parsed, msg.author?.id || msg.authorId, msg.channel?.name || msg.channelName || msg.channel, isTentative, isRematch);

    // Update tables: find row, update store, refresh Discord board
    try {
      if (typeof updateTablesMessageFromPairs === 'function' && parsed.pairs && parsed.weekKey) {
        updateResult = updateTablesMessageFromPairs(parsed.weekKey, parsed.pairs, options);

        if (updateResult.updated > 0) {
          // Build message link if possible
          var messageLink = '';
          // Try multiple ways to get channel ID: direct property, nested object, or from options
          var channelId = msg.channel_id || (msg.channel && msg.channel.id) || options.channelId || (typeof SCHED_INPUT_CHANNEL_ID !== 'undefined' ? SCHED_INPUT_CHANNEL_ID : '');

          // Debug logging to troubleshoot link building (disabled)
          // if (typeof logToSheet === 'function') {
          //   logToSheet(`🔗 Link debug: channelId="${channelId}", msg.id="${msg.id}", msg.channel_id="${msg.channel_id}", options.channelId="${options.channelId}"`);
          // }

          if (channelId && msg.id && typeof buildDiscordMessageLink === 'function') {
            var link = buildDiscordMessageLink(channelId, msg.id);
            // if (typeof logToSheet === 'function') {
            //   logToSheet(`🔗 Built link: "${link}"`);
            // }
            if (link) messageLink = ` • [Jump to message](${link})`;
          }
          sendLog(`✅ ${parsed.division} • \`${parsed.weekKey.split('|')[1] || '?'}\` • ${parsed.team1} vs ${parsed.team2} • ${parsed.whenText} • Scheduled  by <@${msg.author?.id || 'unknown'}>${messageLink}`);
        }

        // Note: Skip logging is handled verbosely in 70_updates.gs (shows team names)

        if (updateResult.unmatched && updateResult.unmatched.length > 0) {
          const reasons = updateResult.unmatched.map(u => u.reason).join(', ');
          sendLog(`⚠️ ${parsed.division} • ? • Unmapped — ${parsed.team1} vs ${parsed.team2} (${reasons})`);
        }
      }
    } catch (e) {
      sendLog(`⚠️ Error updating tables: ${e.message}`);
    }

  }
  catch (e) {
    sendLog(`❌ Error processing message ID ${msg?.id}: ${e.message}`);
    return { updated: 0 };
  }

  // Only count as updated if we actually scheduled something (not skipped/unmatched)
  var actuallyUpdated = (updateResult && updateResult.updated > 0) ? 1 : 0;
  var actuallySkipped = (updateResult && updateResult.skipped > 0) ? updateResult.skipped : 0;

  return {
    updated: actuallyUpdated,
    skipped: actuallySkipped,
    tentative: isTentative,
    parsed: parsed
  };
}

/**
 * Parse a Discord message (string) into schedule update pairs.
 * Returns { ok, pairs: [{division, home, away, epochSec?, whenText, weekKey}], trace }
 * @param {string} text - Raw Discord message text
 * @param {Date} messageDate - Optional Discord message timestamp for historical week matching
 * @returns {Object} {ok: boolean, pairs?: array, division?: string, team1?: string, team2?: string, whenText?: string, weekKey?: string, trace: array, error?: string}
 */
function parseScheduleMessage_v3(text, messageDate) {
  var trace = [];
  // Don't clear caches here - let them persist across messages in the same batch
  // (caches in 05_util.gs will naturally persist until explicitly cleared)
  try {
    var raw = String(text || '');
    raw = cleanScheduleText(raw);
    var cleaned = stripDiscordNoise(raw);
    trace.push('cleaned=' + cleaned);

    // division + map hints
    var hintDiv = extractDivisionHint(cleaned);
    var hintMap = extractMapHint(cleaned);
    if (hintDiv) trace.push('hintDiv=' + hintDiv);
    if (hintMap) trace.push('hintMap=' + hintMap);

    // Strip map hint from text before splitting teams (prevents "dod_railyard_b6 NoGo" being treated as team name)
    var cleanedForTeams = stripMapHint(cleaned);
    if (DEBUG_PARSER && cleanedForTeams !== cleaned && typeof logToSheet === 'function') {
      logToSheet(`🗺️ Stripped map from text: "${cleaned}" → "${cleanedForTeams}"`);
    }

    // teams
    var sides = splitVsSides(cleanedForTeams);
    if (!sides || !sides.a || !sides.b) {
      return { ok: false, error: 'no_vs', trace: trace };
    }
    trace.push('sides=' + JSON.stringify(sides));

    // Try to match teams with hint first
    var matchA = matchTeam(sides.a, hintDiv);
    var matchB = matchTeam(sides.b, hintDiv);

    // If not found with hint, try without hint (hint might be wrong)
    if ((!matchA || !matchB) && hintDiv) {
      var matchA2 = matchTeam(sides.a, null);
      var matchB2 = matchTeam(sides.b, null);
      if (matchA2 && matchB2) {
        // Found teams without hint - hint was probably wrong
        matchA = matchA2;
        matchB = matchB2;
        // Note: More detailed warning logged later at line 1205 with team names
      }
    }

    if (!matchA || !matchB) {
      return { ok: false, error: 'team_not_found', detail: { a: !!matchA, b: !!matchB }, trace: trace };
    }

    // Check if teams are in different divisions (cross-division match - not allowed)
    if (matchA.division && matchB.division && matchA.division !== matchB.division) {
      return { ok: false, error: 'cross_division', trace: trace, detail: { a: matchA, b: matchB } };
    }

    // Determine final division: trust team lookups over hint
    var actualDivision = matchA.division || matchB.division;
    var division = actualDivision || hintDiv;

    // Warn if hint doesn't match actual division
    if (hintDiv && actualDivision && hintDiv !== actualDivision) {
      if (typeof sendLog === 'function') {
        sendLog(`⚠️ Division hint mismatch: captain said "${hintDiv}" but "${matchA.name}" vs "${matchB.name}" are in "${actualDivision}" - using actual division`);
      }
      trace.push('hint_mismatch=' + hintDiv + ' actual=' + actualDivision);
    }

    trace.push('division=' + division);

    // when (use messageDate as reference for historical parsing)
    var when = parseWhenFlexible(cleaned, hintDiv, hintMap, messageDate);
    if (when && when.whenText) trace.push('when=' + JSON.stringify(when));

    // Build week list from spreadsheet (all weeks across all divisions)
    var weekList = buildWeekListFromSheets();

    // which block/week?
    var week = chooseWeekForPair(division, matchA.name, matchB.name, weekList, hintMap, raw, when, messageDate);
    if (!week || !week.date) {
      return { ok: false, error: 'week_not_found', trace: trace };
    }
    if (typeof syncHeaderMetaToTables === 'function') week = syncHeaderMetaToTables(week, division);
    var wkKey = (typeof weekKey === 'function') ? weekKey(week) : (Utilities.formatDate(week.date, 'America/New_York', 'yyyy-MM-dd') + '|' + (week.mapRef || ''));

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


