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
  var noDod    = c.replace(/^dod_/, '');
  var noDodUnd = noDod.replace(/_/g, ' ');

  // Optional version-stripping (e.g., _b6 → base “railyard”)
  var base     = c.replace(/_b\d+$/i, '');
  var baseNoU  = base.replace(/_/g, ' ');
  var baseNoD  = base.replace(/^dod_/, '');
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
  ].forEach(function(a){
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
  aliases.sort(function(a, b){ return b.length - a.length; });

  function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
  } catch (_){ return {}; }
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

// Split into sides around “vs / v. / // / - ” keeping the closest form
function _splitVsSides_(s) {
  var norm = s.replace(/\s*-\s*/g, ' - ');
  var parts = norm.split(/\bvs\b| v\. |\/\/| - /i);
  if (parts.length < 2) return null;
  var a = parts[0], b = parts.slice(1).join(' ');

  // Try to reduce b if trailing scheduling phrases exist
  // (we’ll still fuzzy-match so this is just a nudge)
  return {
    a: a.replace(/^(bronze|silver|gold)\s*:?\s*/i, '').trim(),
    b: b.trim()
  };
}

function _matchTeam_(snippet, forcedDivision) {
  var idx = (typeof getTeamIndexCached_==='function') ? getTeamIndexCached_() : null;
  if (!idx || !idx.teams || !idx.teams.length) return null;

  var syn = _teamSynonyms_();
  var s = _normalizeTeamText_(snippet);
  if (syn[s]) s = _normalizeTeamText_(syn[s]);

  var best = null, bestScore = -1;
  for (var i=0;i<idx.teams.length;i++){
    var t = idx.teams[i]; // {name, division, alias[], ...}
    if (forcedDivision && String(t.division||'').toLowerCase() !== String(forcedDivision||'').toLowerCase()) continue;

    var cand = _normalizeTeamText_(t.name);
    var sc = _scoreTeamMatch_(s, cand);
    if (Array.isArray(t.aliases)) {
      for (var j=0;j<t.aliases.length;j++) {
        var al = _normalizeTeamText_(t.aliases[j]);
        sc = Math.max(sc, _scoreTeamMatch_(s, al));
      }
    }
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  if (!best || bestScore < 2) return null; // require at least partial match
  return { name: best.name, division: best.division };
}

function _normalizeTeamText_(s) {
  return String(s||'')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g,' ')
    .trim();
}

function _scoreTeamMatch_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 10;
  if (b.indexOf(a) >= 0) return Math.min(8, a.length); // partial contained
  // token overlap
  var at = a.split(' '), bt = b.split(' ');
  var hits = 0;
  for (var i=0;i<at.length;i++){
    if (!at[i]) continue;
    for (var j=0;j<bt.length;j++){
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
    dateObj = new Date(Date.UTC(baseYear, mm-1, dd));
  }

  // 4.2 textual month (october 5(th))
  if (!dateObj) {
    var monMap = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
    var mM = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/);
    if (mM) {
      var mon = monMap[mM[1]]; var d = +mM[2]; var y = mM[3] ? +mM[3] : new Date().getFullYear();
      dateObj = new Date(Date.UTC(y, mon, d));
    }
  }

  // 4.3 “Sunday 1530 est” or “Monday 15th 10pm”
  var dowIdx = {sun:0,mon:1,tue:2,wed:3,thu:4,thur:4,fri:5,sat:6};
  var mDow = lower.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/);
  if (!dateObj && mDow) {
    var now = new Date();
    var targetDow = dowIdx[mDow[1].slice(0,3)];
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var delta = (targetDow - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // “this Sunday” usually means upcoming
    d.setDate(d.getDate() + delta);

    // If we also have “15th|5th” day-of-month, align to that in current/next month
    var mNth = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
    if (mNth) {
      var nth = +mNth[1];
      var try1 = new Date(d.getFullYear(), d.getMonth(), nth);
      var try2 = new Date(d.getFullYear(), d.getMonth()+1, nth);
      // choose the one that matches the desired dow and is not in the past
      var cand = [try1, try2].filter(function(x){ return x.getDay() === targetDow; }).sort(function(a,b){ return a-b; })[0];
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
    var wk = (typeof getAlignedUpcomingWeekOrReport_==='function') ? getAlignedUpcomingWeekOrReport_() : {};
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
  var local = Utilities.formatDate(new Date(Date.UTC(y,m,d2)), tz, 'yyyy-MM-dd');
  var dt = new Date(local + 'T' + (('0'+(hh|0)).slice(-2)) + ':' + (('0'+(mm|0)).slice(-2)) + ':00');
  var epoch = Math.floor(dt.getTime() / 1000);

  var whenText = Utilities.formatDate(dt, tz, 'h:mm a') + ' ET';
  return { epochSec: epoch, whenText: whenText };
}

// Decide which block to update for this pair
function _chooseWeekForPair_(division, home, away, hintMap, when) {
  // 1) If we have an aligned week already, start from that (and sync)
  var wk = (typeof getAlignedUpcomingWeekOrReport_==='function') ? getAlignedUpcomingWeekOrReport_() : {};
  if (typeof syncHeaderMetaToTables_ === 'function') wk = syncHeaderMetaToTables_(wk, division || 'Bronze');

  // 2) Try explicit map first
  if (hintMap) {
    var wByMap = _findWeekByMapAndPair_(division, hintMap, home, away);
    if (wByMap) return wByMap;
  }

  // 3) If we have a concrete date, try to find the week whose default date is the same week
  if (when && typeof when.epochSec === 'number') {
    var d = new Date(when.epochSec * 1000);
    var wByDate = _findWeekByDateAndPair_(division, d, home, away);
    if (wByDate) return wByDate;
  }

  // 4) If message says make-up/postponed → prefer past unplayed block
  var lower = (typeof arguments[5]==='string') ? arguments[5].toLowerCase() : '';
  if (/\b(make[- ]?up|postponed|makeup)\b/.test(lower)) {
    var wPast = _findPastUnplayedWeekForPair_(division, home, away);
    if (wPast) return wPast;
  }

  // 5) Fallback: current aligned week
  return wk;
}

function _findWeekByMapAndPair_(division, mapRef, home, away) {
  var sh = (typeof getSheetByName_==='function') ? getSheetByName_(division) : null;
  if (!sh) return null;
  var G = { label:27, map:28, date:29, stride:11, rows:10 };
  var maxRows = sh.getMaxRows();
  var tz = 'America/New_York';

  for (var i=0;;i++){
    var top = G.label + i*G.stride;
    if (top + G.rows + 1 > maxRows) break;
    var map = String(sh.getRange(top+1,1).getDisplayValue()||'').trim().toLowerCase();
    if (map && mapRef && map.indexOf(String(mapRef||'').toLowerCase()) === -1) continue;
    // look for pair inside this block
    var band = sh.getRange(top+1, 2, G.rows, 7).getDisplayValues();
    for (var r=0;r<band.length;r++){
      var homeN = String(band[r][1]||'').trim();
      var awayN = String(band[r][5]||'').trim();
      if (_sameTeam_(homeN, home) && _sameTeam_(awayN, away)) {
        var dateTx = String(sh.getRange(top+2,1).getDisplayValue()||'');
        var d = _parseSheetDateET_(dateTx);
        return { date: d, mapRef: mapRef, blocks: (function(o){ o[o ? division : division] = {top:top}; return o; })({}) };
      }
    }
  }
  return null;
}

function _findWeekByDateAndPair_(division, dateObj, home, away) {
  var sh = (typeof getSheetByName_==='function') ? getSheetByName_(division) : null;
  if (!sh) return null;
  var G = { label:27, map:28, date:29, stride:11, rows:10 };
  var maxRows = sh.getMaxRows(), tz='America/New_York';

  function sameWeek(d1, d2){
    // Compare by ISO week (Mon-Sun) or simply within 6 days distance
    var a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    var b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    var diff = Math.abs(a - b) / 86400000;
    return diff <= 6.99;
  }

  for (var i=0;;i++){
    var top = G.label + i*G.stride;
    if (top + G.rows + 1 > maxRows) break;
    var dateTx = String(sh.getRange(top+2,1).getDisplayValue()||'');
    var d = _parseSheetDateET_(dateTx);
    if (!d) continue;
    if (!sameWeek(d, dateObj)) continue;
    var band = sh.getRange(top+1, 2, G.rows, 7).getDisplayValues();
    for (var r=0;r<band.length;r++){
      var homeN = String(band[r][1]||'').trim();
      var awayN = String(band[r][5]||'').trim();
      if (_sameTeam_(homeN, home) && _sameTeam_(awayN, away)) {
        var mapRef = String(sh.getRange(top+1,1).getDisplayValue()||'').trim();
        return { date: d, mapRef: mapRef, blocks: (function(o){ o[division] = {top:top}; return o; })({}) };
      }
    }
  }
  return null;
}

function _findPastUnplayedWeekForPair_(division, home, away) {
  var sh = (typeof getSheetByName_==='function') ? getSheetByName_(division) : null;
  if (!sh) return null;
  var G = { label:27, map:28, date:29, stride:11, rows:10 };
  var maxRows = sh.getMaxRows();

  function finished(row){
    var sc1 = row[2], sc2 = row[6], wl1=row[0], wl2=row[4];
    var num = /^\s*\d+\s*$/;
    var done = (num.test(String(sc1||'')) && num.test(String(sc2||''))) ||
               (/\b(W|L|T|FF|F|FORFEIT)\b/i.test(String(wl1||'')) &&
                /\b(W|L|T|FF|F|FORFEIT)\b/i.test(String(wl2||'')));
    return !!done;
  }

  for (var i=0;;i++){
    var top = G.label + i*G.stride;
    if (top + G.rows + 1 > maxRows) break;
    var band = sh.getRange(top+1, 2, G.rows, 7).getDisplayValues();
    for (var r=0;r<band.length;r++){
      var row = band[r];
      var homeN = String(row[1]||'').trim();
      var awayN = String(row[5]||'').trim();
      if (_sameTeam_(homeN, home) && _sameTeam_(awayN, away) && !finished(row)) {
        var mapRef = String(sh.getRange(top+1,1).getDisplayValue()||'').trim();
        var d = _parseSheetDateET_(String(sh.getRange(top+2,1).getDisplayValue()||''));
        return { date: d, mapRef: mapRef, blocks: (function(o){ o[division] = {top:top}; return o; })({}) };
      }
    }
  }
  return null;
}

function _sameTeam_(a, b) {
  return _normalizeTeamText_(a) === _normalizeTeamText_(b);
}

/**
 * Parse a Discord message (string) into schedule update pairs.
 * Returns { ok, pairs: [{division, home, away, epochSec?, whenText, weekKey}], trace }
 */
function parseScheduleMessage_v3(text) {
  var trace = [];
  try {
    var raw = String(text || '');
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
      return { ok:false, error:'no_vs', trace: trace };
    }
    trace.push('sides=' + JSON.stringify(sides));

    var matchA = _matchTeam_(sides.a, hintDiv);
    var matchB = _matchTeam_(sides.b, hintDiv);
    if (!matchA || !matchB) {
      return { ok:false, error:'team_not_found', detail:{a:!!matchA, b:!!matchB}, trace:trace };
    }
    if (!hintDiv && matchA.division && matchB.division && matchA.division !== matchB.division) {
      return { ok:false, error:'cross_division', trace:trace, detail:{a:matchA,b:matchB} };
    }
    var division = hintDiv || matchA.division || matchB.division;
    trace.push('division=' + division);

    // when
    var when = _parseWhenFlexible_(cleaned, hintDiv, hintMap);
    if (when && when.whenText) trace.push('when=' + JSON.stringify(when));

    // which block/week?
    var week = _chooseWeekForPair_(division, matchA.name, matchB.name, hintMap, when);
    if (!week || !week.date) {
      return { ok:false, error:'week_not_found', trace:trace };
    }
    if (typeof syncHeaderMetaToTables_ === 'function') week = syncHeaderMetaToTables_(week, division);
    var wkKey = (typeof weekKey_ === 'function') ? weekKey_(week) : (Utilities.formatDate(week.date,'America/New_York','yyyy-MM-dd') + '|' + (week.mapRef||''));

    var pair = {
      division: division,
      home: matchA.name,
      away: matchB.name,
      whenText: (when && when.whenText) ? when.whenText : 'TBD',
      weekKey: wkKey
    };
    if (when && typeof when.epochSec === 'number') pair.epochSec = when.epochSec;

    return { ok:true, pairs:[pair], trace:trace };
  } catch (e) {
    return { ok:false, error:String(e && e.message || e), trace:trace };
  }
}