// =======================
// util.gs – General helper functions (dates, strings, caching, logging, etc.)
// =======================

function ktpEmoji_() { return '<:ktp:' + KTP_EMOJI_ID + '>'; }

function _normalizeWhitespace_(s) {
  return String(s || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function _isJustPings_(s) {
  // Heuristic: if after removing mentions/emojis we have almost nothing, treat as pings
  var t = String(s || '')
    .replace(/<[@#][!&]?\d+>/g, ' ')
    .replace(/<:[a-z0-9_]+:\d+>/gi, ' ')
    .replace(/:[a-z0-9_]+:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length < 3;
}

function _decStringMinusOne_(s) {
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
    const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };
    const yy2 = refYear || new Date().getFullYear();
    return new Date(yy2, months[m2[1].slice(0,3).toLowerCase()], parseInt(m2[2], 10));
  }
  return null;
}

/** Project timezone (or override TZ from script properties). */
function getTz_() {
  const sp = PropertiesService.getScriptProperties();
  return sp.getProperty('TZ') || Session.getScriptTimeZone() || 'America/New_York';
}

function discordEpochAt9pmFromISO_(dateISO, tz) {
  if (!dateISO) return null;
  tz = tz || (typeof getTz_==='function' ? getTz_() : 'America/New_York');
  // Apps Script `Date` uses project timezone; set that to your league TZ in Project Settings for perfect alignment.
  var p = String(dateISO).split('-');
  var y = +p[0], m = +p[1]-1, d = +p[2];
  var dt = new Date(y, m, d, 21, 0, 0, 0); // 9:00 PM local
  return Math.floor(dt.getTime() / 1000);
}

// ----- STRING & TEXT HELPERS -----
/** Normalize generic token text (lowercase, strip non-alphanumeric). */
function formatWeeklyNotice_(week, actionWord) {
  var tz     = (week && week.tz) || (typeof getTz_==='function' ? getTz_() : 'America/New_York');
  var season = (week && week.seasonWeek) || '';
  var mapRef = (week && week.mapRef) || '';
  var seasonInfo = (typeof getSeasonInfo_==='function' ? getSeasonInfo_() : '');
  var ts = Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a z');

  // :white_check_mark: <KTP_SEASON_INFO> <season> <mapRef> Weekly Boards <Posted/Edited>. <timestamp> <:ktp:...>
  return ':white_check_mark: ' +
         [seasonInfo, season, mapRef].filter(Boolean).join(' ') +
         ' Weekly Boards ' + (actionWord || 'Posted/Edited') + '. ' +
         ts + ' ' + ktpEmoji_();
}

/** Normalize map key to lowercase (dod_*). */
function normalizeMap_(s){
  return String(s||'').trim().toLowerCase();
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
function _repeat_(ch, n) {
  ch = String(ch || '');
  n = Math.max(0, n | 0);
  return (typeof ch.repeat === 'function') ? ch.repeat(n) : new Array(n + 1).join(ch);
}

function _padR_(s,n){ s=String(s||''); var k=Math.max(0,n-s.length); return s+(k?Array(k+1).join(' '):''); }
function _padL_(s,n){ s=String(s||''); var k=Math.max(0,n-s.length); return (k?Array(k+1).join(' '):'')+s; }
function _truncate_(s,n){ s=String(s||''); return (s.length>n)?(s.slice(0,n-1)+'…'):s; }
function _padC_(s,n){
  s = String(s||''); var k=Math.max(0,n-s.length), L=Math.floor(k/2), R=k-L;
  return (L?Array(L+1).join(' '):'') + s + (R?Array(R+1).join(' '):'');
}

// Column widths used by all tables.
// COL1 = "Home vs Away" column width, COL2 = "Scheduled", COL3 = "Shoutcaster"
function _getTableWidths_() {
  return { COL1: 43, COL2: 22, COL3: 12 };
}

function _formatVsCell_(home, away, col1) {
  var token=' vs ', L=Math.floor((col1-token.length)/2), R=col1-token.length-L;
  home=_truncate_(String(home||''),L); away=_truncate_(String(away||''),R);
  return _padL_(home,L)+token+_padR_(away,R);
}

function _formatVsHeader_(col1){ return _formatVsCell_('Home','Away',col1); }

// Format a single "Home vs Away" cell to match header alignment
function _formatVsRow_(home, away, col1) {
  var token=' vs ', L=Math.floor((col1-token.length)/2), R=col1-token.length-L;
  home=_truncate_(String(home||''),L); away=_truncate_(String(away||''),R);
  return _padL_(home,L)+token+_padR_(away,R);
}

function __isBye(s){ return /^\s*BYE\s*$/i.test(String(s||'')); }

function idFromRelay_(resp) {
  try {
    if (!resp && resp !== 0) return null;
    if (typeof resp === 'string') return resp;
    if (resp.id) return String(resp.id);
    if (resp.message && resp.message.id) return String(resp.message.id);
    if (resp.data && resp.data.id) return String(resp.data.id);
  } catch (e) {}
  return null;
}

// ----- HASH HELPERS -----
function _hashString_(s) { return sha256Hex_(String(s || '')); }

/**
 * Compute a SHA-256 hash (hex string) of a string or object.
 * - If you pass a non-string, it will JSON.stringify it first.
 */
function sha256Hex_(value) {
  var s = (typeof value === 'string') ? value : JSON.stringify(value || {});
  // Compute digest as bytes (UTF-8), then convert to hex
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    s,
    Utilities.Charset.UTF_8
  );
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) & 0xff;         // normalize signed byte
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function _safeHeaderHash_(h) {
  try {
    var x = JSON.parse(JSON.stringify(h || {}));
    if (x.embeds && x.embeds[0] && x.embeds[0].footer) delete x.embeds[0].footer;
    return sha256Hex_(x);
  } catch (e) {
    return sha256Hex_(String(h || ''));
  }
}

// Hash embeds without footer noise (like _safeHeaderHash_)
function _safeEmbedsHash_(embeds) {
  try {
    var x = JSON.parse(JSON.stringify(embeds || []));
    if (x && x.length) {
      for (var i=0;i<x.length;i++) {
        if (x[i] && x[i].footer) delete x[i].footer;
      }
    }
    return sha256Hex_(x);
  } catch (e) {
    return sha256Hex_(String(embeds || ''));
  }
}

// ----- CACHING HELPERS -----

function cache_(){ return CacheService.getScriptCache(); }

function cacheGetJson_(key){
  const s = cache_().get(key);
  if (!s) return null;
  try { return JSON.parse(s); } catch(e){ return null; }
}

function cachePutJson_(key, obj, ttlSec){
  cache_().put(key, JSON.stringify(obj||{}), Math.min(21600, Math.max(30, ttlSec||300)));
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
        for (var j=0;j<lines.length;j++){
          var ln = lines[j];
          if ((buf + (buf ? '\n' : '') + ln).length > MAX) {
            embeds.push({ type:'rich', description: buf, color: 0x2b6cb0 });
            buf = ln;
          } else {
            buf = buf ? (buf + '\n' + ln) : ln;
          }
        }
        if (buf) embeds.push({ type:'rich', description: buf, color: 0x2b6cb0 });
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
  } catch (e) {}
  // Default fallback
  return ['Bronze', 'Silver', 'Gold'];
}

/** Return the Google Sheet object for a name. */
function getSheetByName_(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(String(sheetName)) || null;
}

function getSeasonInfo_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
  var T1  = colIdx_(getOrDef('GRID_COL_TEAM1', 'C'));
  var S1  = colIdx_(getOrDef('GRID_COL_SCORE1', 'D'));
  var WL2 = colIdx_(getOrDef('GRID_COL_WL2', 'F'));
  var T2  = colIdx_(getOrDef('GRID_COL_TEAM2', 'G'));
  var S2  = colIdx_(getOrDef('GRID_COL_SCORE2', 'H'));
  return { WL1:WL1, T1:T1, S1:S1, WL2:WL2, T2:T2, S2:S2 };
}