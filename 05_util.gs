// =======================
// util.gs – General helper functions (dates, strings, caching, logging, etc.)
// =======================

/**
 * Get version information for display
 * @returns {Object} {version, date, formatted}
 */
function getVersionInfo_() {
  const v = (typeof VERSION !== 'undefined') ? VERSION : '0.0.0';
  const d = (typeof VERSION_DATE !== 'undefined') ? VERSION_DATE : 'unknown';
  return {
    version: v,
    date: d,
    formatted: `v${v} (${d})`
  };
}

/**
 * Log version info to Discord on startup/config changes
 * Call this from any initialization function or manually from menu
 */
function logVersionToDiscord_() {
  const info = getVersionInfo_();
  const msg = `🤖 **KTPScoreBot-WeeklyMatches** ${info.formatted} ready`;

  // Use sendLog_ if available, otherwise post directly
  if (typeof sendLog_ === 'function') {
    sendLog_(msg);
  } else if (typeof postChannelMessage_ === 'function' && typeof RESULTS_LOG_CHANNEL_ID !== 'undefined') {
    postChannelMessage_(RESULTS_LOG_CHANNEL_ID, msg);
  }
}

function ktpEmoji() { return '<:ktp:' + KTP_EMOJI_ID + '>'; }

function normalizeWhitespace_(s) {
  return String(s || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function isJustPings_(s) {
  // Heuristic: if after removing mentions/emojis we have almost nothing, treat as pings
  var t = String(s || '')
    .replace(/<[@#][!&]?\d+>/g, ' ')
    .replace(/<:[a-z0-9_]+:\d+>/gi, ' ')
    .replace(/:[a-z0-9_]+:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length < 3;
}

function decStringMinusOne_(s) {
  s = String(s || '').trim();
  if (!/^\d+$/.test(s)) return null;
  if (s === '0') return '0';

  var arr = s.split('');
  var i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '0') {
      arr[i] = '9';
      i--;
    } else {
      arr[i] = String(arr[i].charCodeAt(0) - 1 - 48); // '0' -> 48
      break;
    }
  }
  // Remove leading zeros but keep at least one digit
  var out = arr.join('').replace(/^0+/, '');
  return out || '0';
}

// ----- DATE & TIME HELPERS -----
/** Parse a Date from text like "9/28", "09-28-2025", or "Sep 28". */
function parseDateFromText_(text, refYear) {
  const s = String(text || '');
  const m = s.match(/\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?\b/);
  if (m) {
    let yy = m[3] ? parseInt(m[3], 10) : (refYear || new Date().getFullYear());
    if (yy < 100) yy += 2000;
    return new Date(yy, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }
  const m2 = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i);
  if (m2) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    const yy2 = refYear || new Date().getFullYear();
    return new Date(yy2, months[m2[1].slice(0, 3).toLowerCase()], parseInt(m2[2], 10));
  }
  return null;
}

/** Project timezone (or override TZ from script properties). */
function getTimezone_() {
  const sp = PropertiesService.getScriptProperties();
  return sp.getProperty('TZ') || Session.getScriptTimeZone() || 'America/New_York';
}
/** Alias for compatibility */
function getTz_() { return getTimezone_(); }

function discordEpochAt9pmFromISO(dateISO, tz) {
  if (!dateISO) return null;
  tz = tz || (typeof getTimezone_ === 'function' ? getTimezone_() : 'America/New_York');
  // Apps Script `Date` uses project timezone; set that to your league TZ in Project Settings for perfect alignment.
  var p = String(dateISO).split('-');
  var y = +p[0], m = +p[1] - 1, d = +p[2];
  var dt = new Date(y, m, d, 21, 0, 0, 0); // 9:00 PM local
  return Math.floor(dt.getTime() / 1000);
}

// ----- STRING & TEXT HELPERS -----
/** Normalize generic token text (lowercase, strip non-alphanumeric). */
function formatWeeklyNotice_(week, actionWord) {
  var tz = (week && week.tz) || (typeof getTimezone_ === 'function' ? getTimezone_() : 'America/New_York');
  var season = (week && week.seasonWeek) || '';
  var mapRef = (week && week.mapRef) || '';
  var seasonInfo = (typeof getSeasonInfo_ === 'function' ? getSeasonInfo_() : '');
  var ts = Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a z');

  // :white_check_mark: <KTP_SEASON_INFO> <season> <mapRef> Weekly Boards <Posted/Edited>. <timestamp> <:ktp:...>
  return ':white_check_mark: ' +
    [seasonInfo, season, mapRef].filter(Boolean).join(' ') +
    ' Weekly Boards ' + (actionWord || 'Posted/Edited') + '. ' +
    ts + ' ' + ktpEmoji();
}

/** Normalize map key to lowercase (dod_*). */
function normalizeMap(s) {
  return String(s || '').trim().toLowerCase();
}

// ----- SNOWFLAKE (Discord ID) HELPERS -----

/** Compare two Discord snowflake IDs (as strings). Returns -1, 0, or 1. */
function compareSnowflakes(a, b) {
  if (BigInt(a) < BigInt(b)) return -1;
  if (BigInt(a) > BigInt(b)) return 1;
  return 0;
}

/** Return the larger of two Discord snowflake IDs (as strings). */
function maxSnowflake(a, b) {
  if (!a) return b;
  if (!b) return a;
  return BigInt(a) > BigInt(b) ? a : b;
}

// ---------- Table formatting helpers (single source of truth) ----------

// Repeat a string n times (used for separators)
function repeat_(ch, n) {
  ch = String(ch || '');
  n = Math.max(0, n | 0);
  return (typeof ch.repeat === 'function') ? ch.repeat(n) : new Array(n + 1).join(ch);
}

function padRight_(s, n) { s = String(s || ''); var k = Math.max(0, n - s.length); return s + (k ? Array(k + 1).join(' ') : ''); }
function padLeft_(s, n) { s = String(s || ''); var k = Math.max(0, n - s.length); return (k ? Array(k + 1).join(' ') : '') + s; }
// Aliases for call sites
function padR_(s, n) { return padRight_(s, n); }
function padL_(s, n) { return padLeft_(s, n); }

function truncate(s, n) { s = String(s || ''); return (s.length > n) ? (s.slice(0, n - 1) + '…') : s; }
function padCenter_(s, n) {s = String(s || ''); var k = Math.max(0, n - s.length), L = Math.floor(k / 2), R = k - L;  return (L ? Array(L + 1).join(' ') : '') + s + (R ? Array(R + 1).join(' ') : '');
}
function padC_(s, n) { return padCenter_(s, n); } // Alias for call sites

// Column widths used by all tables.
// COL1 = "Home vs Away" column width, COL2 = "Scheduled", COL3 = "Shoutcaster"
function getTableWidths_() {
  return { COL1: 43, COL2: 22, COL3: 12 };
}

function formatVsCell_(home, away, col1) {
  var token = ' vs ', L = Math.floor((col1 - token.length) / 2), R = col1 - token.length - L;
  home = truncate(String(home || ''), L); away = truncate(String(away || ''), R);
  return padLeft_(home, L) + token + padRight_(away, R);
}

function formatVsHeader_(col1) { return formatVsCell_('Home', 'Away', col1); }

// Format a single "Home vs Away" cell to match header alignment
function formatVsRow_(home, away, col1) {
  var token = ' vs ', L = Math.floor((col1 - token.length) / 2), R = col1 - token.length - L;
  home = truncate(String(home || ''), L); away = truncate(String(away || ''), R);
  return padLeft_(home, L) + token + padRight_(away, R);
}

function isBye(s) { return /^\s*BYE\s*$/i.test(String(s || '')); }

function idFromRelay(resp) {
  try {
    if (!resp && resp !== 0) return null;
    if (typeof resp === 'string') return resp;
    if (resp.id) return String(resp.id);
    if (resp.message && resp.message.id) return String(resp.message.id);
    if (resp.data && resp.data.id) return String(resp.data.id);
  } catch (e) { }
  return null;
}

function ensureFence_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  return s.startsWith('```') ? s : ('```text\n' + s + '\n```');
}

function stripFence_(s) {
  s = String(s || '');
  var m = s.match(/^```[\s\S]*?\n([\s\S]*?)\n```$/);
  return m ? m[1] : s;
}

function _chunkByLimit_(raw, maxLen) {
  maxLen = maxLen || 1900; // keep headroom for safety
  var out = [];
  var lines = String(raw || '').split('\n');
  var cur = '';
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    // +1 for newline (except first line)
    if ((cur.length ? cur.length + 1 : 0) + ln.length > maxLen) {
      if (cur) out.push(cur);
      cur = ln;
      // Extremely long single line fallback
      while (cur.length > maxLen) {
        out.push(cur.slice(0, maxLen));
        cur = cur.slice(maxLen);
      }
    } else {
      cur = cur ? (cur + '\n' + ln) : ln;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ----- HASH HELPERS -----
function _hashString_(s) { return sha256Hex_(String(s || '')); }

/** 2k-safe hash for strings/objects */
function sha256Hex_(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    out += (b + 0x100).toString(16).slice(1);
  }
  return out;
}
/** remove volatile fields (timestamp/footer) before hashing header */
function _safeHeaderHash_(headerObj) {
  try {
    var h = JSON.parse(JSON.stringify(headerObj || {}));
    if (h && h.embeds && h.embeds[0]) {
      if (h.embeds[0].timestamp) delete h.embeds[0].timestamp;
      if (h.embeds[0].footer) delete h.embeds[0].footer;
    }
    return sha256Hex_(JSON.stringify(h));
  } catch (_) { return ''; }
}

// Hash embeds without footer noise (like _safeHeaderHash_)
function _safeEmbedsHash_(embeds) {
  try {
    var x = JSON.parse(JSON.stringify(embeds || []));
    if (x && x.length) {
      for (var i = 0; i < x.length; i++) {
        if (x[i] && x[i].footer) delete x[i].footer;
      }
    }
    return sha256Hex_(x);
  } catch (e) {
    return sha256Hex_(String(embeds || ''));
  }
}

// ----- CACHING HELPERS -----

function cache_() { return CacheService.getScriptCache(); }

function cacheGetJson_(key) {
  const s = cache_().get(key);
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function cachePutJson_(key, obj, ttlSec) {
  cache_().put(key, JSON.stringify(obj || {}), Math.min(21600, Math.max(30, ttlSec || 300)));
}

let __TEAM_ALIAS_CACHE = null;

function loadTeamAliases_() {
  if (__TEAM_ALIAS_CACHE) return __TEAM_ALIAS_CACHE;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('_Aliases');
  if (!sh) return (__TEAM_ALIAS_CACHE = {});

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(); // alias | canonical
  const aliasMap = {}; // aliasUpper -> canonicalUpper

  for (const [alias, canon] of data) {
    const a = String(alias || '').trim().toUpperCase();
    const c = String(canon || '').trim().toUpperCase();
    if (a && c) aliasMap[a] = c;
  }

  __TEAM_ALIAS_CACHE = aliasMap;
  return aliasMap;
}

/**
 * Build and cache team index for fuzzy team matching.
 * Returns { teams: [ { name, division, aliases: [] }, ... ] }
 * Uses TEAM_CANON_RANGE (A3:A22) from each division sheet + _Aliases sheet.
 */
var __TEAM_INDEX_CACHE = null;
function getTeamIndexCached_() {
  if (__TEAM_INDEX_CACHE) return __TEAM_INDEX_CACHE;

  const teams = [];
  const aliasMap = loadTeamAliases_(); // aliasUpper -> canonicalUpper

  // Invert alias map: canonicalUpper -> [aliasUpper1, aliasUpper2, ...]
  const canonToAliases = {};
  for (const [alias, canon] of Object.entries(aliasMap)) {
    if (!canonToAliases[canon]) canonToAliases[canon] = [];
    canonToAliases[canon].push(alias);
  }

  // Read team names from each division
  const divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze', 'Silver', 'Gold'];
  for (const div of divs) {
    const sh = (typeof getSheetByName === 'function') ? getSheetByName(div) : null;
    if (!sh) continue;

    const vals = sh.getRange(TEAM_CANON_RANGE).getValues().flat();
    for (const v of vals) {
      const name = String(v || '').trim();
      if (!name) continue;

      const nameUpper = name.toUpperCase();
      const aliases = canonToAliases[nameUpper] || [];

      teams.push({
        name: name,
        division: div,
        aliases: aliases
      });
    }
  }

  __TEAM_INDEX_CACHE = { teams };
  return __TEAM_INDEX_CACHE;
}


/**
 * Convert a big tables body (multiple code-fenced sections) into
 * one or more embeds for a single Discord message.
 *
 * Strategy: split on blank lines between sections, pack sections into
 * chunks <= ~3900 chars, preserving the existing ``` fences inside sections.
 */
function _tablesBodyToEmbeds_(body) {
  var MAX = 3900; // under 4096 to allow small headroom
  var parts = String(body || '').split(/\n{2,}/); // split on blank lines
  var embeds = [];
  var cur = '';

  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    var candidate = cur ? (cur + '\n\n' + seg) : seg;
    if (candidate.length > MAX) {
      if (cur) {
        embeds.push({ type: 'rich', description: cur, color: 0x2b6cb0 });
        cur = seg; // start new
      } else {
        // very long single segment; hard split by lines
        var lines = seg.split('\n');
        var buf = '';
        for (var j = 0; j < lines.length; j++) {
          var ln = lines[j];
          if ((buf + (buf ? '\n' : '') + ln).length > MAX) {
            embeds.push({ type: 'rich', description: buf, color: 0x2b6cb0 });
            buf = ln;
          } else {
            buf = buf ? (buf + '\n' + ln) : ln;
          }
        }
        if (buf) embeds.push({ type: 'rich', description: buf, color: 0x2b6cb0 });
        cur = '';
      }
    } else {
      cur = candidate;
    }
  }
  if (cur) embeds.push({ type: 'rich', description: cur, color: 0x2b6cb0 });

  return embeds;
}


// ----- LOGGING -----

/** Append a log entry (timestamped) to console and optionally to Discord log channel. */
function logLocal_(level, event, data) {
  try {
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const line = `[${level}] ${ts} ${event} ${data ? JSON.stringify(data) : ''}`;
    console.log(line);
  } catch (e) {
    // If console logging fails for any reason, do nothing.
  }
}

// ----- SHEET HELPERS -----

/** Get list of division sheet names (from constant DIVISIONS or stored property). */
function getDivisionSheets_() {
  // Use constant DIVISIONS if available and non-empty
  if (Array.isArray(DIVISIONS) && DIVISIONS.length) {
    return DIVISIONS.slice();
  }
  // Fallback: check if stored JSON exists
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('DIV_SHEETS_JSON');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) { }
  // Default fallback
  return ['Bronze', 'Silver', 'Gold'];
}

/** Return the Google Sheet object for a name. */
function getSheetByName(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(String(sheetName)) || null;
}

function getSeasonInfo_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SEASON_INFO);
  if (!sh) return '';
  var v = sh.getRange('A1').getDisplayValue();
  return String(v || '').trim();
}

function colIdx_(letter) {
  letter = String(letter || '').toUpperCase();
  var n = 0;
  for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n || 1;
}

function getGridCols_() {
  var sp = PropertiesService.getScriptProperties();
  function getOrDef(key, def) { return (sp.getProperty(key) || def); }
  var WL1 = colIdx_(getOrDef('GRID_COL_WL1', 'B'));
  var T1 = colIdx_(getOrDef('GRID_COL_TEAM1', 'C'));
  var S1 = colIdx_(getOrDef('GRID_COL_SCORE1', 'D'));
  var WL2 = colIdx_(getOrDef('GRID_COL_WL2', 'F'));
  var T2 = colIdx_(getOrDef('GRID_COL_TEAM2', 'G'));
  var S2 = colIdx_(getOrDef('GRID_COL_SCORE2', 'H'));
  return { WL1: WL1, T1: T1, S1: S1, WL2: WL2, T2: T2, S2: S2 };
}