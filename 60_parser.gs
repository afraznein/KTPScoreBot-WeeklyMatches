/**
 * Lightweight parser v2 (pair teams, simple time capture, current-week default).
 *
 * Key goals:
 *  - Strip Discord usernames (@user and <@123>, <@!123>)
 *  - Associate custom emojis -> teams (prefer emoji id; fallback by name)
 *  - Support partial team names (e.g., "EMO" for "EMO FRAG SQAUD") when UNIQUE
 *  - Cheap matching: per-line, pick first two distinct teams
 *  - Time parsing: if no AM/PM, assume PM (America/New_York)
 *  - Default to the current league week if no explicit date is found
 *  - Work across three division sheets; cache roster/index for speed
 *
 * Public entry: parseScheduleMessage_(text) → { weekKey, pairs:[{division,home,away,when,sourceLine}], errors:[] }
 *
 * Assumptions:
 *  - Sheet columns include: Team (name), Emoji (optional: "name:id" or "<:name:id>"), Aliases (optional, comma-separated), Abbrev (optional)
 *  - Division sheets are named BRONZE/SILVER/GOLD (configurable via DIV_SHEETS)
 *  - Optional Script Property EMOJI_TEAM_MAP: JSON { "emojiId": "Team Name" }
 */

// ---------------- Public entry ----------------
function parseScheduleMessage_(text) {
  return parseScheduleMessage_v2(text);
}

/**
 * Parse a message (string | string[] | {content:string}) into matchup pairs.
 * Uses parseLineForMatchup_ so prod == panel debug behavior.
 *
 * Returns:
 * {
 *   ok: boolean,
 *   pairs: [{ division, home, away, whenIso, sourceLine }],
 *   errors: [{ line, reason }],
 *   stats: { linesTotal, linesScanned, pairs, divisions: { Bronze:n, Silver:n, Gold:n } }
 * }
 */
function parseScheduleMessage_v2(input, opts) {
  opts = opts || {};
  var tz = (typeof getTz_ === 'function') ? getTz_() : 'America/New_York';

  // --- Normalize input to an array of lines
  var lines = [];
  if (Array.isArray(input)) {
    lines = input.slice();
  } else if (input && typeof input === 'object' && typeof input.content === 'string') {
    lines = String(input.content).split(/\r?\n/);
  } else {
    lines = String(input || '').split(/\r?\n/);
  }

  // --- Helpers
  function stripDiscordNoise_(s) {
    var t = String(s || '');
    // remove <@123>, <@!123>, <#chan>, <@&role>, <a:emoji:ID>, <:emoji:ID>
    t = t.replace(/<[@#][!&]?\d+>/g, ' ');
    t = t.replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, ' ');
    // remove @username-ish words (loose)
    t = t.replace(/(^|\s)@[\w\-]+/g, ' ');
    // collapse spaces
    return t.replace(/\s+/g, ' ').trim();
  }

  function dedupePairs_(arr) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      var key = [p.division || '', p.home || '', p.away || '', p.whenIso || ''].join('|').toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(p);
    }
    return out;
  }

  // --- Main loop
  var outPairs = [];
  var errs = [];
  var scanned = 0;

  for (var li = 0; li < lines.length; li++) {
    var raw = lines[li];

    // skip empty / separator / boilerplate
    if (!/\S/.test(raw)) continue;
    if (/^```/.test(raw)) continue; // ignore fenced blocks
    if (/^\s*[-=]{3,}\s*$/.test(raw)) continue;

    scanned++;

    var line = stripDiscordNoise_((raw || ''));

    // division hint from text if helper exists
    var hintDiv = (typeof detectDivisionHint_ === 'function') ? detectDivisionHint_(line) : null;

    // use the same core parser as the panel
    var r = parseLineForMatchup_(line, { hintDivision: hintDiv });

    if (r && r.ok && r.matches && r.matches.length >= 2) {
      var A = r.matches[0];
      var B = r.matches[1];

      // Skip BYE pairs
      if (String(A.name || '').toUpperCase() === 'BYE' || String(B.name || '').toUpperCase() === 'BYE') {
        errs.push({ line: raw, reason: 'bye_pair_ignored' });
        continue;
      }

      var div = r.finalDivision || hintDiv || null;
      if (!div) {
        errs.push({ line: raw, reason: 'division_undetermined' });
        continue;
      }

      // prefer the parser's time; if not present, fall back to your when parser
      var whenIso = (r.when && (r.when.iso || r.when.text)) ? (r.when.iso || r.when.text) : null;
      if (!whenIso && typeof parseWhenInLine_ === 'function') {
        try { whenIso = parseWhenInLine_(line, new Date()); } catch (_){}
      }

      outPairs.push({
        division: div,
        home: A.name,
        away: B.name,
        whenIso: whenIso || '',   // keep empty string if still unknown; scheduler can default to 9pm on week date
        sourceLine: raw
      });
    } else {
      errs.push({ line: raw, reason: (r && r.reason) || 'no_pair' });
    }
  }

  // dedupe and compile stats
  outPairs = dedupePairs_(outPairs);

  var divCounts = { Bronze: 0, Silver: 0, Gold: 0 };
  for (var i = 0; i < outPairs.length; i++) {
    var d = String(outPairs[i].division || '');
    if (d === 'Bronze' || d === 'Silver' || d === 'Gold') divCounts[d]++;
  }

  var result = {
    ok: outPairs.length > 0,
    pairs: outPairs,
    errors: errs,
    stats: {
      linesTotal: lines.length,
      linesScanned: scanned,
      pairs: outPairs.length,
      divisions: divCounts
    }
  };

  // sheet log (non-fatal if missing)
  try {
    logLocal_('INFO', 'parse.v2.summary', {
      ok: result.ok,
      totals: result.stats,
      example: outPairs[0] || null
    });
  } catch (_){}

  return result;
}


function parseMessageLine_(text, hintDivision) {
  return parseLineForMatchup_(String(text||''), { hintDivision: hintDivision||null, trace:false });
}

// ---------------- Pre-sanitize ----------------
function stripDiscordUsers_(s) {
  if (!s) return '';
  // Remove canonical user mentions <@123> or <@!123>
  s = s.replace(/<@!?\d+>/g, '');
  // (Leave role <@&id> and channel <#id> by default)
  // Remove raw @handles conservatively (not emails)
  s = s.replace(/(^|[^A-Za-z0-9._%+-])@([A-Za-z0-9_]{2,32})\b/g, '$1');
  return s.replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------- Team index & caching ----------------
function getTeamIndexCached_() {
  var sp = PropertiesService.getScriptProperties();
  var key = 'TEAM_INDEX_V4:' + (sp.getProperty('SPREADSHEET_ID') || '') + ':' + getDivisionSheets_().join(',');
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var roster = fetchRosterSnapshot_();
  var idx = buildTeamIndex_(roster);
  cache.put(key, JSON.stringify(idx), 300);
  return idx;
}

/**
 * Fetch roster rows across divisions. Each row: { division, name, aliases[], abbrev?, emojiId?, emojiName? }
 * Tries to use existing helpers if present; otherwise reads sheets directly.
 */
function fetchRosterSnapshot_() {
  var out = [];
  var _DIVS = getDivisionSheets_();        // already in your parser
  for (var d = 0; d < _DIVS.length; d++) {
    var divName = _DIVS[d];
    var canonDiv = canonDivision_(divName);
    var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(divName)
                                                     : SpreadsheetApp.getActive().getSheetByName(divName);
    if (!sh) continue;

    var values = sh.getDataRange().getValues();
    if (!values || values.length === 0) continue;

    // Try header/table mode first
    var header = values[0].map(function(h){ return String(h).toLowerCase(); });
    var map = {};
    for (var i = 0; i < header.length; i++) map[header[i]] = i;
    function col(name){ var p = map[String(name).toLowerCase()]; return (p == null) ? -1 : p; }

    var ciTeam   = col('team') >= 0 ? col('team') : col('name');
    var ciEmoji  = col('emoji');
    var ciAliases= col('aliases');
    var ciAbbrev = col('abbrev');

    if (ciTeam >= 0) {
      // Header/table mode
      for (var r = 1; r < values.length; r++) {
        var row = values[r];
        var name = row[ciTeam] != null ? String(row[ciTeam]).trim() : '';
        if (!name) continue;
        var emojiRaw = (ciEmoji  >= 0 && row[ciEmoji]  != null) ? String(row[ciEmoji]).trim()  : '';
        var aliases  = (ciAliases>= 0 && row[ciAliases]!= null) ? String(row[ciAliases]).split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
        var abbrev   = (ciAbbrev >= 0 && row[ciAbbrev] != null) ? String(row[ciAbbrev]).trim() : '';
        var parsed   = parseEmojiCell_(emojiRaw);
        out.push({ division: canonDiv || divName, name: name, aliases: aliases, abbrev: abbrev, emojiId: parsed.id, emojiName: parsed.name });
      }
    } else {
      // Range fallback (e.g. A3:A23)
      var rangeA1 = getTeamRangeForDiv_(divName);
      out = out.concat(readTeamsFromRange_(sh, divName, rangeA1));
    }
  }

  // Script Property overrides for emoji → team name (optional)
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('EMOJI_TEAM_MAP');
    if (raw) {
      var map2 = JSON.parse(raw);
      for (var eid in map2) if (map2.hasOwnProperty(eid)) {
        var tname = String(map2[eid]);
        for (var i = 0; i < out.length; i++) if (out[i].name === tname) { out[i].emojiId = eid; break; }
      }
    }
  } catch (e) {}

  return out;
}


function parseEmojiCell_(val) {
  var s = String(val || '').trim();
  if (!s) return { id: '', name: '' };
  // Accept either "name:id" or "<:name:id>" or "<a:name:id>"
  var m = s.match(/^<?a?:([A-Za-z0-9_]+):([0-9]+)>?$/);
  if (m) return { name: m[1], id: m[2] };
  var parts = s.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return { name: parts[0], id: parts[1] };
  return { id: '', name: s };
}

/**
 * Build search index from roster rows.
 * - byEmojiId:  id -> team
 * - byEmojiName: name -> team (fallback if someone types :name:)
 * - byCompactName: compact("EMO FRAG SQAUD") -> team (full compact match)
 * - byUniqueToken: token -> team (only if token is unique across all teams)
 * - byAcronym: acronym("EMO FRAG SQAUD") = "efs" -> team
 */
function buildTeamIndex_(rows) {
  var byEmojiId = {};
  var byEmojiName = {};
  var byCompactName = {};
  var tokenToTeams = {}; // token -> set of team indices
  var byAcronym = {};
  var teams = [];

  function addToken(token, idx) {
    if (!token) return;
    if (!tokenToTeams[token]) tokenToTeams[token] = {};
    tokenToTeams[token][idx] = true;
  }

  for (var i = 0; i < rows.length; i++) {
    var t = rows[i];
    var name = t.name;
    var compact = compactKey_(name);
    var tokens = nameTokens_(name);
    var acr = acronym_(tokens);

    teams.push({ id: String(i), name: name, division: t.division, compact: compact, tokens: tokens });

    byCompactName[compact] = i;
    if (acr) byAcronym[acr] = i;

    // Emoji maps
    if (t.emojiId) byEmojiId[String(t.emojiId)] = i;
    if (t.emojiName) byEmojiName[normToken_(t.emojiName)] = i;

    // Tokens from name
    for (var j = 0; j < tokens.length; j++) addToken(tokens[j], i);

    // Aliases/abbrev tokens
    var al = (t.aliases || []).slice();
    if (t.abbrev) al.push(t.abbrev);
    for (var a = 0; a < al.length; a++) {
      var toks = nameTokens_(al[a]);
      for (var k = 0; k < toks.length; k++) addToken(toks[k], i);
      var acr2 = acronym_(toks);
      if (acr2 && !byAcronym[acr2]) byAcronym[acr2] = i;
    }
  }

  // Compute unique tokens (partial-name support: e.g., "emo" → only EMO FRAG SQAUD)
  var byUniqueToken = {};
  for (var token in tokenToTeams) if (tokenToTeams.hasOwnProperty(token)) {
    var bucket = tokenToTeams[token];
    var ids = Object.keys(bucket);
    if (ids.length === 1) byUniqueToken[token] = parseInt(ids[0], 10);
  }

  return { teams: teams, byEmojiId: byEmojiId, byEmojiName: byEmojiName, byCompactName: byCompactName, byUniqueToken: byUniqueToken, byAcronym: byAcronym };
}

// ---------------- Matching ----------------
function matchTeamsInLine_(line, idx) {
  var out = [];
  var seen = {};
  var norm = ' ' + normalizeText_(line) + ' ';

  // 1) custom emoji <a?:name:id>
  var re = /<a?:([A-Za-z0-9_]+):([0-9]+)>/g, m;
  while ((m = re.exec(line))) {
    var id = String(m[2]);
    var ti = idx.byEmojiId[id];
    if (ti != null && !seen[ti]) { seen[ti] = true; out.push(idx.teams[ti]); }
  }

  // 2) :name: plain form
  var re2 = /:([A-Za-z0-9_]+):/g, m2;
  while ((m2 = re2.exec(line))) {
    var nm = normToken_(m2[1]);
    var ti2 = idx.byEmojiName[nm];
    if (ti2 != null && !seen[ti2]) { seen[ti2] = true; out.push(idx.teams[ti2]); }
  }

  // 3) full compact name presence NEW (c already has leading/trailing spaces baked in)
  for (var c in idx.byCompactName) if (idx.byCompactName.hasOwnProperty(c)) {
    if (norm.indexOf(c) >= 0) {  // <-- just use c
      var ti3 = idx.byCompactName[c];
      if (ti3 != null && !seen[ti3]) { seen[ti3] = 1; out.push(idx.teams[ti3]); }
    }
  }


  // 4) unique tokens (partial name support)
  for (var tok in idx.byUniqueToken) if (idx.byUniqueToken.hasOwnProperty(tok)) {
    if (norm.indexOf(' ' + tok + ' ') >= 0) {
      var ti4 = idx.byUniqueToken[tok];
      if (ti4 != null && !seen[ti4]) { seen[ti4] = true; out.push(idx.teams[ti4]); }
    }
  }

  // 5) acronym (e.g., efs)
  var words = norm.split(/\s+/);
  for (var w = 0; w < words.length; w++) {
    var token = words[w];
    if (!token) continue;
    var ti5 = idx.byAcronym[token];
    if (ti5 != null && !seen[ti5]) { seen[ti5] = true; out.push(idx.teams[ti5]); }
  }

  return out;
}

/** Matching with reasons (emoji id, emoji name ~approx, compact/full, unique token, acronym). */
function matchTeamsInLine_withReasons_(line, idx) {
  var out = [], seen = {};
  var norm = ' ' + String(line||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim() + ' ';

  // 1) custom emoji <a?:name:id>
  var re = /<a?:([A-Za-z0-9_]+):([0-9]+)>/g, m;
  while ((m = re.exec(line))) {
    var id = String(m[2]);
    var ti = idx.byEmojiId && idx.byEmojiId[id];
    if (ti == null) ti = resolveEmojiNameToTeam_(m[1], idx); // fallback approx
    if (ti != null && !seen[ti]) { seen[ti]=1; out.push({ team: idx.teams[ti], by:'emoji', emoji: id }); }
  }

  // 2) :name: plain form
  var re2 = /:([A-Za-z0-9_]+):/g, m2;
  while ((m2 = re2.exec(line))) {
    var nm = String(m2[1]||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    var ti2 = idx.byEmojiName && idx.byEmojiName[nm];
    if (ti2 == null) ti2 = resolveEmojiNameToTeam_(m2[1], idx);
    if (ti2 != null && !seen[ti2]) { seen[ti2]=1; out.push({ team: idx.teams[ti2], by:'emoji-name', token:nm }); }
  }

  // 3) full compact name presence
  for (var c in idx.byCompactName) if (idx.byCompactName.hasOwnProperty(c)) {
    if (norm.indexOf(c) >= 0) {
      var ti3 = idx.byCompactName[c];
      if (ti3 != null && !seen[ti3]) { seen[ti3]=1; out.push({ team: idx.teams[ti3], by:'full-compact' }); }
    }
  }

  // 4) unique tokens (partial names)
  for (var tok in idx.byUniqueToken) if (idx.byUniqueToken.hasOwnProperty(tok)) {
    if (norm.indexOf(' ' + tok + ' ') >= 0) {
      var ti4 = idx.byUniqueToken[tok];
      if (ti4 != null && !seen[ti4]) { seen[ti4]=1; out.push({ team: idx.teams[ti4], by:'unique-token', token:tok }); }
    }
  }

  // 5) acronym (e.g., efs)
  var words = norm.split(/\s+/);
  for (var w=0; w<words.length; w++) {
    var token = words[w];
    if (!token) continue;
    var ti5 = idx.byAcronym && idx.byAcronym[token];
    if (ti5 != null && !seen[ti5]) { seen[ti5]=1; out.push({ team: idx.teams[ti5], by:'acronym', token:token }); }
  }

  return out;
}

// ---------------- Time parsing (cheap) ----------------
// REPLACE parseWhenInLine_ with this version (month names + last time wins + PM default)
function parseWhenInLine_(line, refDate) {
  var tz = (typeof getTz_ === 'function') ? getTz_() : 'America/New_York';
  var s  = String(line || '');

  // ---- Base date ----
  var whenBase = refDate ? new Date(refDate) : new Date();
  var y = null, m = null, d = null;

  // Month-name date: "October 5, 2025" (year optional)
  var mName = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/i);
  if (mName) {
    var months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
    m = months[mName[1].toLowerCase()];
    d = parseInt(mName[2], 10);
    y = mName[3] ? parseInt(mName[3], 10) : whenBase.getFullYear();
  }

  // Numeric date: 10/5 or 10-05-2025
  if (y == null && m == null && d == null) {
    var dm = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (dm) {
      m = parseInt(dm[1], 10) - 1;
      d = parseInt(dm[2], 10);
      y = dm[3] ? (function(v){ v = String(v); return v.length === 2 ? (2000 + parseInt(v,10)) : parseInt(v,10); })(dm[3]) : whenBase.getFullYear();
    }
  }

  var when;
  if (y != null && m != null && d != null) {
    when = new Date(y, m, d, 0, 0, 0, 0);
  } else {
    // Fallback to your existing DOW logic: "sunday, monday, ..." in current week
    var low = s.toLowerCase();
    if (typeof startOfWeek_ === 'function' && typeof dayIndex_ === 'function') {
      when = startOfWeek_(whenBase || new Date());
      var wd = dayIndex_(low);
      if (wd >= 0) when = new Date(when.getFullYear(), when.getMonth(), when.getDate() + wd, 0, 0, 0, 0);
      else when = new Date(whenBase);
    } else {
      when = new Date(whenBase);
    }
  }

  // ---- Time candidates ----
  var candidates = [];
  // explicit am/pm
  var reAP = /\b(\d{1,2})(?:[:\.](\d{2}))?\s*(am|pm)\b/ig, mAP;
  var m_;
  while ((m_ = reAP.exec(s)) !== null) {
    candidates.push({ kind:'ap', hh:parseInt(m_[1],10), mm:parseInt(m_[2]||'0',10), ap:m_[3].toLowerCase(), pos:m_.index });
  }
  // HH:MM without am/pm
  var reHM = /\b(\d{1,2})[:\.](\d{2})\b/g, mHM;
  while ((mHM = reHM.exec(s)) !== null) {
    candidates.push({ kind:'hm', hh:parseInt(mHM[1],10), mm:parseInt(mHM[2],10), ap:null, pos:mHM.index });
  }
  // compact 3–4 digit (930 / 0930 / 1230), optionally followed by ET/EST/PM/AM
  var reC = /\b(\d{3,4})(?:\s*(et|est|pm|am))?\b/ig, mC;
  while ((mC = reC.exec(s)) !== null) {
    var raw = mC[1], ap2 = (mC[2]||'').toLowerCase();
    var hh2 = (raw.length===3) ? parseInt(raw.charAt(0),10) : parseInt(raw.slice(0,2),10);
    var mm2 = (raw.length===3) ? parseInt(raw.slice(1),10)  : parseInt(raw.slice(2),10);
    if (hh2 >= 1 && hh2 <= 12 && mm2 <= 59) candidates.push({ kind:'compact', hh:hh2, mm:mm2, ap:ap2||null, pos:mC.index });
  }

  // choose best (ap > hm > compact), and last occurrence if tie
  function better(a,b){
    var rank = { ap:3, hm:2, compact:1 };
    if (!a) return b;
    if (!b) return a;
    if (rank[b.kind] !== rank[a.kind]) return (rank[b.kind] > rank[a.kind]) ? b : a;
    return (b.pos >= a.pos) ? b : a;
  }
  var chosen = null;
  for (var i=0;i<candidates.length;i++) chosen = better(chosen, candidates[i]);

  var hh24 = 21, mmF = 0; // default to 9:00 PM if no time
  if (chosen) {
    var hh = chosen.hh, ap = chosen.ap;
    mmF = chosen.mm;
    if (!ap) ap = 'pm';
    var h = (hh % 12);
    if (ap === 'pm') h += 12;
    if (ap === 'am' && hh === 12) h = 0;
    hh24 = h;
  }
  when.setHours(hh24, mmF, 0, 0);

  return (typeof toIsoInTz_ === 'function') ? toIsoInTz_(when, tz) : when.toISOString();
}

function parseLineForMatchup_(line, opts) {
  opts = opts || {};
  var idx = getTeamIndexCached_();
  var hint = opts.hintDivision || detectDivisionHint_(line);

  // collect matches (rich) and pick first two distinct
  var found = (typeof matchTeamsInLine_withReasons_ === 'function')
              ? matchTeamsInLine_withReasons_(line, idx)
              : matchTeamsInLine_(line, idx);

  var a = found[0] || null, b = null;
  if (a) for (var i=1;i<found.length;i++){ if (found[i].team ? (found[i].team.id !== a.team.id) : (found[i].name !== a.name)) { b = found[i]; break; } }

  // normalize to {name, division}
  function normT(x){ return x ? (x.team ? x.team : x) : null; }
  var A = normT(a), B = normT(b);

  var finalDiv = null;
  if (A && B && A.division && B.division && A.division === B.division) finalDiv = A.division;
  if (!finalDiv && hint) finalDiv = hint;

  var whenIso = parseWhenInLine_(line, new Date());

  var decision = (!A || !B) ? 'no_pair' : (!finalDiv ? 'division_undetermined' : 'accept');
  var reason = (decision === 'accept') ? 'ok' : (decision === 'no_pair' ? 'found_less_than_two_teams' : 'could_not_determine_division');

  return {
    ok: decision === 'accept',
    line: String(line||''),
    hintDivision: hint || null,
    matches: [A,B].filter(Boolean).map(function(t){
      return { name: t.name, division: t.division, by: (a&&a.by)||null, token: (a&&a.token)||null, emoji: (a&&a.emoji)||null };
    }),
    chosen: (A && B) ? { a: A.name + (A.division?(' ('+A.division+')'):''),
                         b: B.name + (B.division?(' ('+B.division+')'):'') } : null,
    finalDivision: finalDiv || null,
    when: { iso: whenIso },
    decision: decision,
    reason: reason
  };
}


// ---------------- Division Helpers ----------------

function tagToDiv_(ch) {
  ch = String(ch || '').toLowerCase();
  if (ch === 'g') return 'Gold';
  if (ch === 's') return 'Silver';
  if (ch === 'b') return 'Bronze';
  return '';
}

function retargetTeamToDivision_(team, idx, division) {
  if (!team || !division) return null;
  var compact = team.compact;
  for (var i = 0; i < idx.teams.length; i++) {
    var cand = idx.teams[i];
    if (cand.compact === compact && cand.division === division) return cand;
  }
  return null;
}

/** Dynamic division hint detection (names, “division X”, tags like [b], prefixes like b:) */
function detectDivisionHint_(line) {
  var s = String(line || '');
  var low = s.toLowerCase();

  var divs = getDivisionSheets_();
  var normDivs = divs.map(function(d){ return {name:d, norm:_norm_(d), initial: _norm_(d).charAt(0)}; });

  // 1) Exact division names, with word boundaries
  for (var i=0;i<normDivs.length;i++){
    var n = normDivs[i].norm;
    var re = new RegExp('\\b' + n.replace(/\s+/g,'\\s+') + '\\b','i');
    if (re.test(s)) return normDivs[i].name;
    // also match "<name> division" or "division <name>"
    var re2 = new RegExp('\\bdivision\\s+' + n + '\\b','i');
    var re3 = new RegExp('\\b' + n + '\\s+division\\b','i');
    if (re2.test(low) || re3.test(low)) return normDivs[i].name;
  }

  // 2) Short tags like [x] where x is the first letter of a division (dynamic)
  var m = low.match(/\[([a-z])\]/);
  if (m) {
    var ch = m[1];
    for (var j=0;j<normDivs.length;j++) if (normDivs[j].initial === ch) return normDivs[j].name;
  }

  // 3) Prefixes like "g:" or "alpha-" at start or after space
  var m2 = low.match(/(^|\s)([a-z])[:\-]/);
  if (m2) {
    var ch2 = m2[2];
    for (var k=0;k<normDivs.length;k++) if (normDivs[k].initial === ch2) return normDivs[k].name;
  }

  return ''; // no hint
}



// ---------------- Normalization helpers ----------------
function nameTokens_(s) {
  var n = normalizeText_(s);
  if (!n) return [];
  var parts = n.split(' ');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p && p.length >= 2) out.push(p);
  }
  return out;
}

function normToken_(s) { return normalizeText_(s).replace(/\s+/g, ''); }
function compactKey_(s) { return ' ' + normalizeText_(s).replace(/\s+/g, '') + ' '; }

function acronym_(tokens) {
  if (!tokens || !tokens.length) return '';
  var a = '';
  for (var i = 0; i < tokens.length; i++) a += tokens[i].charAt(0);
  return a;
}

// ---------------- Debug helpers ----------------

function _parser_index_check() {
  var idx = getTeamIndexCached_();
  Logger.log('teams=' + (idx.teams && idx.teams.length));
  // log a few to verify divisions loaded
  for (var i = 0; i < Math.min(5, idx.teams.length); i++) {
    Logger.log(idx.teams[i].division + ' :: ' + idx.teams[i].name);
  }
}

/** Explain how a single line is parsed (hint, matches with reasons, final decision). */
function parser_debugLine_(line) {
  var idx = getTeamIndexCached_();
  var hint = detectDivisionHint_(line);
  var found = matchTeamsInLine_withReasons_(line, idx);

  // choose first two distinct
  var a = found[0] || null, b = null;
  if (a) {
    for (var i=1;i<found.length;i++){ if (found[i].team.id !== a.team.id) { b = found[i]; break; } }
  }

  var retargetA = null, retargetB = null, finalDiv = null;
  if (a && b) {
    if (hint) {
      if (a.team.division !== hint) retargetA = retargetTeamToDivision_(a.team, idx, hint);
      if (b.team.division !== hint) retargetB = retargetTeamToDivision_(b.team, idx, hint);
    }
    var A = retargetA || (a && a.team);
    var B = retargetB || (b && b.team);
    finalDiv = (A && B && A.division === B.division) ? A.division : (hint || null);
  }

  var decision = null, reason = null;
  if (!a || !b) { decision = 'reject'; reason = !a ? 'no_match' : 'one_team_only'; }
  else if (!finalDiv) { decision = 'reject'; reason = 'division_undetermined'; }
  else { decision = 'accept'; reason = 'ok'; }

  return {
    line: line,
    hintDivision: hint || null,
    matches: found.map(function(x){ return { name:x.team.name, division:x.team.division, by:x.by, token:x.token||null, emoji:x.emoji||null }; }),
    chosen: a && b ? { a: a.team.name + ' (' + a.team.division + ')', b: b.team.name + ' (' + b.team.division + ')' } : null,
    retargeted: (retargetA||retargetB) ? {
      a: retargetA ? (retargetA.name + ' ('+retargetA.division+')') : null,
      b: retargetB ? (retargetB.name + ' ('+retargetB.division+')') : null
    } : null,
    finalDivision: finalDiv,
    decision: decision,
    reason: reason
  };
}

function _resetTeamIndexCacheOnce_() {
  var sp = PropertiesService.getScriptProperties();
  var key = 'TEAM_INDEX_V4:' + (sp.getProperty('SPREADSHEET_ID') || '') + ':' + getDivisionSheets_().join(',');
  CacheService.getScriptCache().remove(key);
  Logger.log('Cleared %s', key);
}

function resetCache(){
  _resetTeamIndexCacheOnce_();
}

function resolveEmojiNameToTeam_(emojiName, idx){
  var s = String(emojiName||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  if (!s || !idx || !idx.teams) return null;
  if (idx.byEmojiName && idx.byEmojiName[s] != null) return idx.byEmojiName[s];
  var best = {i:null, score:0};
  for (var i=0;i<idx.teams.length;i++){
    var t = idx.teams[i];
    var comps = [t.compact].concat(t.aliases || []).map(function(a){return String(a||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();});
    for (var j=0;j<comps.length;j++){
      var key = comps[j]; if (!key) continue;
      if (s.indexOf(key) !== -1 && key.length > best.score) { best = {i:i, score:key.length}; }
    }
  }
  return best.i;
}

function parseDebug_(line, hintDivision) {
  var res = null, err = null;
  try {
    res = parseLineForMatchup_(String(line||''), { hintDivision: hintDivision||null, trace:true });
  } catch (e) {
    err = String(e && e.message || e);
  }
  try { logLocal_('INFO','parse.debug',{ line:line, hint:hintDivision||null, result:res, error:err }); } catch(_) {}
  return res || { ok:false, reason: err||'no_result' };
}

/***********************
 * Minimal utilities (safe fallbacks if your project already defines them)
 ***********************/
function _norm_(s) {
  try { if (typeof normalizeText_ === 'function') return normalizeText_(s); } catch(_){}
  s = String(s || '').toLowerCase();
  s = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g,'') : s;
  return s.replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function _whenString_(text) {
  try { if (typeof whenStringFromText_ === 'function') return whenStringFromText_(text); } catch(_){}
  // fallback: very simple "9", "930", "9:30", "... am/pm", plus date like 10/5[/2025]
  var s = String(text||'');
  var mDate = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  var dateStr = mDate ? mDate[0] : '';
  var mTime = s.match(/\b(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/i);
  var hh=null, mm='00', ap=null;
  if (mTime) {
    hh = parseInt(mTime[1],10);
    if (mTime[2]) mm = mTime[2];
    ap = (mTime[3]||'').toLowerCase();
  } else {
    var mc = s.match(/\b(\d{3,4})\b/);
    if (mc) {
      var t = mc[1];
      if (t.length===3){ hh=parseInt(t.charAt(0),10); mm=t.slice(1); }
      else { hh=parseInt(t.slice(0,2),10); mm=t.slice(2); }
    }
  }
  if (hh==null) return dateStr || '';
  if (!ap) ap = 'pm';
  ap = ap.toUpperCase();
  mm = ('0'+String(parseInt(mm,10)||0)).slice(-2);
  var displayH = (hh%12)===0 ? 12 : (hh%12);
  var timeStr = displayH + ':' + mm + ' ' + ap + ' ET';
  return (dateStr ? (dateStr+' ') : '') + timeStr;
}
function _canonDiv_(d) {
  var s = String(d||'').toLowerCase();
  if (/bronze/.test(s)) return 'Bronze';
  if (/silver/.test(s)) return 'Silver';
  if (/gold/.test(s))   return 'Gold';
  return '';
}
function _getDivisions_() {
  try { if (typeof getDivisionSheets_==='function') return getDivisionSheets_(); } catch(_){}
  return ['Bronze','Silver','Gold'];
}

/***********************
 * Team index access
 ***********************/
function _getTeamIndex_() {
  try {
    if (typeof getTeamIndexCached_ === 'function') {
      var idx = getTeamIndexCached_();
      if (idx && idx.teams && idx.teams.length) return idx;
    }
  } catch(_){}
  return { teams: [] };
}

/***********************
 * Division inference from text or hint
 ***********************/
function _divisionFromTextOrHint_(line, hintDivision) {
  var fromHint = _canonDiv_(hintDivision);
  if (fromHint) return fromHint;
  var s = _norm_(line);
  if (/\bbronze\b/.test(s)) return 'Bronze';
  if (/\bsilver\b/.test(s)) return 'Silver';
  if (/\bgold\b/.test(s))   return 'Gold';
  return '';
}

/***********************
 * Emoji tokens :something_like_this:
 ***********************/
function _emojiTokens_(line) {
  var out = [];
  var re = /:([a-z0-9_]+):/gi, m;
  while ((m = re.exec(String(line||''))) !== null) out.push(m[1].toLowerCase());
  return out;
}

/***********************
 * Team matching (full, partial, emoji)
 ***********************/
function _scoreTeamAgainstLine_(team, lineNorm, emojis) {
  var score = 0;
  var name = String(team.name||'');
  var div  = String(team.division||'');
  var nName = _norm_(name);               // "emo frag sqaud"
  var words = nName.split(' ').filter(function(w){ return w.length>=3; });

  // Strong: full normalized name as a whole-word substring
  if (nName && lineNorm.indexOf(nName) >= 0) score += 10;

  // Medium: any >=3 char word appears
  for (var i=0;i<words.length;i++){
    if (lineNorm.indexOf(words[i]) >= 0) score += 3;
  }

  // Emoji hint: if an emoji token is a substring of the normalized team name (or vice versa)
  for (var j=0;j<emojis.length;j++){
    var e = emojis[j];
    if (!e || e.length<3) continue;
    if (nName.indexOf(e) >= 0 || e.indexOf(nName.replace(/\s+/g,'_')) >= 0) score += 5;
  }

  return score;
}

function _findTeamsInLine_(line, divHint) {
  var idx = _getTeamIndex_();
  var emojis = _emojiTokens_(line);
  var lineNorm = _norm_(line);
  var divPref = _canonDiv_(divHint);
  var candidates = [];

  for (var i=0;i<idx.teams.length;i++){
    var t = idx.teams[i];
    if (!t || !t.name) continue;
    if (divPref && _canonDiv_(t.division) !== divPref) {
      // prefer hinted division; but still allow if score is very high — handled in ranking
    }
    var sc = _scoreTeamAgainstLine_(t, lineNorm, emojis);
    if (sc>0) candidates.push({ team:t, score:sc });
  }

  // Rank: by score, then prefer matching division if tie-ish
  candidates.sort(function(a,b){
    if (b.score !== a.score) return b.score - a.score;
    var ad = _canonDiv_(a.team.division), bd = _canonDiv_(b.team.division);
    if (divPref) {
      var ai = (ad===divPref)?0:1, bi = (bd===divPref)?0:1;
      if (ai!==bi) return ai - bi;
    }
    return String(a.team.name).localeCompare(String(b.team.name));
  });

  // Pick top two distinct team names (avoid same team twice)
  var out = [];
  for (var k=0;k<candidates.length && out.length<2;k++){
    var nm = candidates[k].team.name;
    if (out.length===0 || out[0].team.name !== nm) out.push(candidates[k]);
  }
  return out.map(function(x){
    return {
      name: x.team.name,
      division: _canonDiv_(x.team.division) || x.team.division || '',
      by: 'score',
      token: null,
      emoji: emojis.length ? emojis.join(',') : null,
      _score: x.score
    };
  });
}

/***********************
 * Week/date anchoring (optional if helpers exist)
 ***********************/
function _currentWeekMeta_() {
  var meta = { dateISO:'', map:'' };
  try {
    var week = (typeof getAlignedUpcomingWeekOrReport_==='function') ? getAlignedUpcomingWeekOrReport_() : null;
    if (week && typeof chooseWeekMetaAcrossDivisions_==='function') {
      var m = chooseWeekMetaAcrossDivisions_(week);
      if (m && m.dateISO) { meta.dateISO = m.dateISO; meta.map = m.map||''; return meta; }
    }
    if (week && week.weekKey && week.weekKey.indexOf('|')>-1) {
      meta.dateISO = week.weekKey.split('|')[0];
      meta.map = week.weekKey.split('|')[1] || '';
      return meta;
    }
  } catch(_){}
  return meta;
}

/***********************
 * Main entry
 ***********************/
function parseLineForMatchup_(line, opts) {
  opts = opts || {};
  var divisions = _getDivisions_();
  var hintDiv = _canonDiv_(opts.hintDivision);
  var divFromText = _divisionFromTextOrHint_(line, null);
  var div = hintDiv || divFromText || '';

  var matches = _findTeamsInLine_(line, div);
  if (matches.length < 2) {
    return { ok:false, line:line, hintDivision:opts.hintDivision||null, matches:matches, decision:'no_pair', reason:'found_less_than_two_teams' };
  }

  var a = matches[0], b = matches[1];
  var finalDiv = div || ((a.division && b.division && a.division===b.division) ? a.division : (a.division||b.division||''));

  // get week ISO for better date anchoring
  var wkISO = (function(){
    try {
      var w = (typeof getAlignedUpcomingWeekOrReport_==='function') ? getAlignedUpcomingWeekOrReport_() : null;
      if (w && w.weekKey && w.weekKey.indexOf('|')>-1) return w.weekKey.split('|')[0];
      if (typeof chooseWeekMetaAcrossDivisions_==='function') {
        var m = chooseWeekMetaAcrossDivisions_(w);
        if (m && m.dateISO) return m.dateISO;
      }
    } catch(_){}
    return null;
  })();

  var whenText = _whenString_(line, wkISO);

  return {
    ok: true,
    line: line,
    hintDivision: opts.hintDivision || null,
    matches: matches,
    chosen: { a: a.name + (a.division?(' ('+a.division+')'):''),
              b: b.name + (b.division?(' ('+b.division+')'):'') },
    finalDivision: finalDiv || null,
    when: { text: whenText },  // your scheduler can still build epochSec (default 9pm) from the aligned week
    decision: finalDiv ? 'accept' : 'division_undetermined',
    reason: finalDiv ? 'ok' : 'could_not_determine_division'
  };
}


/***********************
 * Debug wrapper (if you didn't add it yet)
 ***********************/
function parseDebug_(line, hintDivision) {
  var res = null, err = null;
  try {
    res = parseLineForMatchup_(String(line||''), { hintDivision: hintDivision||null, trace:true });
  } catch (e) {
    err = String(e && e.message || e);
  }
  try { logLocal_('INFO','parse.debug',{ line:line, hint:hintDivision||null, result:res, error:err }); } catch(_) {}
  return res || { ok:false, reason: err||'no_result' };
}

function parseLine_(text, hintDivision) {
  return parseLineForMatchup_(String(text||''), { hintDivision: hintDivision||null, trace:false });
}

function parseMessageLine_(text, hintDivision) {
  return parseLineForMatchup_(String(text||''), { hintDivision: hintDivision||null, trace:false });
}

function _whenString_(text, weekISO) {
  var s = String(text||'');

  // ---- DATE ----
  var y=null,m=null,d=null;

  // Month-name date: "October 5, 2025" (year optional)
  var mName = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/i);
  if (mName) {
    var months = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11};
    m = months[mName[1].toLowerCase()];
    d = parseInt(mName[2],10);
    y = mName[3] ? parseInt(mName[3],10) : null;
  }

  // Numeric date: 10/5 or 10-05-2025
  if (y==null && m==null && d==null) {
    var mNum = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (mNum) {
      m = parseInt(mNum[1],10)-1;
      d = parseInt(mNum[2],10);
      y = mNum[3] ? (function(v){ v=String(v); return v.length===2 ? (2000+parseInt(v,10)) : parseInt(v,10); })(mNum[3]) : null;
    }
  }

  // Fallback date from weekISO
  if ((y==null || m==null || d==null) && weekISO) {
    var p = String(weekISO).split('-');
    if (p.length>=3) { y = parseInt(p[0],10); m = parseInt(p[1],10)-1; d = parseInt(p[2],10); }
  }

  // If still no date, we'll return time only in text; epoch will be null.

  // ---- TIME (choose best & last) ----
  var timeCandidates = [];

  // 1) explicit am/pm (best)
  var reAP = /\b(\d{1,2})(?:[:\.](\d{2}))?\s*(am|pm)\b/ig, mAP;
  while ((mAP = reAP.exec(s)) !== null) {
    timeCandidates.push({ kind: 'ap', hh: parseInt(mAP[1],10), mm: parseInt(mAP[2]||'0',10), ap: mAP[3].toLowerCase(), pos: mAP.index });
  }

  // 2) HH:MM without am/pm
  var reHM = /\b(\d{1,2})[:\.](\d{2})\b/g, mHM;
  while ((mHM = reHM.exec(s)) !== null) {
    timeCandidates.push({ kind: 'hm', hh: parseInt(mHM[1],10), mm: parseInt(mHM[2],10), ap: null, pos: mHM.index });
  }

  // 3) compact 3–4 digit times (e.g., 930, 0930, 1230) — *only* if followed by timezone tokens or near end
  var reC = /\b(\d{3,4})(?:\s*(et|est|pm|am))?\b/ig, mC;
  while ((mC = reC.exec(s)) !== null) {
    var raw = mC[1], ap = (mC[2]||'').toLowerCase();
    var hh = (raw.length===3) ? parseInt(raw.charAt(0),10) : parseInt(raw.slice(0,2),10);
    var mm = (raw.length===3) ? parseInt(raw.slice(1),10)  : parseInt(raw.slice(2),10);
    // Heuristic: ignore compact numbers that are obviously part of a date like "October 5"
    if (mm<=59 && hh>=1 && hh<=12) {
      timeCandidates.push({ kind: 'compact', hh: hh, mm: mm, ap: ap||null, pos: mC.index });
    }
  }

  // Choose best by priority (ap > hm > compact), and if tie, the LAST occurrence
  var chosen = null;
  function better(a,b){
    var rank = { ap:3, hm:2, compact:1 };
    if (!a) return b;
    if (!b) return a;
    if (rank[b.kind] !== rank[a.kind]) return (rank[b.kind] > rank[a.kind]) ? b : a;
    return (b.pos >= a.pos) ? b : a;
  }
  for (var i=0;i<timeCandidates.length;i++) chosen = better(chosen, timeCandidates[i]);

  var tzText = 'ET';
  var hh = null, mm = null;
  if (chosen) {
    hh = chosen.hh; mm = chosen.mm;
    var ap = chosen.ap;
    if (!ap) ap = 'pm'; // default PM if unspecified
    var displayH = (hh%12)===0 ? 12 : (hh%12);
    var mmStr = ('0'+mm).slice(-2);
    var timeStr = displayH + ':' + mmStr + ' ' + ap.toUpperCase() + ' ' + tzText;

    // Build text and epoch if we also have a date
    var dateStr = '';
    if (y!=null && m!=null && d!=null) {
      // Short date for text; you can swap to long if you prefer
      dateStr = (m+1) + '/' + d + '/' + y;
      var h24 = displayH % 12 + (ap==='pm' ? 12 : 0);
      if (ap==='am' && displayH===12) h24 = 0;
      var dt = new Date(y, m, d, h24, mm, 0, 0);
      return dateStr + ' ' + timeStr; // human text; epoch provided via separate helper in your code if needed
    }
    return timeStr; // time only
  } else {
    // No explicit time; if we have a date, you’ll schedule default 9:00 PM elsewhere
    if (y!=null && m!=null && d!=null) return (m+1)+'/'+d+'/'+y;
    return '';
  }
}

/**
 * Parse ":shoutcast: dod_map team1 vs team2"
 * Returns { ok, map, home, away, reason } on success/failure.
 */
function parseShoutcastCommand_(line) {
  var s = String(line || '');
  // Must contain "shoutcast" somehow (emoji or plain)
  if (!/shoutcast/i.test(s)) {
    return { ok:false, reason:'no_shoutcast_token' };
  }

  // Extract map token like dod_anzio / dod_railyard_b6
  var mMap = s.match(/\b(dod_[a-z0-9_]+)\b/i);
  var map = mMap ? mMap[1].toLowerCase() : '';

  // Remove obvious noise (mentions, emojis)
  var cleaned = s
    .replace(/<[@#][!&]?\d+>/g, ' ')
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, ' ')
    .replace(/(^|\s)@[\w\-]+/g, ' ')
    .replace(/:shoutcast:/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Let the normal line parser find the two teams
  var r = (typeof parseLineForMatchup_==='function')
        ? parseLineForMatchup_(cleaned, { trace:false })
        : null;

  if (!r || !r.matches || r.matches.length < 2) {
    return { ok:false, reason:'no_pair' };
  }

  var A = r.matches[0], B = r.matches[1];
  if (!A || !B) return { ok:false, reason:'no_pair' };

  // BYE guard
  if (String(A.name||'').toUpperCase() === 'BYE' || String(B.name||'').toUpperCase() === 'BYE') {
    return { ok:false, reason:'bye_pair_ignored' };
  }

  return { ok:true, map: map, home: A.name, away: B.name };
}

// 60_parser.gs (or 20_relay.gs—where you process inbound messages)
function tryStoreTwitchFromText_(userId, username, text) {
  var m = String(text||'').match(/\bhttps?:\/\/(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+/i);
  if (!m) return false;
  setTwitchForUser_(userId, username||'', m[0]);
  try { logLocal_('INFO','twitch.saved',{ userId:userId, url:m[0] }); } catch(_){}
  return true;
}


