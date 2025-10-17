// =======================
// utils.gs
// General helpers: dates, strings, snowflakes, caching, logging
// =======================

// ----- DATE HELPERS -----

// Extract a Date from text like 9/28, 09-28-2025, or "Sep 28"
function parseDateFromText_(text, refYear) {
  var s = String(text||'');
  var m = s.match(/\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?\b/);
  if (m) {
    var mm = parseInt(m[1],10)-1, dd = parseInt(m[2],10), yy = m[3] ? parseInt(m[3],10) : (refYear || (new Date()).getFullYear());
    if (yy < 100) yy += 2000;
    return new Date(yy, mm, dd, 0,0,0,0);
  }
  var m2 = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i);
  if (m2) {
    var months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
    var yy2 = refYear || (new Date()).getFullYear();
    return new Date(yy2, months[m2[1].slice(0,3).toLowerCase()], parseInt(m2[2],10));
  }
  return null;
}

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

function getTz_() {
  var sp = PropertiesService.getScriptProperties();
  return sp.getProperty('TZ') || Session.getScriptTimeZone() || 'America/New_York';
}

// Format a Date in the project’s timezone (or override)
function toIsoInTz_(date, tz) {
  return Utilities.formatDate(date, tz || getTz_(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// (Optional convenience)
function fmtInTz_(date, fmt, tz) {
  return Utilities.formatDate(date, tz || getTz_(), fmt || "yyyy-MM-dd HH:mm");
}


// --- ISO Week helpers: return "YYYY-Www" ---
function isoWeekKey_(d, tz) {
  tz = tz || getTz_();
  var y = Utilities.formatDate(d, tz, 'yyyy'); // we’ll recalc year below w/ ISO logic
  // ISO week calc: from a copy in UTC to avoid DST weirdness
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday in current week decides the year.
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  // First week of year
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  // ISO week number
  var weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  var isoYear = date.getUTCFullYear();
  return isoYear + '-W' + ('0'+weekNo).slice(-2);
}

// Monday-based start of current week
function startOfWeek_(d) {
  var dt = new Date(d);
  var day = dt.getDay(); // 0 Sun .. 6 Sat
  var mondayDiff = (day + 6) % 7; // days since Monday
  dt.setHours(0,0,0,0);
  dt.setDate(dt.getDate() - mondayDiff);
  return dt;
}

function dayIndex_(text) {
  var m = text.match(/\b(mon|tue|tues|weds|wed|thu|thur|thurs|fri|sat|sun|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!m) return -1;
  var k = m[1].slice(0,3);
  var map = { mon:0,tue:1,wed:2,thu:3,fri:4,sat:5,sun:6 };
  return map[k];
}

// ----- PROPERTIES HELPERS -----
function props_(){ return PropertiesService.getScriptProperties(); }
function getProps_(keys){
  const all = props_().getProperties();
  const out = {};
  (keys || []).forEach(function(k){ out[k] = all[k] || ''; });
  return out;
}
function setProps_(obj){ if (obj && typeof obj === 'object') props_().setProperties(obj, true); }

function delProps_(keys){ (keys||[]).forEach(function(k){ props_().deleteProperty(k); }); }

// ----- CRYPTO/IDEMPOTENCE HELPERS -----
function sha256Hex_(s){
  s = String(s || '');
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  var h = '';
  for (var i=0;i<raw.length;i++){ h += ('0'+(raw[i]&0xff).toString(16)).slice(-2); }
  return h;
}

// ----- STRING HELPERS -----

function _norm_(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }

// Extract a human-readable when string (assume PM ET if time present w/o am/pm)
function whenStringFromText_(text) {
  var s = String(text || '');

  // Prefer explicit time with separators and optional am/pm
  var m = s.match(/\b(\d{1,2})(?::|\.|h)?(\d{2})?\s*(am|pm)?\b/i);

  var hh = null, mm = null, ap = null;

  if (m) {
    hh = parseInt(m[1], 10);
    mm = (typeof m[2] === 'string' && m[2].length) ? m[2] : '00';
    ap = (m[3] || '').toLowerCase();
  } else {
    // Fallback: compact 3–4 digit time like 930 or 1230
    var mc = s.match(/\b(\d{3,4})\b/);
    if (mc) {
      var t = mc[1];
      if (t.length === 3) {
        hh = parseInt(t.charAt(0), 10);
        mm = t.slice(1);
      } else {
        hh = parseInt(t.slice(0, 2), 10);
        mm = t.slice(2);
      }
      ap = ''; // unspecified
    }
  }

  if (hh == null) return '';

  // Normalize minutes to two digits
  mm = ('0' + String(parseInt(mm, 10) || 0)).slice(-2);

  // Default to PM if AM/PM not specified
  if (!ap) ap = 'pm';

  // Normalize AM/PM casing
  ap = ap.toUpperCase(); // 'AM' or 'PM'

  // Convert to 12h clock display (do not change day; just presentational)
  var displayH = hh;
  if (ap === 'AM') {
    displayH = (hh % 12) === 0 ? 12 : (hh % 12);
  } else { // PM
    displayH = (hh % 12) === 0 ? 12 : (hh % 12);
  }

  return displayH + ':' + mm + ' ' + ap + ' ET';
}


// Normalize text: lowercase, remove non-alphanum to spaces, collapse spaces
function normalizeText_(s) {
  var t = String(s || '');
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  t = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}


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

function getOrCreateLogSheet_() {
  var ss = ss_();
  var name = PropertiesService.getScriptProperties().getProperty('WM_LOG_SHEET_NAME') || 'WM_Log';
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    // header
    sh.getRange(1,1,1,4).setValues([['ts','level','event','data']]);
  }
  return sh;
}

function logLocal_(level, event, data) {
  try {
    var sh = getOrCreateLogSheet_();
    var json = (typeof data === 'string') ? data : JSON.stringify(data || {});
    sh.appendRow([new Date(), String(level||'INFO'), String(event||''), json]);
    return true;
  } catch (e) {
    Logger.log('logLocal_ failed: ' + (e && e.message || e));
    return false;
  }
}

// ----- DIVISION HELPERS -----
// Always returns an Array of division tab names
function getDivisionSheets_() {
  if (typeof DIVISIONS !== 'undefined' && DIVISIONS && DIVISIONS.length) {
    try { return [].slice.call(DIVISIONS); } catch (e) {}
  }
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('DIV_SHEETS_JSON');
    if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr; }
  } catch (e) {}
  return ['Bronze','Silver','Gold']; // fallback
}

// Returns {} if unset / invalid, never undefined
function getDivisionTeamRanges_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('TEAM_RANGES_JSON');
    if (raw) {
      var obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    }
  } catch (e) {}
  return {}; // safe base
}

// Ensure map has all divisions filled (default A3:A23)
function getDivisionTeamRangesFilled_() {
  var map = getDivisionTeamRanges_();        // {} or user map
  var divs = getDivisionSheets_();           // ['Bronze', ...]
  var filled = {};
  for (var i = 0; i < divs.length; i++) {
    var d = divs[i];
    var v = (map && map[d]) || 'A3:A23';     // default per tab
    filled[d] = String(v);
  }
  return filled;
}

// Always returns a string like "A3:A23"
function getTeamRangeForDiv_(divName) {
  var filled = getDivisionTeamRangesFilled_();
  return filled[divName] || 'A3:A23';
}

function getGridLayout_() {
  var sp = PropertiesService.getScriptProperties();
  var mapStart = parseInt(sp.getProperty('GRID_MAP_START_ROW') || '28', 10); // A28
  var stride   = parseInt(sp.getProperty('GRID_BLOCK_STRIDE')  || '11', 10); // +11 rows per week block
  return { mapStartRow: mapStart, blockStride: stride };
}

// Map ref: A28, A39, A50… based on block index (start=28, stride=11; configurable by SP)
function getMapRefAt_(sheet, topRow) {
  if (!sheet || !topRow) return '';
  var blocks = [];
  try { blocks = getAllBlocks_(sheet) || []; } catch(_){}
  var idx = -1;
  for (var i=0;i<blocks.length;i++){
    var t = blocks[i] && (blocks[i].top || blocks[i].startRow);
    var nxt = (blocks[i+1] && (blocks[i+1].top || blocks[i+1].startRow)) || 1e9;
    if (t && topRow >= t && topRow < nxt) { idx = i; break; }
  }
  if (idx < 0) idx = 0;

  var sp = PropertiesService.getScriptProperties();
  var mapStart = parseInt(sp.getProperty('GRID_MAP_START_ROW') || '28', 10);
  var stride   = parseInt(sp.getProperty('GRID_BLOCK_STRIDE')  || '11', 10);
  var row = mapStart + stride*idx;

  var val = '';
  try { val = String(sheet.getRange('A'+row).getDisplayValue() || '').trim(); } catch(_){}
  if (!val) {
    // try a couple rows below just in case
    for (var r=row+1;r<=row+3;r++){
      try { var v2 = String(sheet.getRange('A'+r).getDisplayValue() || '').trim(); if (v2){ val=v2; break; } } catch(_){}
    }
  }
  return val;
}

// Resolve a division name to the canonical sheet name
function canonDivision_(name){
  var s = String(name||'').trim();
  if (!s) return '';
  var norm = s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  var divs = getDivisionSheets_();
  var map = {};
  for (var i=0;i<divs.length;i++){
    var dn = String(divs[i]);
    var key = dn.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    map[key] = dn;
  }
  if (map[norm]) return map[norm];
  if (norm === 'g') return map['gold'] || 'Gold';
  if (norm === 's') return map['silver'] || 'Silver';
  if (norm === 'b') return map['bronze'] || 'Bronze';
  for (var k in map){ if (map.hasOwnProperty(k) && k.indexOf(norm)===0) return map[k]; }
  return s;
}

// --- Build a solid week object and key no matter what you pass in ---
function getWeekKeyFromWeek_(week) {
  try {
    if (week && typeof week.weekKey === 'string' && /\S/.test(week.weekKey)) return String(week.weekKey);

    var tz = getTz_();
    var d = (week && (week.start || week.date)) ? new Date(week.start || week.date) : new Date();
    var key = isoWeekKey_(d, tz);
    return key;
  } catch (e) {
    // absolute fallback: today yyyy-MM-dd
    return Utilities.formatDate(new Date(), getTz_(), 'yyyy-MM-dd');
  }
}

// --- Optional: human label like "Sep 29 – Oct 5" if you need it ---
function getWeekLabel_(week) {
  var tz = getTz_();
  var start = new Date(week && (week.start || week.date) || new Date());
  var end   = new Date(start.getTime() + 6*86400000);
  return Utilities.formatDate(start, tz, 'MMM d') + '–' + Utilities.formatDate(end, tz, 'MMM d');
}

function getWeeklyPostChannelId_(){
  var sp = PropertiesService.getScriptProperties();
  var id = (typeof WEEKLY_POST_CHANNEL_ID !== 'undefined' && WEEKLY_POST_CHANNEL_ID)
         ? WEEKLY_POST_CHANNEL_ID
         : (sp.getProperty('WEEKLY_POST_CHANNEL_ID') || '');
  if (!id) throw new Error('WEEKLY_POST_CHANNEL_ID missing');
  return String(id);
}