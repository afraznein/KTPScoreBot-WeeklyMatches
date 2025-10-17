// =======================
// config.gs (canonical constants)
// =======================

// ---- DISCORD RELAY ----
const RELAY_BASE    = 'RELAY_BASE_SECRET';
//CODE_TO_GENERATE_SECRET = 'node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"';
const RELAY_AUTH    = 'RELAY_AUTH_SECRET';

// Channels
const SCHED_INPUT_CHANNEL_ID = '1063529682919755927'; // captains post schedules
const WEEKLY_POST_CHANNEL_ID = '1419183947207938048'; // weekly board lives here
const RESULTS_LOG_CHANNEL_ID = '1419183998147493939'; // logs/alerts/messages

// Emoji / Roles
const SHOUTCAST_EMOJI_NAME = 'Shoutcast';               // e.g., 'Shoutcast'
const SHOUTCAST_EMOJI_ID   = '1156372592391893062';     // '' if none
const SHOUTCASTER_ROLE_ID  = '1002384063228825602';                        // optional, '' to disable gate

// ---- GOOGLE SHEETS ----
const SPREADSHEET_ID  = '1NNOorkepxup_6RDbraIvwvijZNG0bWKlPN6B5EP3Xp4'; // <— canonical
const DIVISIONS       = ['Bronze', 'Silver', 'Gold'];
const TEAM_CANON_RANGE = 'A3:A22';
// ---- BACK-COMPAT ALIAS (so older code using SHEET_ID doesn’t break) ----
const SHEET_ID = SPREADSHEET_ID;

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
const WM_WEBAPP_SHARED_SECRET = 'WM_WEBAPP_SHARED_SECRET';

// ---- EMBED STYLE (for header) ----
const EMBED_COLOR      = 0x48C9B0;              // teal-ish
const EMBED_ICON_URL   = '';                    // optional small icon
const EMBED_BANNER_URL = '';                    // optional banner image