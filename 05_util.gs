// =======================
// 05_util.gs - General Utilities & Helpers
// =======================
// Purpose: String formatting, date/time, hashing, caching, table rendering, snowflake math
// Dependencies: 00_config.gs
// Used by: All modules
//
// Functions in this module:
// Version: getVersionInfo, logVersionToDiscord
// Strings: ktpEmoji, normalizeWhitespace, isJustPings, decStringMinusOne, normalizeMap, normalizeTeamText
// Discord: buildDiscordMessageLink
// Dates: parseDateFromText, getTimezone, discordEpochAt9pmFromISO
// Formatting: formatWeeklyNotice
// Snowflakes: compareSnowflakes, maxSnowflake
// Tables: repeat, padRight, padLeft, truncate, padCenter, getTableWidths, formatVsCell, formatVsHeader, formatVsRow
// Helpers: isBye, idFromRelay, ensureFence, stripFence, chunkByLimit
// Hashing: hashString, sha256Hex, safeHeaderHash, safeEmbedsHash
// Caching: cache, cacheGetJson, cachePutJson
// Teams: loadTeamAliases, getTeamIndexCached
// Embeds: tablesBodyToEmbeds
// Sheets: getDivisionSheets, getSheetByName, getSeasonInfo, colIdx, getGridCols
// Cells: getRemainingTime, isNumCell, isWLT, parseEtDate, blockHeaderTop
//
// Total: 48 functions
// =======================

/**
 * Get version information for display
 * @returns {Object} {version, date, formatted}
 */
function getVersionInfo() {
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
function logVersionToDiscord() {
  const info = getVersionInfo();
  const msg = `🤖 **KTPScoreBot-WeeklyMatches** ${info.formatted} ready`;

  // Use sendLog if available, otherwise post directly
  if (typeof sendLog === 'function') {
    sendLog(msg);
  } else if (typeof postChannelMessage === 'function' && typeof RESULTS_LOG_CHANNEL_ID !== 'undefined') {
    postChannelMessage(RESULTS_LOG_CHANNEL_ID, msg);
  }
}

/**
 * Get KTP custom emoji string for Discord.
 * @returns {string} Discord emoji format <:ktp:ID>
 */
function ktpEmoji() { return '<:ktp:' + KTP_EMOJI_ID + '>'; }

/**
 * Normalize whitespace in strings (collapse spaces, normalize newlines).
 * @param {string} s - String to normalize
 * @returns {string} Normalized string
 */
function normalizeWhitespace(s) {
  return String(s || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * Check if string is just Discord pings/mentions with no real content.
 * @param {string} s - String to check
 * @returns {boolean} True if string is just pings/emojis
 */
function isJustPings(s) {
  // Heuristic: if after removing mentions/emojis we have almost nothing, treat as pings
  var t = String(s || '')
    .replace(/<[@#][!&]?\d+>/g, ' ')
    .replace(/<:[a-z0-9_]+:\d+>/gi, ' ')
    .replace(/:[a-z0-9_]+:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length < 3;
}

/**
 * Decrement a numeric string by 1 (used for Discord snowflake arithmetic).
 * @param {string} s - Numeric string
 * @returns {string|null} Decremented string or null if invalid
 */
function decStringMinusOne(s) {
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

/**
 * Normalize map key to lowercase (dod_*).
 * @param {string} s - Map name
 * @returns {string} Normalized lowercase map name
 */
function normalizeMap(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Normalize team text for comparison (lowercase, alphanumeric only).
 * @param {string} s - Team name
 * @returns {string} Normalized team name
 */
function normalizeTeamText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['']s\b/g, 's')    // Handle possessive with both ASCII and curly apostrophes: "Wicked's" or "Wicked's" → "Wickeds"
    .replace(/\s*['']['\s]*s\b/g, 's')  // Handle spaced possessives: "Wicked ' s" → "Wickeds"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a Discord message link (clickable URL to jump to a message).
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - Discord message ID
 * @param {string} guildId - Discord guild/server ID (optional, defaults to DISCORD_GUILD_ID)
 * @returns {string} Discord message URL or empty string if missing required IDs
 */
function buildDiscordMessageLink(channelId, messageId, guildId) {
  if (!channelId || !messageId) return '';
  var guild = guildId || (typeof DISCORD_GUILD_ID !== 'undefined' ? DISCORD_GUILD_ID : '');
  if (!guild) return '';
  return `https://discord.com/channels/${guild}/${channelId}/${messageId}`;
}

// ----- DATE & TIME HELPERS -----

/**
 * Parse a Date from text like "9/28", "09-28-2025", or "Sep 28".
 * @param {string} text - Text containing a date
 * @param {number} refYear - Reference year for dates without year
 * @returns {Date|null} Parsed date or null if cannot parse
 */
function parseDateFromText(text, refYear) {
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

/**
 * Project timezone (or override TZ from script properties).
 * @returns {string} Timezone string (default: America/New_York)
 */
function getTimezone() {
  const sp = PropertiesService.getScriptProperties();
  return sp.getProperty('TZ') || Session.getScriptTimeZone() || 'America/New_York';
}

/**
 * Convert ISO date to Discord epoch timestamp at 9:00 PM.
 * @param {string} dateISO - Date in ISO format (YYYY-MM-DD)
 * @param {string} tz - Timezone (optional, default from getTimezone)
 * @returns {number|null} Unix epoch timestamp or null
 */
function discordEpochAt9pmFromISO(dateISO, tz) {
  if (!dateISO) return null;
  tz = tz || (typeof getTimezone === 'function' ? getTimezone() : 'America/New_York');
  // Apps Script `Date` uses project timezone; set that to your league TZ in Project Settings for perfect alignment.
  var p = String(dateISO).split('-');
  var y = +p[0], m = +p[1] - 1, d = +p[2];
  var dt = new Date(y, m, d, 21, 0, 0, 0); // 9:00 PM local
  return Math.floor(dt.getTime() / 1000);
}

// ----- FORMATTING HELPERS -----

/**
 * Format weekly notice message for Discord with season/map/action info.
 * @param {Object} week - Week object {seasonWeek, mapRef, tz}
 * @param {string} actionWord - Action word (Posted/Edited/etc)
 * @returns {string} Formatted notice message with emoji
 */
function formatWeeklyNotice(week, actionWord) {
  var tz = (week && week.tz) || (typeof getTimezone === 'function' ? getTimezone() : 'America/New_York');
  var season = (week && week.seasonWeek) || '';
  var mapRef = (week && week.mapRef) || '';
  var seasonInfo = (typeof getSeasonInfo === 'function' ? getSeasonInfo() : '');
  var ts = Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a z');

  // :white_check_mark: <KTP_SEASON_INFO> <season> <mapRef> Weekly Boards <Posted/Edited>. <timestamp> <:ktp:...>
  return ':white_check_mark: ' +
    [seasonInfo, season, mapRef].filter(Boolean).join(' ') +
    ' Weekly Boards ' + (actionWord || 'Posted/Edited') + '. ' +
    ts + ' ' + ktpEmoji();
}

// ----- SNOWFLAKE (Discord ID) HELPERS -----

/**
 * Compare two Discord snowflake IDs (as strings). Returns -1, 0, or 1.
 * @param {string} a - First snowflake ID
 * @param {string} b - Second snowflake ID
 * @returns {number} -1 if a<b, 0 if a==b, 1 if a>b
 */
function compareSnowflakes(a, b) {
  if (BigInt(a) < BigInt(b)) return -1;
  if (BigInt(a) > BigInt(b)) return 1;
  return 0;
}

/**
 * Return the larger of two Discord snowflake IDs (as strings).
 * @param {string} a - First snowflake ID
 * @param {string} b - Second snowflake ID
 * @returns {string} Larger snowflake ID
 */
function maxSnowflake(a, b) {
  if (!a) return b;
  if (!b) return a;
  return BigInt(a) > BigInt(b) ? a : b;
}

// ---------- Table formatting helpers (single source of truth) ----------

/**
 * Repeat a string n times (used for separators).
 * @param {string} ch - Character or string to repeat
 * @param {number} n - Number of times to repeat
 * @returns {string} Repeated string
 */
function repeat(ch, n) {
  ch = String(ch || '');
  n = Math.max(0, n | 0);
  return (typeof ch.repeat === 'function') ? ch.repeat(n) : new Array(n + 1).join(ch);
}

/**
 * Pad string on the right to width n.
 * @param {string} s - String to pad
 * @param {number} n - Target width
 * @returns {string} Right-padded string
 */
function padRight(s, n) { s = String(s || ''); var k = Math.max(0, n - s.length); return s + (k ? Array(k + 1).join(' ') : ''); }

/**
 * Pad string on the left to width n.
 * @param {string} s - String to pad
 * @param {number} n - Target width
 * @returns {string} Left-padded string
 */
function padLeft(s, n) { s = String(s || ''); var k = Math.max(0, n - s.length); return (k ? Array(k + 1).join(' ') : '') + s; }

/**
 * Truncate string to width n with ellipsis.
 * @param {string} s - String to truncate
 * @param {number} n - Max width
 * @returns {string} Truncated string
 */
function truncate(s, n) { s = String(s || ''); return (s.length > n) ? (s.slice(0, n - 1) + '…') : s; }

/**
 * Pad string centered to width n.
 * @param {string} s - String to pad
 * @param {number} n - Target width
 * @returns {string} Center-padded string
 */
function padCenter(s, n) {s = String(s || ''); var k = Math.max(0, n - s.length), L = Math.floor(k / 2), R = k - L;  return (L ? Array(L + 1).join(' ') : '') + s + (R ? Array(R + 1).join(' ') : '');}

/**
 * Pad scheduled time with ET-aligned formatting (time right-aligned, date left-aligned).
 * Normalizes all timestamps to same width so "ET" aligns vertically, then centers the result.
 * @param {string} s - Scheduled time string (e.g., "8:00 PM ET 9/21" or "TBD")
 * @param {number} n - Target width (typically 22 for scheduled column)
 * @returns {string} Padded string with ET-aligned formatting
 */
function padScheduled(s, n) {
  s = String(s || '');
  if (s.indexOf(' ET ') === -1) {
    // No timezone, use center padding (e.g., "TBD")
    return padCenter(s, n);
  }

  // Split on " ET " and normalize to fixed widths
  var parts = s.split(' ET ');
  if (parts.length !== 2) return padCenter(s, n);

  var timePart = parts[0];  // e.g., "8:00 PM" or "10:00 PM"
  var datePart = parts[1];  // e.g., "9/21" or "12/31"

  // Normalize to fixed widths so "ET" is always at same position
  var timeWidth = 8;  // "10:00 PM" = 8 chars max
  var dateWidth = 5;  // "12/31" = 5 chars max
  // Normalized string = 8 + 4 (" ET ") + 5 = 17 chars

  var paddedTime = padLeft(timePart, timeWidth);   // Right-align time
  var paddedDate = padRight(datePart, dateWidth);  // Left-align date

  var normalized = paddedTime + ' ET ' + paddedDate;  // Always 17 chars

  // Center the normalized string in the column
  return padCenter(normalized, n);
}

/**
 * Get column widths used by all tables.
 * COL1 = "Home vs Away" column width, COL2 = "Scheduled", COL3 = "Shoutcaster"
 * @returns {Object} {COL1: 43, COL2: 22, COL3: 12}
 */
function getTableWidths() {
  return { COL1: 43, COL2: 22, COL3: 12 };
}

/**
 * Format "Home vs Away" cell with centered alignment and truncation.
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {number} col1 - Total column width
 * @returns {string} Formatted cell with "vs" separator
 */
function formatVsCell(home, away, col1) {
  var token = ' vs ', L = Math.floor((col1 - token.length) / 2), R = col1 - token.length - L;
  home = truncate(String(home || ''), L); away = truncate(String(away || ''), R);
  return padLeft(home, L) + token + padRight(away, R);
}

/**
 * Format table header with "Home vs Away" labels.
 * @param {number} col1 - Total column width
 * @returns {string} Formatted header cell
 */
function formatVsHeader(col1) { return formatVsCell('Home', 'Away', col1); }

/**
 * Format a single "Home vs Away" cell to match header alignment.
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {number} col1 - Total column width
 * @returns {string} Formatted row cell
 */
function formatVsRow(home, away, col1) {
  var token = ' vs ', L = Math.floor((col1 - token.length) / 2), R = col1 - token.length - L;
  home = truncate(String(home || ''), L); away = truncate(String(away || ''), R);
  return padLeft(home, L) + token + padRight(away, R);
}

/**
 * Check if a team name is a BYE (case-insensitive).
 * @param {string} s - Team name to check
 * @returns {boolean} True if the string is "BYE"
 */
function isBye(s) { return /^\s*BYE\s*$/i.test(String(s || '')); }

/**
 * Extract message ID from relay response (handles various response structures).
 * @param {*} resp - Relay response (string, object, or nested structure)
 * @returns {string|null} Message ID or null if not found
 */
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

/**
 * Wrap content in markdown code fence if not already wrapped.
 * @param {string} s - Content to wrap
 * @returns {string} Content wrapped in ```text fence or original if already wrapped
 */
function ensureFence(s) {
  s = String(s || '').trim();
  if (!s) return '';
  return s.startsWith('```') ? s : ('```text\n' + s + '\n```');
}

/**
 * Remove markdown code fence wrapper from content.
 * @param {string} s - Content to unwrap
 * @returns {string} Content without fence or original if no fence found
 */
function stripFence(s) {
  s = String(s || '');
  var m = s.match(/^```[\s\S]*?\n([\s\S]*?)\n```$/);
  return m ? m[1] : s;
}

/**
 * Split text into chunks by character limit, preserving line boundaries where possible.
 * @param {string} raw - Text to split
 * @param {number} maxLen - Maximum length per chunk (default 1900)
 * @returns {Array<string>} Array of text chunks
 */
function chunkByLimit(raw, maxLen) {
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

/**
 * Hash a string using SHA-256.
 * @param {string} s - String to hash
 * @returns {string} Hexadecimal hash string
 */
function hashString(s) { return sha256Hex(String(s || '')); }

/**
 * Compute SHA-256 hash and return as hexadecimal string (2k-safe hash for strings/objects).
 * @param {string} s - String to hash
 * @returns {string} SHA-256 hash in hex format
 */
function sha256Hex(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    out += (b + 0x100).toString(16).slice(1);
  }
  return out;
}
/**
 * Hash header object after removing volatile fields (timestamp/footer) to detect content changes.
 * @param {Object} headerObj - Header object with embeds
 * @returns {string} SHA-256 hash of stable content
 */
function safeHeaderHash(headerObj) {
  try {
    var h = JSON.parse(JSON.stringify(headerObj || {}));
    if (h && h.embeds && h.embeds[0]) {
      if (h.embeds[0].timestamp) delete h.embeds[0].timestamp;
      if (h.embeds[0].footer) delete h.embeds[0].footer;
    }
    return sha256Hex(JSON.stringify(h));
  } catch (_) { return ''; }
}

/**
 * Hash embeds array after removing footer fields to detect content changes (like safeHeaderHash).
 * @param {Array} embeds - Array of Discord embed objects
 * @returns {string} SHA-256 hash of stable embed content
 */
function safeEmbedsHash(embeds) {
  try {
    var x = JSON.parse(JSON.stringify(embeds || []));
    if (x && x.length) {
      for (var i = 0; i < x.length; i++) {
        if (x[i] && x[i].footer) delete x[i].footer;
      }
    }
    return sha256Hex(x);
  } catch (e) {
    return sha256Hex(String(embeds || ''));
  }
}

// ----- CACHING HELPERS -----

/**
 * Get script cache instance.
 * @returns {Cache} Script cache service
 */
function cache() { return CacheService.getScriptCache(); }

/**
 * Get JSON object from cache.
 * @param {string} key - Cache key
 * @returns {*|null} Parsed JSON object or null if not found/invalid
 */
function cacheGetJson(key) {
  const s = cache().get(key);
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

/**
 * Store JSON object in cache with TTL.
 * @param {string} key - Cache key
 * @param {*} obj - Object to store (will be JSON stringified)
 * @param {number} ttlSec - Time to live in seconds (default 300, max 21600)
 */
function cachePutJson(key, obj, ttlSec) {
  cache().put(key, JSON.stringify(obj || {}), Math.min(21600, Math.max(30, ttlSec || 300)));
}

let TEAM_ALIAS_CACHE = null;

/**
 * Load team aliases from _Aliases sheet (cached).
 * Returns map of aliasUpper -> canonicalUpper for team name normalization.
 * @returns {Object} Alias map object
 */
function loadTeamAliases() {
  if (TEAM_ALIAS_CACHE) return TEAM_ALIAS_CACHE;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('_Aliases');
  if (!sh) return (TEAM_ALIAS_CACHE = {});

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(); // alias | canonical
  const aliasMap = {}; // aliasUpper -> canonicalUpper

  for (const [alias, canon] of data) {
    const a = String(alias || '').trim().toUpperCase();
    const c = String(canon || '').trim().toUpperCase();
    if (a && c) aliasMap[a] = c;
  }

  TEAM_ALIAS_CACHE = aliasMap;
  return aliasMap;
}

var TEAM_INDEX_CACHE = null;

/**
 * Build and cache team index for fuzzy team matching.
 * Uses TEAM_CANON_RANGE (A3:A22) from each division sheet + _Aliases sheet.
 * @returns {Object} Team index {teams: [{name, division, aliases}, ...]}
 */
function getTeamIndexCached() {
  if (TEAM_INDEX_CACHE) return TEAM_INDEX_CACHE;

  const teams = [];
  const aliasMap = loadTeamAliases(); // aliasUpper -> canonicalUpper

  // Invert alias map: canonicalUpper -> [aliasUpper1, aliasUpper2, ...]
  const canonToAliases = {};
  for (const [alias, canon] of Object.entries(aliasMap)) {
    if (!canonToAliases[canon]) canonToAliases[canon] = [];
    canonToAliases[canon].push(alias);
  }

  // Read team names from each division
  const divs = (typeof getDivisionSheets === 'function') ? getDivisionSheets() : ['Bronze', 'Silver', 'Gold'];
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

  TEAM_INDEX_CACHE = { teams };
  return TEAM_INDEX_CACHE;
}


/**
 * Convert large tables body (multiple code-fenced sections) into Discord embeds.
 * Splits on blank lines between sections, packs sections into chunks <= ~3900 chars.
 * @param {string} body - Tables body content with code fences
 * @returns {Array} Array of Discord embed objects with descriptions
 */
function tablesBodyToEmbeds(body) {
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

// ----- SHEET HELPERS -----

/**
 * Get list of division sheet names (from constant DIVISIONS or stored property).
 * @returns {Array<string>} Array of division sheet names (e.g., ['Bronze', 'Silver', 'Gold'])
 */
function getDivisionSheets() {
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

/**
 * Get a sheet by name from the configured spreadsheet.
 * @param {string} sheetName - Sheet name to retrieve
 * @returns {Sheet} Google Sheets sheet object
 * @throws {Error} If SPREADSHEET_ID not configured
 */
function getSheetByName(sheetName) {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID not configured in Script Properties');
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(sheetName);
}

/**
 * Get season info string from SEASON_INFO sheet cell A1.
 * @returns {string} Season info string or empty string if not found
 */
function getSeasonInfo() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SEASON_INFO);
  if (!sh) return '';
  var v = sh.getRange('A1').getDisplayValue();
  return String(v || '').trim();
}

/**
 * Convert column letter(s) to 1-based column index (A=1, B=2, AA=27, etc).
 * @param {string} letter - Column letter(s)
 * @returns {number} 1-based column index
 */
function colIdx(letter) {
  letter = String(letter || '').toUpperCase();
  var n = 0;
  for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n || 1;
}

/**
 * Get grid column indices from script properties (or defaults).
 * Returns indices for Win/Loss, Team, Score columns for both teams.
 * @returns {Object} {WL1, T1, S1, WL2, T2, S2} column indices
 */
function getGridCols() {
  var sp = PropertiesService.getScriptProperties();
  function getOrDef(key, def) { return (sp.getProperty(key) || def); }
  var WL1 = colIdx(getOrDef('GRID_COL_WL1', 'B'));
  var T1 = colIdx(getOrDef('GRID_COL_TEAM1', 'C'));
  var S1 = colIdx(getOrDef('GRID_COL_SCORE1', 'D'));
  var WL2 = colIdx(getOrDef('GRID_COL_WL2', 'F'));
  var T2 = colIdx(getOrDef('GRID_COL_TEAM2', 'G'));
  var S2 = colIdx(getOrDef('GRID_COL_SCORE2', 'H'));
  return { WL1: WL1, T1: T1, S1: S1, WL2: WL2, T2: T2, S2: S2 };
}

/**
 * Read team names from Teams sheet and generate comprehensive alias suggestions.
 * Teams sheet structure:
 * - Row 2: Gold teams
 * - Row 16: Silver teams
 * - Row 30: Bronze teams
 * @returns {Array<Object>} Array of {fullName, division, suggestedAliases[]}
 */
function analyzeTeamsForAliases() {
  var sh = getSheetByName('Teams');
  if (!sh) {
    if (typeof logToSheet === 'function') logToSheet('⚠️ Teams sheet not found');
    return [];
  }

  var results = [];
  var divisions = [
    { name: 'Gold', row: 2 },
    { name: 'Silver', row: 16 },
    { name: 'Bronze', row: 30 }
  ];

  for (var d = 0; d < divisions.length; d++) {
    var div = divisions[d];
    // Read entire row (assuming teams are in columns A onwards, reading 20 columns max)
    var rowData = sh.getRange(div.row, 1, 1, 20).getValues()[0];

    for (var i = 0; i < rowData.length; i++) {
      var teamName = String(rowData[i] || '').trim();
      if (!teamName) continue;

      // Skip template teams (BRONZE A, SILVER B, etc.)
      if (/^(bronze|silver|gold)\s+[a-z]$/i.test(teamName)) continue;

      // Generate suggested aliases
      var aliases = generateAliasesForTeam(teamName);

      results.push({
        fullName: teamName,
        division: div.name,
        suggestedAliases: aliases
      });
    }
  }

  return results;
}

/**
 * Generate suggested aliases for a team name.
 * Examples:
 *   "SOUL SKATERS" → ["soul", "skaters", "soul skaters"]
 *   "THE CLINIC" → ["clinic", "the clinic"]
 *   "GVMH" → ["gvmh"] (already short)
 * @param {string} teamName - Full team name
 * @returns {Array<string>} Array of suggested aliases
 */
function generateAliasesForTeam(teamName) {
  var aliases = [];
  var normalized = String(teamName || '').trim();

  if (!normalized) return aliases;

  // Always add the full lowercase version
  var lower = normalized.toLowerCase();
  aliases.push(lower);

  // Split into words
  var words = normalized.split(/\s+/);

  // If multi-word, add individual words as aliases (unless they're common words)
  var commonWords = ['the', 'a', 'an', 'of', 'and', 'or', 'vs'];
  if (words.length > 1) {
    for (var i = 0; i < words.length; i++) {
      var word = words[i].toLowerCase();
      if (word.length >= 3 && commonWords.indexOf(word) < 0) {
        if (aliases.indexOf(word) < 0) aliases.push(word);
      }
    }
  }

  // Add acronym if multi-word (first letters)
  if (words.length >= 2) {
    var acronym = words.map(function(w) { return w.charAt(0); }).join('').toLowerCase();
    if (acronym.length >= 2 && aliases.indexOf(acronym) < 0) {
      aliases.push(acronym);
    }
  }

  return aliases;
}

/**
 * Log the comprehensive alias analysis to WM_Log sheet.
 * Creates a report showing which aliases are missing from _Aliases sheet.
 */
function logMissingAliases() {
  var teams = analyzeTeamsForAliases();
  var existingAliases = loadTeamAliases(); // from _Aliases sheet

  var report = ['📋 Alias Analysis Report', ''];
  var missingCount = 0;

  for (var i = 0; i < teams.length; i++) {
    var team = teams[i];
    var missing = [];

    for (var j = 0; j < team.suggestedAliases.length; j++) {
      var alias = team.suggestedAliases[j].toUpperCase();
      if (!existingAliases[alias]) {
        missing.push(team.suggestedAliases[j]);
      }
    }

    if (missing.length > 0) {
      report.push(`${team.division} • ${team.fullName}`);
      report.push(`  Missing: ${missing.join(', ')}`);
      missingCount += missing.length;
    }
  }

  report.push('');
  report.push(`Total missing aliases: ${missingCount}`);

  if (typeof logToSheet === 'function') {
    for (var k = 0; k < report.length; k++) {
      logToSheet(report[k]);
    }
  }

  return { teams: teams, missingCount: missingCount };
}

// ----- EXECUTION TIME MONITORING -----

/**
 * Monitor execution time and determine if we should stop processing.
 * @param {number} startTime - Start time from Date.now()
 * @param {number} maxTime - Maximum execution time in milliseconds (default 300000 = 5 minutes)
 * @returns {Object} { elapsed, remaining, percentUsed, shouldStop }
 */
function getRemainingTime(startTime, maxTime) {
  maxTime = maxTime || 300000; // 5 minutes default (300 seconds)
  var elapsed = Date.now() - startTime;
  var remaining = maxTime - elapsed;
  return {
    elapsed: elapsed,
    remaining: remaining,
    percentUsed: Math.round((elapsed / maxTime) * 100),
    shouldStop: remaining < 30000 // Stop if less than 30 seconds left
  };
}

/**
 * Check if cell contains only numeric digits.
 * @param {string} s - Cell value to check
 * @returns {boolean} True if cell is numeric
 */
function isNumCell(s) { return /^\s*\d+\s*$/.test(String(s || '')); }

/**
 * Check if cell contains Win/Loss/Tie indicator (W, L, T, FF, F, FORFEIT).
 * @param {string} s - Cell value to check
 * @returns {boolean} True if cell is a WLT indicator
 */
function isWLT(s) {
  var t = String(s || '').trim().toUpperCase();
  return /^(W|L|T|FF|F|FORFEIT)$/.test(t);
}

/**
 * Parse date string using ET timezone (delegates to parseSheetDateET if available).
 * @param {string} s - Date string to parse
 * @returns {Date|null} Parsed date or null if invalid
 */
function parseEtDate(s) {
  if (typeof parseSheetDateET === 'function') return parseSheetDateET(s);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
/**
 * Calculate top row of block i using grid stride.
 * @param {number} i - Block index
 * @returns {number} Row number for block header
 */
function blockHeaderTop(i) { return G.firstLabelRow + (i | 0) * G.stride; }