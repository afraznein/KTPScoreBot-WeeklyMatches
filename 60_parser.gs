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

function parseScheduleMessage_v2(text) {
  var clean = stripDiscordUsers_(String(text || ''));
  var idx = getTeamIndexCached_();
  var lines = clean.split(/\r?\n/);
  var weekKey = (typeof weekKey_ === 'function') ? weekKey_(new Date()) : isoWeekKey_(new Date());

  var outPairs = [];
  var errs = [];

 for (var i = 0; i < lines.length; i++) {
  var raw = lines[i];
  var line = raw.trim();
  if (!line) continue;

  var hintDiv = detectDivisionHint_(line); // "Bronze" | "Silver" | "Gold" | ''

  var matches = matchTeamsInLine_(line, idx);
  if (matches.length >= 2) {
    var a = matches[0];
    var b = null;
    for (var k = 1; k < matches.length; k++) { if (matches[k].id !== a.id) { b = matches[k]; break; } }
    if (!b) { errs.push({ line: raw, reason: 'one_team_only', team: a && a.name }); continue; }

    // If a division is hinted, retarget each team to that division if there’s a duplicate across sheets
    if (hintDiv) {
      if (a.division !== hintDiv) a = retargetTeamToDivision_(a, idx, hintDiv) || a;
      if (b.division !== hintDiv) b = retargetTeamToDivision_(b, idx, hintDiv) || b;
    }

    var div = (a.division === b.division) ? a.division : (hintDiv || null);
    div = canonDivision_(div) || null;   
    if (!div) { errs.push({ line: raw, reason: 'division_ambiguous', teams: [a.name+'('+a.division+')', b.name+'('+b.division+')'] }); continue; }

    var when = parseWhenInLine_(line, new Date());
    outPairs.push({ division: div, home: a.name, away: b.name, when: when, sourceLine: raw });
  } 
  else {
    errs.push({ line: raw, reason: 'no_pair' });
  }
}
return { weekKey: weekKey, pairs: outPairs, errors: errs };
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
  if (typeof loadTeamRosterSnapshot_ === 'function') return loadTeamRosterSnapshot_();

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
function parseWhenInLine_(line, refDate) {
  var tz = getTz_();
  var text = String(line || '').toLowerCase();

  // date (e.g., 9/28 or 09/28[/2025])
  var when = new Date(refDate || new Date());
  var dm = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    var m = parseInt(dm[1], 10) - 1;
    var d = parseInt(dm[2], 10);
    var y = dm[3] ? parseInt(dm[3], 10) : when.getFullYear();
    if (y < 100) y += 2000;
    when = new Date(y, m, d, 0, 0, 0, 0);
  } else {
    when = startOfWeek_(refDate || new Date());
    var wd = dayIndex_(text);
    if (wd >= 0) when.setDate(when.getDate() + wd);
  }

  // time parsing (AM/PM, HH:MM, “9est/930est”) — default PM if none
  var t1 = text.match(/\b(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  var h = 20, mm = 0;
  if (t1) {
    h = parseInt(t1[1], 10); mm = t1[2] ? parseInt(t1[2], 10) : 0;
    if (/p/i.test(t1[3]) && h < 12) h += 12;
    if (/a/i.test(t1[3]) && h === 12) h = 0;
  } else {
    var t2 = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (t2) {
      h = parseInt(t2[1], 10); mm = parseInt(t2[2], 10);
      if (h <= 12) h = (h % 12) + 12;
    } else {
      var t3 = text.match(/\b(\d{1,2})(\d{2})?\s*(e[ds]t)\b/);
      if (t3) {
        h = parseInt(t3[1], 10); mm = t3[2] ? parseInt(t3[2], 10) : 0;
        if (h <= 12) h = (h % 12) + 12;
      } else {
        var t4 = text.match(/\b(\d{1,2})\s*(e[ds]t)\b/);
        if (t4) { h = parseInt(t4[1], 10); mm = 0; if (h <= 12) h = (h % 12) + 12; }
        else return null;
      }
    }
  }

  when.setHours(h, mm, 0, 0);
  return toIsoInTz_(when, tz);
}

// ---------------- Division Helpers ----------------
// (removed simpler duplicate detectDivisionHint_)

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

function _parser_smoketest() {
  var sample = [
    "GOLD: EMO vs LA Bears 8:30",
    "[s] Emo Frag SquaD vs Knights 9:00",
    "bronze - :emo_frag: vs :la_bears: 20:15"
  ].join("\n");
  var res = parseScheduleMessage_(sample);
  Logger.log(JSON.stringify(res, null, 2));
}

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

function RunDebugOnSampleLine() {
  // Replace this sample with a real failing line from Discord
  var sample = "@chi @JgNatoRcJm dod_railyard_b6 gskill vs icyhot 9/28 9est";
  var res = parser_debugLine_(sample);
  Logger.log(JSON.stringify(res, null, 2));
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


// Back-compat alias
function loadTeamRosterSnapshot_(){ return fetchRosterSnapshot_(); }