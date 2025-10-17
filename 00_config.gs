// =======================
// config.gs (canonical constants)
// =======================

/** Compat shims for older code that calls getScriptProperties() directly */
function getScriptProperties() { return PropertiesService.getScriptProperties(); }
function getUserProperties()   { return PropertiesService.getUserProperties(); }
function getDocumentProperties(){ return PropertiesService.getDocumentProperties(); }


// ---- DISCORD RELAY ----
function CFG_(k, fallback){ 
  try { return PropertiesService.getScriptProperties().getProperty(k) || fallback || ''; }
  catch(e){ return fallback || ''; }
}
const DRY_RUN = String(CFG_('DRY_RUN', 'false')).toLowerCase() === 'true';
const RELAY_BASE = CFG_('RELAY_BASE', 'RELAY_BASE_FALLBACK');
//CODE_TO_GENERATE_SECRET = 'node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"';
const RELAY_AUTH = CFG_('RELAY_AUTH', 'RELAY_AUTH_FALLBACK');

// Channels
const SCHED_INPUT_CHANNEL_ID = CFG_('SCHED_INPUT_CHANNEL_ID', '1063529682919755927'); // captains post schedules
const WEEKLY_POST_CHANNEL_ID = CFG_('WEEKLY_POST_CHANNEL_ID', '1419183947207938048'); // weekly board lives here
const RESULTS_LOG_CHANNEL_ID = CFG_('RESULTS_LOG_CHANNEL_ID', '1419183998147493939'); // logs/alerts/messages

// Emoji / Roles
const SHOUTCAST_EMOJI_NAME = CFG_('SHOUTCAST_EMOJI_NAME', 'Shoutcast');               // e.g., 'Shoutcast'
const SHOUTCAST_EMOJI_ID = CFG_('SHOUTCAST_EMOJI_ID', '1156372592391893062');     // '' if none
const SHOUTCASTER_ROLE_ID = CFG_('SHOUTCASTER_ROLE_ID', '1002384063228825602');                        // optional, '' to disable gate

// ---- GOOGLE SHEETS ----
const SPREADSHEET_ID = CFG_('SPREADSHEET_ID', '1NNOorkepxup_6RDbraIvwvijZNG0bWKlPN6B5EP3Xp4'); // <— canonical
const DIVISIONS       = ['Bronze', 'Silver', 'Gold'];
const TEAM_CANON_RANGE = 'A3:A22';

// Weekly grid geometry
const GRID = {
  startRow: 28,          // first block top row
  blockHeight: 11,       // rows per block (map+date+10 matches)
  matchesPerBlock: 10,   // number of match rows per block
  cols: 8
};

// Column indices (1-based)
const COL_MAP       = 1;
const COL_T1_RESULT = 2; // Home W/L
const COL_T1_NAME   = 3; // Home
const COL_T1_SCORE  = 4;
const COL_T2_RESULT = 6; // Away W/L
const COL_T2_NAME   = 7; // Away
const COL_T2_SCORE  = 8;

// ---- KEY STORAGE ----
const LAST_SCHED_KEY   = 'LAST_SCHED_MSG_ID';
const TWITCH_MAP_KEY   = 'TWITCH_USER_MAP_JSON';
const GLOBAL_SCHED_KEY = 'WEEKLY_GLOBAL_SCHEDULES';

// ---- PERFORMANCE / BEHAVIOR ----
const POLL_MAX_MESSAGES_PER_RUN = 25;
const POLL_SOFT_DEADLINE_MS     = 4.5 * 60 * 1000; // ~4.5 minutes
const LOOKUP_CACHE_TTL_SEC      = 6 * 60 * 60;     // 6 hours
const DEFER_SC_REACTIONS        = true;            // do shoutcaster pass after main

// ---- WEB APP CONTROL PANEL ----
//CODE_TO_GENERATE_SECRET = 'node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"';
const WM_WEBAPP_SHARED_SECRET = CFG_('WM_WEBAPP_SHARED_SECRET', 'WEBAPP_SECRET_FALLBACK');

// ---- EMBED STYLE (for header) ----
const EMBED_COLOR = (function(){ var v = CFG_('EMBED_COLOR', null); if (!v) return 0x48C9B0; try { if (String(v).startsWith('0x')) return parseInt(v); return parseInt(v,10); } catch(_){ return 0x48C9B0; } })();              // teal-ish
const EMBED_ICON_URL = CFG_('EMBED_ICON_URL', '');                    // optional small icon
const EMBED_BANNER_URL = CFG_('EMBED_BANNER_URL', '');                    // optional banner image

/*---------------------------------------------------*/
// Sheet functions need to be at the highest level

let __SS = null;
function ss_(){ return __SS || (__SS = SpreadsheetApp.openById(SPREADSHEET_ID)); }

function getSheetByName_(div){ 
  const ss = ss_(); 
  return ss.getSheetByName(div); 
}

// Throws with a clear message if anything necessary is missing/misconfigured.
function verifyConfig_() {
  var sp = PropertiesService.getScriptProperties();
  var errs = [];

  function req(name) {
    var v = sp.getProperty(name) || '';
    if (!v) errs.push('Missing Script Property: ' + name);
    return v;
  }

  // Required props
  var sheetId = req('SPREADSHEET_ID');
  var weeklyCh = req('WEEKLY_POST_CHANNEL_ID');
  // Relay base URL strongly recommended
  if (!sp.getProperty('RELAY_BASE')) errs.push('Missing Script Property: RELAY_BASE');

  // Division tabs must exist
  var divs = [];
  try { divs = getDivisionSheets_(); if (!divs || !divs.length) errs.push('No divisions from getDivisionSheets_()'); }
  catch (e) { errs.push('getDivisionSheets_ failed: ' + (e && e.message || e)); }

  try {
    for (var i = 0; i < divs.length; i++) {
      var sh = getSheetByName_(divs[i]);
      if (!sh) errs.push('Missing sheet/tab: ' + divs[i]);
    }
  } catch (e2) { errs.push('getSheetByName_ failed: ' + (e2 && e2.message || e2)); }

  if (errs.length) throw new Error('verifyConfig_: ' + errs.join('; '));
  return true;
}