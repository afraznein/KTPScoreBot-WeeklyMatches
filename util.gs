// =======================
// utils.gs
// General helpers: dates, strings, snowflakes, caching, logging
// =======================

// ----- DATE HELPERS -----

/** Normalize a date down to midnight (local timezone). */
function startOfDay_(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Normalize a date up to 23:59:59.999 (local timezone). */
function endOfDay_(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
}

/** Format date as YYYY-MM-DD */
function fmtDay_(d){
  if (!d) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Format as ISO8601 with time. */
function iso_(d){
  if (!d) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

/** Build a Date object from parts, defaulting to PM if no am/pm supplied. */
function buildDate_(year, month, day, h, m, ap){
  let hh = h != null ? +h : 12;
  let mm = m != null ? +m : 0;

  if (ap) {
    const ampm = String(ap).toLowerCase();
    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
  } else {
    // no am/pm → assume PM
    if (hh >= 1 && hh <= 11) hh += 12;
    if (hh === 0) hh = 12;
  }

  return new Date(year, month-1, day, hh, mm, 0, 0);
}

// ----- STRING HELPERS -----

/** Trim and collapse whitespace, preserve internal spaces. */
function cleanName_(s){
  return String(s||'').replace(/^\s+|\s+$/g,'').replace(/\s{2,}/g,' ');
}

/** Force uppercase for matching, preserve middle spaces. */
function normalizeTeam_(s){
  return cleanName_(s).toUpperCase();
}

/** Map name for partial matching (drop spaces, punctuation). */
function normalizeTeamForMatch_(s){
  return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

/** Normalize map key to lowercase (dod_*). */
function normalizeMap_(s){
  return String(s||'').trim().toLowerCase();
}

// ----- SNOWFLAKE HELPERS -----

/** Compare two Discord snowflake IDs (string). */
function compareSnowflakes(a,b){
  if (BigInt(a) < BigInt(b)) return -1;
  if (BigInt(a) > BigInt(b)) return 1;
  return 0;
}

/** Return max of two snowflake IDs (string). */
function maxSnowflake(a,b){
  if (!a) return b;
  if (!b) return a;
  return BigInt(a) > BigInt(b) ? a : b;
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

// ----- LOGGING -----

function logLocal_(level, msg, obj){
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const line = `[${level}] ${ts} ${msg} ${obj ? JSON.stringify(obj) : ''}`;
  console.log(line);
}