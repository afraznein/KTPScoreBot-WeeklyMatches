// =======================
// 00_config.gs - Configuration & Constants
// =======================
// Purpose: Version info, Discord/Sheet IDs, grid geometry, relay paths, constants
// Dependencies: None (base module)
// Used by: All modules
//
// Contents:
// - VERSION, VERSION_DATE constants
// - Discord channel IDs and emoji config
// - Google Sheets ID, division names, ranges
// - Grid geometry (GRID object)
// - Column indices (COL_*)
// - Storage keys (LAST_SCHED_KEY, etc)
// - Performance settings (POLL_MAX_MESSAGES_PER_RUN, etc)
// - Embed styling constants
//
// =======================

/**
 * KTPScoreBot-WeeklyMatches Configuration
 *
 * Version: 3.5.0
 * Last Updated: 2025-11-05
 *
 * CHANGELOG:
 * v3.5.0 (2025-11-05) - FEATURE: Discord message links in schedule confirmations
 *                     - Added DISCORD_GUILD_ID configuration constant
 *                     - Added buildDiscordMessageLink() helper function in 05_util.gs
 *                     - Schedule confirmations now include clickable "Jump to message" links
 *                     - BUGFIX: Fixed message counting (finally block ensures all messages counted)
 *                     - BUGFIX: Fixed updateResult scope issue causing "not defined" errors
 *                     - BUGFIX: Added stripMapHint() to prevent map names in team names (e.g., "dod_railyard_b6 NoGo")
 *                     - Added logToSheet() function for verbose logging without Discord spam
 *                     - Moved verbose debug logs to WM_Log sheet only (🔍, 👀, 🧪 messages)
 *                     - Removed duplicate skip logging (generic count message)
 *                     - Updated successCount/tentativeCount logic to reflect actual scheduled matches
 * v3.4.0 (2025-11-04) - FEATURE: Historical message parsing with intelligent week matching
 *                     - Fixed buildWeekListFromSheets() to include matches array for matchup searching
 *                     - Enhanced date parsing to use Discord message timestamp as reference context
 *                     - Updated findWeekByDateAndPair() to find first upcoming week with matchup
 *                     - Updated findWeekByMessageTime() to find first upcoming week (captains schedule ahead)
 *                     - Added schedule date to format: "3:00 PM ET 9/15" (was just "3:00 PM ET")
 *                     - Fixed timezone handling in parseWhenFlexible() (removed UTC conversions)
 *                     - Fixed double Discord reporting (removed duplicate postChannelMessage call)
 *                     - Added DEBUG_PARSER flag to toggle verbose logging (default: false)
 *                     - Fixed isTentative scope error in processOneDiscordMessage()
 *                     - Fixed BigInt syntax for Google Apps Script (22n → BigInt(22))
 *                     - Added skipScheduled option to prevent re-processing scheduled matches
 *                     - Column E (COL_SCHEDULED) now written with full date/time schedule
 *                     - Historical parsing UI added to control panel (ktp_control_panel.html)
 * v3.3.0 (2025-11-04) - FEATURE: Full function refactor, JSDoc and summary headers across project file 
 * v3.2.0 (2025-11-04) - FEATURE: Added back-processing capability for matches without map keys
 *                     - Added server_backprocessMatch() endpoint in 50_webapp.gs
 *                     - Added findMatchAcrossAllWeeks() helper to search all weeks by teams
 *                     - Supports scheduling matches based only on division + team names
 *                     - Automatically finds correct week/map from sheet data
 *                     - Useful for back-filling historical match schedules
 * v3.1.0 (2025-11-04) - PERFORMANCE: Added execution time monitoring and batch limits
 *                     - Added getRemainingTime() helper in 05_util.gs
 *                     - Updated pollAndProcessFromId() with maxProcess limit (default 5)
 *                     - Added time checks to prevent execution timeouts
 *                     - Messages now process in batches with graceful early exit
 *                     - Enhanced logging with execution stats (time used, messages processed)
 * v3.0.4 (2025-11-03) - CRITICAL: Fixed completely broken sendLog() function
 *                     - Fixed logMatchToWMLog() to actually write to WM_Log sheet
 *                     - Fixed logToWmSheet() error handling
 *                     - All logging to Google Sheets now working correctly
 *                     - Diagnostic logs will now appear in WM_LOG sheet
 * v3.0.3 (2025-11-03) - BUGFIX: Fixed formatWeeklyNotice_ function name (missing underscore)
 *                     - Added diagnostic logging to findMatchRowIndex for troubleshooting
 *                     - Logs show exact vs normalized team names for comparison
 *                     - Logs first 3 rows of each block for debugging
 * v3.0.2 (2025-11-03) - BUGFIX: Parser now calls updateTablesMessageFromPairs() to find rows
 *                     - Fixed "unmapped" matches - now properly locates match rows in sheets
 *                     - Added unmatched reason reporting (block_top_not_found, row_not_found)
 *                     - Store updates and Discord board refreshes now working
 * v3.0.1 (2025-11-02) - BUGFIX: Added missing getSheetByName function to 20_sheets.gs
 *                     - BUGFIX: Fixed relayPost call (replaced with postChannelMessage)
 *                     - Fixed "Cannot read properties of null" error on sheet access
 *                     - Fixed "relayPost is not defined" error in parser
 * v3.0.0 (2025-11-02) - Major refactoring: Split 10main.gs into 8 focused modules
 *                     - Fixed 17 missing function definitions (underscore naming)
 *                     - Removed 7 dead code functions
 *                     - Added version tracking with Discord/web app display
 * v2.1.0 (2024-12-XX) - Added team alias support via _Aliases sheet
 *                     - Improved schedule parser with fuzzy team matching
 *                     - Enhanced date/time parsing flexibility
 * v2.0.0 (2024-10-XX) - Initial weekly matches automation system
 *                     - Discord relay integration
 *                     - Automatic weekly board posting
 */

const VERSION = '3.5.0';
const VERSION_DATE = '2025-11-05';

// ---- DISCORD RELAY ----
const RELAY_BASE = 'RELAY_BASE';
const RELAY_AUTH = 'RELAY_AUTH';

// Server
const DISCORD_GUILD_ID = '996884268804493363';  // KTP Discord server ID

// Channels
const SCHED_INPUT_CHANNEL_ID = '1063529682919755927';  // captains post schedules
const WEEKLY_POST_CHANNEL_ID = '1419183947207938048';  // weekly board lives here
const RESULTS_LOG_CHANNEL_ID = '1419183998147493939';  // logs/alerts/messages

// Emoji / Roles
const SHOUTCAST_EMOJI_NAME = 'Shoutcast';               // e.g., 'Shoutcast'
const SHOUTCAST_EMOJI_ID = '1156372592391893062';     // '' if none
const SHOUTCASTER_ROLE_ID = '1002384063228825602';     // optional, '' to disable gate

// ---- GOOGLE SHEETS ----
const SPREADSHEET_ID = '1NNOorkepxup_6RDbraIvwvijZNG0bWKlPN6B5EP3Xp4';  // spreadsheet ID (canonical)
const LOG_SHEET = 'WM_LOG';
const SEASON_INFO = 'KTP INFO';
const DIVISIONS = ['Bronze', 'Silver', 'Gold'];
const TEAM_CANON_RANGE = 'A3:A22';

var EMOJI_OK = '✅';
var EMOJI_EDIT = '✏️';
var EMOJI_RP = '♻️';  // reparse
var EMOJI_WARN = '⚠️';

// Weekly grid geometry
const GRID = {
  startRow: 28,          // first block top row
  blockHeight: 11,       // rows per block (map + date + 10 matches)
  matchesPerBlock: 10,   // number of match rows per block
  cols: 8
};

// Column indices (1-based)
const COL_MAP = 1;
const COL_T1_RESULT = 2;  // Home W/L
const COL_T1_NAME = 3;  // Home team name
const COL_T1_SCORE = 4;
const COL_SCHEDULED = 5;  // Scheduled time (E)
const COL_T2_RESULT = 6;  // Away W/L
const COL_T2_NAME = 7;  // Away team name
const COL_T2_SCORE = 8;

// ---- KEY STORAGE ----
const LAST_SCHED_KEY = 'LAST_SCHED_MSG_ID';
const TWITCH_MAP_KEY = 'TWITCH_USER_MAP_JSON';
const GLOBAL_SCHED_KEY = 'WEEKLY_GLOBAL_SCHEDULES';

// ---- PERFORMANCE / BEHAVIOR ----
const POLL_MAX_MESSAGES_PER_RUN = 5;
const POLL_SOFT_DEADLINE_MS = 4.5 * 60 * 1000; // ~4.5 minutes
const LOOKUP_CACHE_TTL_SEC = 6 * 60 * 60;     // 6 hours

// ---- WEB APP CONTROL PANEL ----
const WM_WEBAPP_SHARED_SECRET = 'WM_WEBAPP_SHARED_SECRET';

// ---- EMBED STYLE (for header) ----
const EMBED_COLOR = 0x48C9B0;  // default embed color (teal-ish)
const EMBED_ICON_URL = '';       // optional small icon URL
const EMBED_BANNER_URL = '';       // optional banner image URL

var EMOJI_KTP = '<:KTP:1002382703020212245>';   // <:ktp:EMOJI>
var KTP_EMOJI_ID = '1002382703020212245'; // <:ktp:ID>