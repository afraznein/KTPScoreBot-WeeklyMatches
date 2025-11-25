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

const VERSION = '4.1.2';
const VERSION_DATE = '2025-11-24';

/**
 * KTPScoreBot-WeeklyMatches Configuration
 *
 * Version: 4.1.2
 * Last Updated: 2025-11-24
 *
 * CHANGELOG:
 * v4.1.2 (2025-11-24) - BUGFIX: Week detection now properly handles current week window
 *                      - FIXED: findActiveIndexByDate() now checks if today falls within week window (Mon-Sun)
 *                      - FIXED: Manual weekly posts no longer stuck on old week after matches complete
 *                      - CHANGED: Week is considered "active" if today is within Mon-Sun OR week is in future
 *                      - IMPROVED: Playoff weeks (semifinals, finals) now correctly detected after previous round completes
 *                      - Impact: Weekly table generation now advances to next week correctly
 *                      - Location: 20_sheets.gs (lines 87-131)
 * v4.1.1 (2025-11-21) - BUGFIX: Automatic polling handler and silent batch reporting
 *                      - FIXED: automaticPollingHandler() now checks WM_WEBAPP_SHARED_SECRET first
 *                      - CHANGED: Handler checks multiple secret property names (WM_WEBAPP_SHARED_SECRET, WEBAPP_SECRET, etc.)
 *                      - FIXED: Empty polling batches (0 messages) no longer send Discord notifications
 *                      - CHANGED: pollAndProcessFromId() only sends confirmations/completion when processed > 0
 *                      - Impact: Reduces Discord spam from automatic polling when no new messages exist
 *                      - Location: 10_storage.gs (lines 210-221), 60_parser.gs (lines 1160-1215)
 * v4.1.0 (2025-11-21) - FEATURE: Playoff message parsing support
 *                      - NEW: isPlayoffMessage_() - Detect playoff bracket messages
 *                      - NEW: preprocessPlayoffMessage_() - Extract teams/datetime from multi-map playoff formats
 *                      - CHANGED: parseScheduleMessage_v3() now preprocesses playoff messages before parsing
 *                      - SUPPORTS: "Quarter finals", "Semi finals", "Finals" message formats
 *                      - HANDLES: Multi-line map ban/pick sequences with emoji markers
 *                      - EXTRACTS: Division, teams, date/time from complex playoff announcements
 *                      - STRIPS: Ban/pick lines, emoji markers, playoff keywords, server references
 *                      - CLEANS: "date/time:" prefixes, "start time" filler words, server TBD notes
 *                      - BACKWARD COMPATIBLE: Regular season messages unaffected
 *                      - Location: 60_parser.gs (lines 1434-1564)
 *                      - Impact: Enables automatic parsing of playoff match schedules
 *                      - See: deployment/PLAYOFF_PARSER_ENHANCEMENT.md for full documentation
 * v4.0.2 (2025-11-12) - UX: Consolidated polling interface improvements
 *                      - CHANGED: Polling section now matches Historical Parsing layout
 *                      - NEW: Discord message link for last processed polling ID
 *                      - NEW: "Continue from Last" and "Parse from Specific ID" buttons for polling
 *                      - REMOVED: Separate "Set Start ID" and "Clear Start ID" buttons (redundant)
 *                      - FIXED: Removed emoji characters causing syntax errors in older browsers
 *                      - Note: Polling always processes current week with no skip logic
 * v4.0.1 (2025-11-12) - FEATURE: Web UI for channel configuration management
 *                      - NEW: server_getChannelIds(secret) - Get current channel IDs from Script Properties
 *                      - NEW: server_setChannelIds(secret, channels) - Update channel IDs via web
 *                      - NEW: Control panel section "📡 Channel Configuration" for managing Discord channel IDs
 *                      - Location: 50_webapp.gs (lines 655-722), ktp_control_panel.html (lines 261-288, 868-944)
 *                      - UI Features: Load/save channel IDs, validation, confirmation dialogs
 *                      - Impact: Fixes issue where Script Properties couldn't be modified in Apps Script editor
 *                      - Solves: Posting to wrong channel when Script Properties override config constants
 * v4.0.0 (2025-11-12) - Alpha Release
 *                      - FEATURE: Web UI for automatic polling management
 *                      - NEW: server_clearAllScheduled() - Web endpoint to clear all scheduled matches
 *                      - NEW: server_getPollingStatus() - Get current polling trigger status
 *                      - NEW: server_enablePolling(secret, intervalMinutes) - Enable automatic polling via web
 *                      - NEW: server_disablePolling(secret) - Disable automatic polling via web
 *                      - NEW: Control panel section "⏰ Automatic Polling" with status, interval, and controls
 *                      - Location: 50_webapp.gs (lines 655-730), ktp_control_panel.html (lines 298-324, 839-964)
 *                      - UI Features: Real-time status display, configurable interval, clear schedules button
 *                      - Impact: Full web-based management of automatic polling without needing Apps Script editor
 * v3.11.8 (2025-11-12) - FEATURE: Automatic polling with schedule store management
 *                      - NEW: clearAllScheduledMatches() - Clears all stored schedules to allow re-scheduling
 *                      - NEW: setupAutomaticPolling(minutes) - Creates time-based trigger for automatic polling
 *                      - NEW: removeAutomaticPolling() - Removes automatic polling triggers
 *                      - NEW: automaticPollingHandler() - Trigger handler (polls without skipScheduled flag)
 *                      - Location: 10_storage.gs (lines 129-234)
 *                      - Usage: Run clearAllScheduledMatches() once, then setupAutomaticPolling(5) for 5-min intervals
 *                      - Impact: Enables hands-free automatic polling that allows re-scheduling of matches
 * v3.11.7 (2025-11-12) - BUGFIX: Strip conversational fragments from team names
 *                      - FIXED: Messages with conversational prefixes now parse correctly
 *                      - Example: "Uhhh gold? Soul vs Over" → Extracts "Soul" and "Over" (not "Uhhh gold? Soul")
 *                      - Previous behavior: Conversational text like "Uhhh gold?" attached to team names
 *                      - New behavior: Strips common conversational prefixes (uhhh, um, well, ok, etc.) and division mentions with punctuation
 *                      - Location: splitVsSides() in 60_parser.gs (lines 327-329)
 *                      - Impact: Allows parsing casual messages where captains add conversational context
 * v3.11.6 (2025-11-12) - BUGFIX: Strip leading date patterns from side A (team names)
 *                      - FIXED: Messages starting with dates now parse correctly
 *                      - Example: "Sunday 9 VOLVO vs GVMH" → Extracts "VOLVO" and "GVMH" (not "Sunday 9 VOLVO")
 *                      - Previous behavior: Leading dates attached to team names caused match failures
 *                      - New behavior: Strips day-of-week + optional day number from start of side A
 *                      - Location: splitVsSides() in 60_parser.gs (line 323)
 *                      - Impact: Allows parsing messages that start with date before team names
 *                      - Note: Parser currently supports ONE match per message (multi-match messages require separate lines)
 * v3.11.5 (2025-11-12) - BUGFIX: Strip standalone "week" leftover from map name stripping
 *                      - FIXED: Messages like "Team A vs Team B Saints week Sunday..." now parse correctly
 *                      - Example: "Morons vs Clinic Saints week Sunday..." → After map strip: "...Clinic week Sunday..." → Final: "Clinic"
 *                      - Previous behavior: "Clinic week" failed to match team (had extra "week" word)
 *                      - New behavior: Strips standalone "week" word after date/time stripping
 *                      - Location: splitVsSides() in 60_parser.gs (line 334)
 *                      - Impact: Fixes parsing when map names like "Saints week" get partially stripped
 * v3.11.4 (2025-11-12) - ENHANCEMENT: Allow rescheduling of POSTPONED and TBD matches
 *                      - CHANGED: "Skip already scheduled" checkbox now allows updates to POSTPONED/TBD matches
 *                      - Previous behavior: POSTPONED matches were skipped (couldn't be rescheduled)
 *                      - New behavior: Only matches with real times are skipped; POSTPONED/TBD can be updated
 *                      - Example: Match scheduled as "POSTPONED" → Captain posts real time → Updates to new time
 *                      - Location: applyScheduleUpdatesFromPairs() in 70_updates.gs (lines 196-197)
 *                      - Impact: Captains can now reschedule postponed matches without unchecking the skip box
 * v3.11.3 (2025-11-12) - BUGFIX: Handle multiple "vs" delimiters in messages with prose text
 *                      - FIXED: Messages with prose text before team names now parse correctly
 *                      - Example: "We continue... vs Volvo... vs Price is delayed" → Extracts Volvo and Price
 *                      - Previous behavior: First "vs" split extracted prose text as team A (matched to wrong team)
 *                      - New behavior: Detects prose in first part, uses last two parts as teams
 *                      - Location: splitVsSides() in 60_parser.gs (lines 264-288)
 *                      - Impact: Prevents false team matches when captains embed schedules in conversational messages
 * v3.11.2 (2025-11-12) - FEATURE: Support postponement notifications
 *                      - NEW: Messages containing "postponed", "delayed", "postpone", or "delay" are scheduled as "POSTPONED"
 *                      - NEW: Parser now distinguishes between "TBD" (not yet scheduled) and "POSTPONED" (was scheduled, now delayed)
 *                      - ENHANCED: Postponed matches use fallback week matching (finds ANY week with the matchup)
 *                      - Example: "Volvo vs Price is delayed one week" → Scheduled as "POSTPONED" in their matchup week
 *                      - Location: parseWhenFlexible() and parseScheduleMessage_v3() in 60_parser.gs
 *                      - Impact: Captains can notify about postponements without manual sheet updates
 * v3.11.1 (2025-11-11) - BUGFIX: Handle hybrid "vs" + semicolon format AND hyphen-wrapped division labels
 *                      - FIXED: Messages with both "vs" AND semicolons now parse correctly
 *                      - FIXED: Division labels like "-BRONZE-" no longer interfere with team splitting
 *                      - Example: "-BRONZE- NoGo vs. Rico's; dod_thunder2; Sunday @ 9 PM"
 *                      - Previous behavior:
 *                        1. Semicolons caused incorrect team splitting
 *                        2. "-BRONZE-" was treated as split delimiter (resulted in empty side A)
 *                      - New behavior:
 *                        1. Semicolons after "vs" are converted to spaces in preprocessing
 *                        2. Leading division labels stripped before splitting (prevents hyphen conflicts)
 *                      - Location: cleanScheduleText() in 60_parser.gs
 *                      - Impact: Prevents "no_vs" parse errors for valid match schedules with division prefixes
 * v3.11.0 (2025-11-11) - FEATURE: Smart Alias Suggestions via DM
 *                      - NEW: Auto-detect failed team matches and send DM suggestions to captains
 *                      - NEW: analyzeTeamsForAliases() reads Teams sheet (rows 2/16/30) and generates comprehensive alias list
 *                      - NEW: logMissingAliases() reports which aliases are missing from _Aliases sheet
 *                      - NEW: suggestTeamAlias() performs fuzzy matching to suggest correct team
 *                      - NEW: sendAliasSuggestionDM() sends interactive DM with "yes/no/correction" prompts
 *                      - NEW: sendDM(), addReaction(), getReactions() relay functions (30_relay.gs)
 *                      - NEW: Pending suggestions stored in Script Properties for later confirmation
 *                      - NEW: addAliasToSheet() auto-adds confirmed aliases to _Aliases sheet
 *                      - NEW: DM logging to WM_Log sheet for audit trail
 *                      - NEW MODULE: 12_alias_suggestions.gs (6 functions)
 *                      - UPDATED: 30_relay.gs (+3 functions), 05_util.gs (+3 functions), 60_parser.gs (DM integration)
 *                      - Example: "soul skaters" not found → DM: "Did you mean SOUL SKATERS (Gold)?"
 *                      - Captain replies "yes" → Auto-adds alias → Future matches succeed
 * v3.10.0 (2025-11-11) - BEHAVIOR CHANGE: Always create confirmations for re-processed matches
 *                      - Removed re-schedule detection from confirmation logic
 *                      - When "Skip Already Scheduled" is UNCHECKED: Shows all processed matches
 *                      - When "Skip Already Scheduled" is CHECKED: Only shows truly new matches
 *                      - Enables full testing/development workflow with complete visibility
 *                      - Re-processing now shows: "✅ Parsed 9 matches" + 9 confirmations
 *                      - Production mode with checkbox: "✅ Parsed 2 matches" + 2 confirmations
 *                      - Removed rescheduleCount tracking entirely (no longer needed)
 * v3.9.9 (2025-11-11) - CRITICAL FIX: rescheduleCount now batch-local, not persistent
 *                     - Moved rescheduleCount from persistent store to local variable
 *                     - Before: rescheduleCount accumulated forever in store → negative counts (-45!)
 *                     - After: rescheduleCount resets each batch → accurate counts
 *                     - Fixes "Parsed -45 matches" bug from persistent accumulation
 *                     - rescheduleCount now tracked per updateTablesMessageFromPairs call
 * v3.9.8 (2025-11-11) - BUGFIX: Fixed successCount to only count NEW schedules
 *                     - Changed actuallyUpdated calculation to subtract rescheduleCount
 *                     - Before: Re-schedules counted toward successCount even without confirmations
 *                     - After: Only NEW schedules counted, matching confirmation count
 *                     - Fixes final piece of "Parsed 8 vs Scheduled 9" mismatch
 * v3.9.7 (2025-11-11) - IMPROVEMENT: Smart confirmation creation for re-schedules
 *                     - Removed hardcoded skipScheduled=true (now respects UI checkbox)
 *                     - Track re-schedules separately from new schedules (rescheduleCount)
 *                     - Only create Discord confirmations for NEW schedules, not re-schedules
 *                     - Allows re-processing during development (regex fixes, testing)
 *                     - With "Skip Already Scheduled" checkbox: Skips entirely, no re-processing
 *                     - Without checkbox: Re-processes but doesn't spam confirmations
 *                     - Fixes count mismatch without breaking development workflow
 * v3.9.6 (2025-11-11) - BUGFIX: Handle Discord 2000 character limit for batch summaries
 *                     - Added automatic message splitting when batch summary exceeds 1900 chars
 *                     - Prevents last confirmation from being truncated mid-link
 *                     - Before: Long summaries cut off, showing "[Jump to message](⁠match-alerts⁠" (truncated)
 *                     - After: Splits into multiple messages if needed, preserving all links
 *                     - Each message chunk stays safely under Discord's 2000 char limit
 * v3.9.5 (2025-11-11) - BUGFIX: Skip already-scheduled matches to fix count mismatch
 *                     - Enabled skipScheduled option by default when processing messages
 *                     - Prevents re-scheduling existing matches (e.g., during historical backfill)
 *                     - Before: Re-scheduled matches counted as updated, created confirmations
 *                     - After: Already-scheduled matches skipped, only NEW schedules create confirmations
 *                     - Fixes "Parsed 8 matches" vs "Scheduled 9 matches" mismatch
 *                     - Logs: "⏭️ Skipping already-scheduled: division • team1 vs team2 • time"
 * v3.9.4 (2025-11-11) - BUGFIX: Fixed count mismatch between parsed matches and confirmations
 *                     - Changed actuallyUpdated from hardcoded 1 to actual updateResult.updated count
 *                     - Before: Always returned 1 when any matches scheduled, regardless of count
 *                     - After: Returns actual number of pairs scheduled from updateTablesMessageFromPairs
 *                     - Added DEBUG logging to track confirmation creation and collection
 *                     - Logs: "✉️ Created confirmation..." and "📬 Confirmation added..."
 *                     - Helps diagnose mismatches between "Parsed X matches" and "Scheduled Y matches"
 * v3.9.3 (2025-11-11) - BUGFIX: Validate Discord message links before adding to confirmations
 *                     - Added URL validation to ensure links start with https:// or http://
 *                     - Prevents malformed links like "[Jump to message](⁠match-alerts⁠" from being added
 *                     - If buildDiscordMessageLink returns invalid/empty result, skip link entirely
 *                     - Improves robustness when channel ID or guild ID is missing/incorrect
 * v3.9.2 (2025-11-11) - BUGFIX: Retain author mentions and message links in batch summary
 *                     - Fixed regex extraction to keep "Scheduled by @user" and "[Jump to message]" links
 *                     - Before: "• Gold • map • TEAM1 vs TEAM2 • time" (missing author/link)
 *                     - After: "• Gold • map • TEAM1 vs TEAM2 • time • Scheduled by @user • [Jump to message](...)"
 *                     - Preserves attribution and quick access to original schedule messages
 * v3.9.1 (2025-11-11) - BUGFIX: Fixed match counter when multiple pairs scheduled from one message
 *                     - successCount/tentativeCount now increment by actual number of matches (res.updated), not 1 per message
 *                     - Fixes discrepancy where "Parsed 9 matches" but "Scheduled 10 matches" displayed
 *                     - Example: Message scheduling 2 pairs now counts as 2 matches, not 1
 * v3.9.0 (2025-11-11) - MAJOR PERFORMANCE & UX ENHANCEMENTS
 *                     - 🎯 BATCHED CONFIRMATIONS: Consolidate individual schedule confirmations into single summary
 *                       • Before: 8 separate messages (":white_check_mark: Gold • THUNDER vs ICYHOT..." × 8)
 *                       • After: 1 summary message ("✅ Scheduled 8 matches: • Gold • map • teams • time...")
 *                       • Prevents Discord spam, easier to scan, guaranteed delivery before timeout
 *                     - ⚡ CACHE PERSISTENCE: Reuse caches when clicking "Continue" within 5 minutes
 *                       • Saves ~180 sheet reads per batch on immediate continues
 *                       • Auto-clears after 5min to ensure data freshness
 *                       • Logged: "⚡ Reusing caches from 23s ago" or "🔄 Cleared caches (12 minutes since last batch)"
 *                     - 🐛 EMOJI DEDUPLICATION: Fix "NoGo NoGo" and "Team_Rodeo Rodeo" duplicate names
 *                       • Happens when captains use both team name AND team emoji
 *                       • Added word deduplication: "NoGo <:NoGo:123>" → "NoGo" (not "NoGo NoGo")
 *                       • Improves fuzzy matching accuracy and reduces matcher workload
 *                     - 🔍 DEBUG LOGGING IMPROVED: Team match results now show FINAL state (after fallback)
 *                       • Before: Logged first attempt → showed null even when fallback succeeded
 *                       • After: Logged after fallback → always shows actual match result
 *                       • Eliminates confusion about "matchA=null" that actually scheduled
 *                     - 📊 LOGGING ALREADY OPTIMIZED: Confirmed rendering logs already deduplicated per week
 *                       • _renderedWeeksThisExecution prevents duplicate "📋 Rendering week..." logs
 *                       • No changes needed - working as intended!
 * v3.8.5 (2025-11-09) - BUGFIX: Handle em-dash wrapped division labels and leading punctuation
 *                     - Enhanced division label stripping to handle em-dashes: "—BRONZE—"
 *                     - Added leading punctuation removal from side B after split
 *                     - Fixes "—BRONZE—\nNoGo vs. Rifle Nades;" where em-dash delimiter was not recognized
 *                     - Pattern now matches: "BRONZE:", "—BRONZE—", "Bronze -", etc.
 * v3.8.4 (2025-11-09) - BUGFIX: Strip "week N" pattern from team names in schedule parsing
 *                     - Added regex to remove "week 4", "week 10", etc. from side B in splitVsSides()
 *                     - Fixes "The Rodeo vs the Wickeds week 4" where "week 4" is metadata
 *                     - Pattern: /\bweek\s+\d+\b.(wildcard)/i strips "week" followed by numbers
 *                     - Prevents week numbers from being included in team name matching
 * v3.8.3 (2025-11-09) - BUGFIX: Fixed regex typo in common map names
 *                     - Removed double pipe (||) between "harrington" and "anzio" in map names regex
 *                     - Double pipe created empty alternative that could break regex matching
 *                     - Fixes "Anzio soul vs Over" where Anzio wasn't being stripped
 *                     - Added debug logging to show map stripping results
 * v3.8.2 (2025-11-09) - BUGFIX: Enhanced possessive handling for curly apostrophes and spacing
 *                     - Handle both ASCII (') and curly (') apostrophes in possessives
 *                     - Handle spaced possessives: "Wicked ' s" → "Wickeds"
 *                     - Fixes "The Wicked's" with curly quotes or extra spacing
 * v3.8.1 (2025-11-09) - BUGFIX: Exclude template teams from fuzzy matching
 *                     - Added filter to skip template teams (BRONZE A, BRONZE B, ..., BRONZE N, etc.)
 *                     - Prevents "NoGo" from matching to "BRONZE N" template team
 *                     - Template teams are placeholders before season starts and should never match schedules
 *                     - Added debug logging to show team matching results
 * v3.8.0 (2025-11-09) - BUGFIX: Handle slash separators in schedule messages
 *                     - Added logic to strip " / " separated metadata from team names
 *                     - Fixes "clanX vs GVMH / week 4 armory / 3pm est" parsing
 *                     - Preserves dates like "10/12" by only matching slashes with surrounding spaces
 * v3.7.9 (2025-11-09) - ENHANCEMENT: Consolidated weekly board creation/edit logs
 *                     - Combined multiple granular logs into single consolidated message
 *                     - Example: "Week 2025-10-12|dod_armory_b6: header (ID: 123), table (ID: 456)"
 *                     - Moved to WM_Log only (not Discord) for cleaner output
 *                     - Reduces Discord spam from 3-4 messages to 0 (kept in sheets for debugging)
 * v3.7.8 (2025-11-09) - BUGFIX: Enhanced date/time stripping in team name extraction
 *                     - Added day-of-week abbreviations (sun, mon, tue, etc.) to splitVsSides stripping
 *                     - Added month + day pattern stripping (e.g., "October 5th")
 *                     - Fixes "vs The Wicked's Sunday October 5th at 10pm EDT" parsing
 *                     - Prevents date/time text from being included in team name matching
 * v3.7.7 (2025-11-09) - BUGFIX: Enhanced map hint stripping with common DoD map names
 *                     - Added fallback pattern for common maps: "Railyard", "Railroad", "Anjou", etc.
 *                     - Fixes "Railyard Soul vs Thunder" where "Railyard" is map hint before team name
 *                     - Helps when map not in catalog yet or captain uses shorthand map names
 * v3.7.6 (2025-11-09) - BUGFIX: Handle possessive apostrophes in team names
 *                     - normalizeTeamText() now converts 's to s before normalization
 *                     - Fixes "The Wicked's" → "The Wickeds" matching
 *                     - Prevents parse failures when captains use possessive forms
 * v3.7.5 (2025-11-09) - ENHANCEMENT: Improved Discord logging and message organization
 *                     - Added Discord message links to skipped message warnings for easier troubleshooting
 *                     - Moved verbose rendering logs to WM_Log sheet only (not Discord)
 *                     - Messages moved: "📋 Rendering week", "📊 Generated weekly tables body", "⏭️ Skipping rematches", "⏭️ Table unchanged"
 *                     - Combined and streamlined "Weekly Boards Posted/Edited" and schedule confirmation messages
 *                     - Format: ":white_check_mark: KTP Season 8 :KTP: Gold • map • teams • time • Scheduled by @user • Jump to message"
 *                     - Removes redundant map names, timestamps, and action words for cleaner Discord output
 *                     - Reduces Discord log spam while maintaining full debug info in sheets
 * v3.7.4 (2025-11-08) - BUGFIX: Added support for animated Discord emojis
 *                     - Updated emoji regex from <:name:id> to <a?:name:id> (supports both static and animated)
 *                     - Fixes parse failures with animated emojis like <a:Team_Emo:123>
 *                     - Also updated versus emoji to support animated version <a:versus:123>
 * v3.7.3 (2025-11-08) - BUGFIX: Fixed "Continue from Last" button to not reprocess last message
 *                     - Added inclusive parameter to server_startPollingFrom() (defaults to true)
 *                     - "Continue from Last" now passes inclusive=false (exclusive, start after last)
 *                     - "Parse from Specific ID" passes inclusive=true (inclusive, includes specified message)
 *                     - Prevents duplicate processing when continuing historical parsing
 * v3.7.2 (2025-11-08) - ENHANCEMENT: Improved emoji parsing for edge cases
 *                     - Added support for special characters in custom emoji names (~, -, !, .)
 *                     - Handles Discord auto-renamed emojis like <:Team_Dice~1:123>
 *                     - Custom :versus: emoji now recognized as delimiter: <:versus:123> → " vs "
 *                     - Always log raw messages (not just DEBUG mode) to aid parse failure debugging
 * v3.7.1 (2025-11-08) - BUGFIX: Multi-word team matching when emoji + text both present
 *                     - Fixed matchTeam() to try resolving each word individually
 *                     - Handles "<:Team_Thunder:123> THUNDER" → resolves "Team_Thunder" from alias
 *                     - Prevents wrong division detection when captain uses emoji + text name
 *                     - Example: "<:Team_Thunder:...> THUNDER vs ICYHOT" now correctly matches Gold teams
 * v3.7.0 (2025-11-08) - PERFORMANCE: Batch-level caching for massive speed improvement
 *                     - buildWeekListFromSheets() now caches result for entire batch (~180 sheet reads saved per message!)
 *                     - Team alias and team index caches now persist across messages in same batch
 *                     - Removed cache clearing in resolveTeamAlias() and parseScheduleMessage_v3()
 *                     - Increased POLL_MAX_MESSAGES_PER_RUN from 5 to 10 (safe with caching)
 *                     - Reduced verbose logging: raw message and parsed result logs now DEBUG_PARSER only
 *                     - Expected performance: 10-15+ messages/batch instead of 3-4 (3-4x improvement!)
 *                     - Cache safety: Only caches static match structure (teams, maps, dates), not schedules/scores
 *                     - Scheduling matches updates column E + store but doesn't invalidate cache (by design)
 *                     - FEATURE: Full emoji support for team names and delimiters
 *                     - Custom Discord emojis: <:emo:123> → "emo" (use emoji name in _Aliases sheet)
 *                     - :versus: and 🆚 emoji now recognized as valid delimiters (converted to "vs")
 *                     - :flag_ch: style emoji shortcodes converted to Unicode flags (🇨🇭, etc.)
 *                     - Captains can use emojis exclusively: "<:emo:123> vs <:clanx:456> 9pm" works!
 *                     - Examples: "<:CHI:123> vs emo 9pm", "🇨🇭 vs emo 9pm", ":flag_ch: vs emo 9pm"
 * v3.6.3 (2025-11-06) - BUGFIX: Parser now strips filler words before times
 *                     - Added "default", "usual", "normal", "regular", "standard", "typical" to strip list
 *                     - Fixes "emo // clanx default 9pm" being parsed as team "clanx default"
 *                     - Team names are now correctly extracted without trailing filler words
 * v3.6.2 (2025-11-06) - ENHANCEMENT: Rematches now display scheduled times (not hardcoded TBD)
 *                     - getMakeupMatchesAllDivs() now reads column E (scheduled time) and rowIndex
 *                     - renderRematchesTableBody() displays actual scheduled times for rematches
 *                     - Rematch scheduled times use same ET-aligned formatting as weekly tables
 *                     - ENHANCEMENT: Improved ET-aligned time formatting (centered timestamp)
 *                     - padScheduled() now normalizes timestamps to 17 chars then centers in column
 *                     - All times display with "ET" vertically aligned and timestamp centered
 *                     - Format: "  8:00 PM ET 9/28  " (8 char time + " ET " + 5 char date, centered)
 * v3.6.1 (2025-11-06) - ENHANCEMENT: ET-aligned scheduled times for improved readability
 *                     - Added padScheduled() function to align all times on "ET" timezone
 *                     - Times now display with consistent "ET" position: " 8:00 PM ET 9/28"
 *                     - Improves visual scanning of match schedules in Discord tables
 *                     - BUGFIX: Fixed last processed message ID not updating in control panel
 *                     - server_getState() now reads from DISCORD_LAST_POINTER (same key parser writes to)
 *                     - server_setStartId() and server_clearStartId() now use pointer helper functions
 *                     - Control panel "Last Processed Message ID" now updates after each batch
 * v3.6.0 (2025-11-06) - FEATURE: Scheduled times now display in Discord tables (replaces TBD)
 *                     - Discord tables read from column E and store.sched to show actual match times
 *                     - Added scheduled field and rowIndex to getMatchesForDivisionWeek()
 *                     - Updated renderDivisionWeekTable() to accept store and display schedules
 *                     - FEATURE: DEBUG_PARSER centralized with UI toggle in control panel
 *                     - Moved DEBUG_PARSER to 00_config.gs (global var for runtime modification)
 *                     - Added server_getDebugStatus() and server_setDebugParser() endpoints
 *                     - Added debug parser toggle checkbox in ktp_control_panel.html
 *                     - FEATURE: Division hint validation - trusts team roster over captain hints
 *                     - Parser now tries without hint if teams not found in hinted division
 *                     - Warns captains when division hint doesn't match actual team division
 *                     - Prevents "row_not_found" errors from wrong division hints (e.g., "Silver:" for Bronze teams)
 *                     - FEATURE: Historical parsing continue functionality
 *                     - Added "Continue from Last" button for resuming historical parsing
 *                     - Added last message ID display with copy-to-clipboard button
 *                     - Control panel shows last processed message ID on page load
 *                     - BUGFIX: Fixed message counting - inclusive message now uses finally block
 *                     - Ensures all processed messages are counted, even on errors
 *                     - BUGFIX: Fixed field name mismatches causing "undefined" errors
 *                     - Normalized updatedPairs → updated, skippedPairs → skipped for UI compatibility
 *                     - Added skipped count tracking throughout parser pipeline
 *                     - Enhanced error handling in server_startPollingFrom with detailed messages
 *                     - ENHANCEMENT: Control panel UI improvements
 *                     - Added version badge display (loads from server_getVersion)
 *                     - Added confirmation dialogs for destructive operations (delete, reset)
 *                     - Improved button hierarchy and visual feedback
 *                     - Stretched debug dock to viewport bottom for better visibility
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

// ---- DEBUG SETTINGS ----
var DEBUG_PARSER = false;  // Toggle verbose parser logging (🔍, 🗺️, 📈 messages)

// ---- DISCORD RELAY ----
//CODE_TO_GENERATE_SECRET = 'node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"';
const RELAY_BASE = 'RELAY_BASE';
const RELAY_AUTH = 'RELAY_AUTH';

// Server
const DISCORD_GUILD_ID = '996884268804493363';  // KTP Discord server ID

// Channels
const SCHED_INPUT_CHANNEL_ID = '1063529682919755927';  // captains post schedules
const WEEKLY_POST_CHANNEL_ID = '1081260197340794920';  // weekly board lives here
const RESULTS_LOG_CHANNEL_ID = '1438133465014079551';  // logs/alerts/messages

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
const POLL_MAX_MESSAGES_PER_RUN = 10;  // Increased from 5 due to batch caching improvements
const POLL_SOFT_DEADLINE_MS = 4.75 * 60 * 1000; // ~4.75 minutes
const LOOKUP_CACHE_TTL_SEC = 6 * 60 * 60;     // 6 hours

// ---- WEB APP CONTROL PANEL ----
//CODE_TO_GENERATE_SECRET = 'node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"';
const WM_WEBAPP_SHARED_SECRET = 'WM_WEBAPP_SHARED_SECRET';

// ---- EMBED STYLE (for header) ----
const EMBED_COLOR = 0x48C9B0;  // default embed color (teal-ish)
const EMBED_ICON_URL = '';       // optional small icon URL
const EMBED_BANNER_URL = '';       // optional banner image URL

var EMOJI_KTP = '<:KTP:1002382703020212245>';   // <:ktp:EMOJI>
var KTP_EMOJI_ID = '1002382703020212245'; // <:ktp:ID>