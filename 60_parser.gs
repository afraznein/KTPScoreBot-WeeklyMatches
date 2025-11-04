// =======================
// 60_parser.gs - Schedule Message Parsing
// =======================
// Purpose: Parse Discord messages, extract teams/dates/maps, match teams
// Dependencies: 00_config.gs, 05_util.gs, 20_sheets.gs, 40_logging.gs
// Used by: 30_relay.gs (event handlers), 70_updates.gs
//
// Functions in this module:
// - getMapAliasCatalog()
// - aliasesForMap(canon)
// - extractMapHint(text)
// - teamSynonyms()
// - stripDiscordNoise(s)
// - extractDivisionHint(s)
// - splitVsSides(s)
// - stripOrdinalSuffixes(rawDate)
// - cleanScheduleText(raw)
// - resolveTeamAlias(rawInput)
// - matchTeam(snippet, forcedDivision)
// - normalizeTeamText(s)
// - scoreTeamMatch(a, b)
// - parseWhenFlexible(s, hintDiv, hintMap)
// - buildWeekListFromSheets()
// - chooseWeekForPair(division, home, away, weekList, hintMap, rawText, when)
// - findWeekByMapAndPair(division, map, home, away, weekList)
// - findWeekByDateAndPair(division, dateObj, home, away, weekList)
// - findPastUnplayedWeekForPair(division, home, away, weekList)
// - isSameWeek(d1, d2)
// - hasTeamsInWeek(week, home, away)
// - pollAndProcessFromId(channelId, startId, opt)
// - processOneDiscordMessage(msg)
// - parseScheduleMessage_v3(text)
//
// Total: 24 functions
// =======================
// =======================
// parser.gs – Discord message parsing logic
// =======================
/** Build alias→canon map from the General sheet list. Cached per execution. */
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

/** Generate useful aliases for a canonical map id like "dod_railyard_b6". */
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

// Optional team synonym map from Script Properties (JSON)
function teamSynonyms() {
  try {
    var sp = PropertiesService.getScriptProperties().getProperty('TEAM_SYNONYMS_JSON');
    return sp ? JSON.parse(sp) : {};
  } catch (_) { return {}; }
}

function stripDiscordNoise(s) {
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

function extractDivisionHint(s) {
  var m = s.match(/\b(bronze|silver|gold)\b\s*:?/i);
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : null;
}

// --- Enhanced splitVsSides to handle "between A and B" and strip division hints ---
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


  return { a: a, b: b };
}

// --- Normalize ordinal suffixes in dates (e.g., 12th → 12) ---
function stripOrdinalSuffixes(rawDate) { return rawDate.replace(/(\d+)(st|nd|rd|th)/gi, '$1') }

// --- Sanitize raw text for parsing (ignore second timezones, remove foreign weekday mentions) ---
function cleanScheduleText(raw) {
  return raw
    .replace(/\/\s*Domingo.*$/i, '')
    .replace(/\b\d{1,2}:\d{2}\s*(BRT|CET|UTC|GMT|JST|PST|PT|ART|IST).*/gi, '')
    .replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    .replace(/tentative|confirm.*later|likely postponed|we'?ll confirm/gi, '');
}

// --- Enhanced Team Alias Resolver ---
function resolveTeamAlias(rawInput) {
  TEAM_ALIAS_CACHE = null; // Always force reload from sheet
  TEAM_INDEX_CACHE = null; // Clear team index cache too
  const aliasMap = loadTeamAliases();
  const upper = String(rawInput || '').trim().toUpperCase();
  return aliasMap[upper] || rawInput;
}


// --- Enhanced matchTeam to use aliases ---
function matchTeam(snippet, forcedDivision) {
  var idx = (typeof getTeamIndexCached === 'function') ? getTeamIndexCached() : null;
  if (!idx || !idx.teams || !idx.teams.length) return null;


  var syn = teamSynonyms();
  var resolved = resolveTeamAlias(snippet);
  var s = normalizeTeamText(resolved);
  if (syn[s]) s = normalizeTeamText(syn[s]);


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

function normalizeTeamText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function parseWhenFlexible(s, hintDiv, hintMap) {
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
    var wk = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : {};
    if (typeof syncHeaderMetaToTables === 'function') wk = syncHeaderMetaToTables(wk, hintDiv || 'Bronze');
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
function buildWeekListFromSheets() {
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

// --- Enhanced chooseWeekForPair with weekList threaded into helpers ---
function chooseWeekForPair(division, home, away, weekList, hintMap, rawText, when) {
  var wk = (typeof getAlignedUpcomingWeekOrReport === 'function') ? getAlignedUpcomingWeekOrReport() : {};
  if (typeof syncHeaderMetaToTables === 'function') wk = syncHeaderMetaToTables(wk, division || 'Bronze');

  if (hintMap) {
    var wByMap = findWeekByMapAndPair(division, hintMap, home, away, weekList);
    if (wByMap) return wByMap;
  }

  if (when && typeof when.epochSec === 'number') {
    var d = new Date(when.epochSec * 1000);
    var wByDate = findWeekByDateAndPair(division, d, home, away, weekList);
    if (wByDate) return wByDate;
  }

  var lower = String(rawText || '').toLowerCase();
  if (/\b(make[- ]?up|postponed|rematch)\b/.test(lower)) {
    var wPast = findPastUnplayedWeekForPair(division, home, away, weekList);
    if (wPast) return wPast;
  }

  return wk;
}

// --- Helper function updates to support weekList injection ---
function findWeekByMapAndPair(division, map, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  map = map.toLowerCase();
  return weekList.find(w => w.division === division && w.map.toLowerCase() === map && hasTeamsInWeek(w, home, away));
}

function findWeekByDateAndPair(division, dateObj, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  return weekList.find(w => {
    if (w.division !== division) return false;
    var weekDate = new Date(w.defaultDate);
    return isSameWeek(dateObj, weekDate) && hasTeamsInWeek(w, home, away);
  });
}

function findPastUnplayedWeekForPair(division, home, away, weekList) {
  if (!Array.isArray(weekList)) return null;
  for (var i = 0; i < weekList.length; i++) {
    var wk = weekList[i];
    if (wk.division !== division) continue;
    if (hasTeamsInWeek(wk, home, away) && !wk.played) return wk;
  }
  return null;
}

function isSameWeek(d1, d2) {
  var startOfWeek = date => {
    var day = new Date(date);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - day.getDay());
    return day;
  };

  return startOfWeek(d1).getTime() === startOfWeek(d2).getTime();
}

function hasTeamsInWeek(week, home, away) {
  if (!week || !Array.isArray(week.matches)) return false;
  return week.matches.some(m => m.home === home && m.away === away);
}

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
  var errors = [];
  var lastId = startId ? String(startId) : '';
  var stoppedEarly = false;
  var stopReason = '';

  // 0) If inclusive: try to fetch/process the start message itself
  if (inclusive && startId) {
    try {
      var msg0 = fetchSingleMessageInclusive(channelId, String(startId)); // best-effort
      if (msg0) {
        var res0 = processOneDiscordMessage(msg0, startTime);
        processed++;
        if (res0 && res0.updated) updatedPairs += res0.updated;
        lastId = String(msg0.id || lastId);
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
        var res = processOneDiscordMessage(msg, startTime);
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
    errors: errors,
    lastPointer: lastId,
    stoppedEarly: stoppedEarly,
    stopReason: stopReason,
    elapsedMs: elapsed
  }
}

/** Process one Discord message through: content → parse → update */
function processOneDiscordMessage(msg, startTime) {
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
  try {
    raw = msg.content;
    sendLog(`👀 Message ID ${msg.id}: raw="${raw.slice(0, 100)}..."`);

    parsed = parseScheduleMessage_v3(raw);
    sendLog(`🧪 Parsed: ${JSON.stringify(parsed)}`);

    if (!parsed || !parsed.ok || !parsed.team1 || !parsed.team2 || !parsed.division) {
      sendLog(`⚠️ Skipped message ID: ${msg?.id} — unable to parse.`);
      return { updated: 0 };
    }


    const isTentative = parsed.status === 'Confirming' || parsed.tentative;
    const isRematch = parsed.isRematch || false;

    // Log this parsed result
    logMatchToWMLog(parsed, msg.author?.id || msg.authorId, msg.channel?.name || msg.channelName || msg.channel, isTentative, isRematch);

    // Update tables: find row, update store, refresh Discord board
    let updateResult = null;
    try {
      if (typeof updateTablesMessageFromPairs === 'function' && parsed.pairs && parsed.weekKey) {
        updateResult = updateTablesMessageFromPairs(parsed.weekKey, parsed.pairs);

        if (updateResult.updated > 0) {
          sendLog(`✅ ${parsed.division} • \`${parsed.weekKey.split('|')[1] || '?'}\` • ${parsed.team1} vs ${parsed.team2} • ${parsed.whenText} • Scheduled  by <@${msg.author?.id || 'unknown'}>`);
        }

        if (updateResult.unmatched && updateResult.unmatched.length > 0) {
          const reasons = updateResult.unmatched.map(u => u.reason).join(', ');
          sendLog(`⚠️ ${parsed.division} • ? • Unmapped — ${parsed.team1} vs ${parsed.team2} (${reasons})`);
        }
      }
    } catch (e) {
      sendLog(`⚠️ Error updating tables: ${e.message}`);
    }

    // Send confirmation to log channel
    const rowInfo = (updateResult && updateResult.updated > 0) ? 'Mapped' : 'Unmapped';
    const line = formatScheduleConfirmationLine(parsed, null, msg.author?.id, msg.id);
    if (typeof postChannelMessage === 'function') {
      postChannelMessage(RESULTS_LOG_CHANNEL_ID, line);
    }

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
  TEAM_ALIAS_CACHE = null;
  TEAM_INDEX_CACHE = null; // Clear team index cache too
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

    // teams
    var sides = splitVsSides(cleaned);
    if (!sides || !sides.a || !sides.b) {
      return { ok: false, error: 'no_vs', trace: trace };
    }
    trace.push('sides=' + JSON.stringify(sides));

    var matchA = matchTeam(sides.a, hintDiv);
    var matchB = matchTeam(sides.b, hintDiv);
    if (!matchA || !matchB) {
      return { ok: false, error: 'team_not_found', detail: { a: !!matchA, b: !!matchB }, trace: trace };
    }
    if (!hintDiv && matchA.division && matchB.division && matchA.division !== matchB.division) {
      return { ok: false, error: 'cross_division', trace: trace, detail: { a: matchA, b: matchB } };
    }
    var division = hintDiv || matchA.division || matchB.division;
    trace.push('division=' + division);

    // when
    var when = parseWhenFlexible(cleaned, hintDiv, hintMap);
    if (when && when.whenText) trace.push('when=' + JSON.stringify(when));

    // Build week list from spreadsheet (all weeks across all divisions)
    var weekList = buildWeekListFromSheets();

    // which block/week?
    var week = chooseWeekForPair(division, matchA.name, matchB.name, weekList, hintMap, raw, when);
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


