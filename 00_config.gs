// =======================
// config.gs (canonical constants)
// =======================

// ---- DISCORD RELAY ----
const RELAY_BASE    = 'RELAY_BASE';
const RELAY_AUTH    = 'RELAY_AUTH';

// Channels
const SCHED_INPUT_CHANNEL_ID = '1063529682919755927';  // captains post schedules
const WEEKLY_POST_CHANNEL_ID = '1419183947207938048';  // weekly board lives here
const RESULTS_LOG_CHANNEL_ID = '1419183998147493939';  // logs/alerts/messages

// Emoji / Roles
const SHOUTCAST_EMOJI_NAME = 'Shoutcast';               // e.g., 'Shoutcast'
const SHOUTCAST_EMOJI_ID   = '1156372592391893062';     // '' if none
const SHOUTCASTER_ROLE_ID  = '1002384063228825602';     // optional, '' to disable gate

// ---- GOOGLE SHEETS ----
const SPREADSHEET_ID   = '1NNOorkepxup_6RDbraIvwvijZNG0bWKlPN6B5EP3Xp4';  // spreadsheet ID (canonical)
const LOG_SHEET        = 'WM_LOG';
const SEASON_INFO      = 'KTP INFO'; 
const DIVISIONS        = ['Bronze', 'Silver', 'Gold'];
const TEAM_CANON_RANGE = 'A3:A22';

// Weekly grid geometry
const GRID = {
  startRow: 28,          // first block top row
  blockHeight: 11,       // rows per block (map + date + 10 matches)
  matchesPerBlock: 10,   // number of match rows per block
  cols: 8
};

// Column indices (1-based)
const COL_MAP       = 1;
const COL_T1_RESULT = 2;  // Home W/L
const COL_T1_NAME   = 3;  // Home team name
const COL_T1_SCORE  = 4;
const COL_T2_RESULT = 6;  // Away W/L
const COL_T2_NAME   = 7;  // Away team name
const COL_T2_SCORE  = 8;

// ---- KEY STORAGE ----
const LAST_SCHED_KEY   = 'LAST_SCHED_MSG_ID';
const TWITCH_MAP_KEY   = 'TWITCH_USER_MAP_JSON';
const GLOBAL_SCHED_KEY = 'WEEKLY_GLOBAL_SCHEDULES';

// ---- WEB APP CONTROL PANEL ----
const WM_WEBAPP_SHARED_SECRET = 'WM_WEBAPP_SHARED_SECRET';

// ---- EMBED STYLE (for header) ----
const EMBED_COLOR      = 0x48C9B0;  // default embed color (teal-ish)
const EMBED_ICON_URL   = '';       // optional small icon URL
const EMBED_BANNER_URL = '';       // optional banner image URL

var KTP_EMOJI_ID = '1002382703020212245'; // <:ktp:ID>