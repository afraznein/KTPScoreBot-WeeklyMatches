# KTP Weekly Matches Bot

**Automated weekly match scheduling and Discord board management for competitive Day of Defeat leagues**

**Version**: 3.0.0
**Last Updated**: 2025-11-02

A Google Apps Script automation system that monitors Discord for schedule messages, parses match times using natural language, updates Google Sheets automatically, and maintains live Discord weekly boards with formatted match tables for three competitive divisions.

---

## 🎯 Purpose

Managing weekly match schedules manually across multiple divisions is time-consuming and error-prone:
- ❌ Manual entry of 30+ matches per week into spreadsheets
- ❌ Keeping Discord boards synchronized with sheet data
- ❌ Tracking makeup matches for unplayed games
- ❌ Resolving team name variations and typos
- ❌ Maintaining shoutcaster assignments
- ❌ No automated reminders or updates

**KTP Weekly Matches Bot automates everything:**
- ✅ Admins post schedules in Discord using natural language
- ✅ Bot parses dates, times, and team names automatically
- ✅ Google Sheets updated in real-time
- ✅ Discord weekly boards auto-updated with formatted tables
- ✅ Fuzzy team matching resolves aliases
- ✅ Makeup matches tracked automatically
- ✅ Twitch integration for shoutcasters

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Discord - Schedule Channel                    │
│  Admin posts: "Bronze: Team A vs Team B Friday 8pm" │
└────────────────┬────────────────────────────────┘
                 │ Webhook (HTTPS)
                 ↓
┌─────────────────────────────────────────────────┐
│  KTP Discord Relay (Cloud Run)                 │
│  Proxies webhook to Google Apps Script         │
└────────────────┬────────────────────────────────┘
                 │ HTTPS POST
                 ↓
┌─────────────────────────────────────────────────┐
│  KTP Weekly Matches Bot (Apps Script)          │
│  - Parses schedule message                     │
│  - Resolves team aliases (_Aliases sheet)      │
│  - Identifies week from map blocks             │
│  - Updates Google Sheets                       │
│  - Refreshes Discord weekly board              │
│  - Logs confirmation                           │
└────────┬──────────────────┬─────────────────────┘
         │                  │
         ↓                  ↓
┌──────────────────┐  ┌─────────────────────────────┐
│  Google Sheets   │  │  Discord - Weekly Boards    │
│  - Bronze        │  │  (Auto-updated embeds)      │
│  - Silver        │  │                             │
│  - Gold          │  │  🥉 BRONZE - Week 4         │
│  - _Aliases      │  │  ┌──────────────────────┐  │
│  - _Rematches    │  │  │ Fri 8pm: A vs B      │  │
│  - _Log          │  │  │ Sat 9pm: C vs D      │  │
└──────────────────┘  │  └──────────────────────┘  │
                      └─────────────────────────────┘
```

---

## ✨ Key Features

### 📊 Automatic Schedule Parsing

**Flexible Natural Language Formats:**
```
Bronze: Team Alpha vs Team Beta on Friday 8pm ET
Gold: Alpha v Beta Friday 20:00
Silver: Alpha - Beta Fri 8 PM
```

**Smart Parsing:**
- ✅ Division detection (`Bronze`, `Silver`, `Gold`)
- ✅ Team name extraction (various separators: `vs`, `v`, `-`)
- ✅ Flexible date formats (day names, dates, relative times)
- ✅ Time parsing with timezone support
- ✅ Multiple message formats supported

### 🔍 Fuzzy Team Matching

**Intelligent Alias Resolution:**
```
User posts: "wickeds vs avngrs Friday 8pm"
           ↓
Bot resolves: "WICKEDS" → "Wickeds"
              "avngrs" → "Avengers"
           ↓
Sheet updated with canonical names
```

**Features:**
- ✅ Case-insensitive matching
- ✅ Partial name matching
- ✅ Team alias database (`_Aliases` sheet)
- ✅ Auto-suggestions for unknown teams
- ✅ Prevents duplicate entries

### 📅 Flexible Date/Time Parsing

**Supported Formats:**
```
Friday 8pm ET
Fri 20:00
2025-01-10 8:00 PM
Jan 10 at 8pm
Tomorrow 9pm
Next Friday 8:30pm
```

**Timezone Aware:**
- Default: Eastern Time (ET/EST/EDT)
- Handles daylight saving transitions
- Converts to epoch timestamps for consistency

### 📋 Weekly Board Management

**Auto-Generated Discord Embeds:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🥇 GOLD DIVISION - Week 4 - de_dust2
Week ending: January 10, 2025
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 SCHEDULED MATCHES

Fri 8:00 PM ET
  • Wickeds vs Avengers
  • Team C vs Team D

Sat 9:00 PM ET
  • Team E vs Team F

🎙️ SHOUTCASTERS
  • Caster1 - twitch.tv/caster1
  • Caster2 - twitch.tv/caster2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Features:**
- ✅ Creates new weekly boards automatically
- ✅ Updates existing boards when schedules change
- ✅ Groups matches by date/time
- ✅ Shows shoutcaster assignments
- ✅ Displays map and week ending date
- ✅ Color-coded by division (Bronze/Silver/Gold)

### 🎮 Multi-Division Support

**Three-Tier League System:**
- 🥉 **Bronze** - Entry-level competitive (10 teams)
- 🥈 **Silver** - Intermediate competitive (10 teams)
- 🥇 **Gold** - Advanced competitive (10 teams)

**Independent Management:**
- Separate Google Sheet tabs per division
- Separate Discord weekly boards
- Division-specific team rosters
- Independent match scheduling

### 📝 Makeup Match Tracking

**Automatic Rematch Detection:**
```
System scans sheets weekly:
  Week 1: Team A vs Team B - UNPLAYED
         ↓
  Marked in _Rematches sheet
         ↓
  Notification posted to Discord
         ↓
  "Bronze: Team A vs Team B needs makeup match"
```

**Features:**
- ✅ Scans for empty score cells after week ends
- ✅ Logs to `_Rematches` sheet
- ✅ Posts notifications to Discord
- ✅ Tracks until match is played

### 🎙️ Twitch Integration

**Shoutcaster Management:**
- Associate Discord users with Twitch URLs
- Display shoutcaster links in weekly boards
- Update assignments per week/division
- Web API for external integrations

### 🌐 Web Control Panel

**HTTP API Endpoints:**
```
GET /exec?op=version      - Get version info
GET /exec?op=ping         - Test connectivity
GET /exec?op=status       - System status
POST /exec                - Process webhook events
```

**Server Functions:**
- Parse schedule text remotely
- Get Twitch URLs programmatically
- Update tables via API
- External integration support

### 📊 Version Tracking

**Built-in Version Management:**
- `VERSION` constant in code (`3.0.0`)
- `VERSION_DATE` for release tracking
- Changelog in `00_config.gs`
- Version display endpoint

---

## 🔧 Architecture (v3.0.0)

### Module Structure

The codebase uses **11 focused modules** with single responsibilities:

```
00_config.gs           Configuration constants, version, changelog
05_util.gs             General utility functions (date, string, etc.)
10_storage.gs          Week stores and message ID persistence
12_alias_suggestions.gs Team alias suggestion system
20_sheets.gs           Google Sheets operations (read/write)
30_relay.gs            Discord API client via HTTP relay
40_logging.gs          Discord + sheet logging
50_webapp.gs           Web control panel and webhook handler
55_rendering.gs        Discord message/embed rendering
60_parser.gs           Schedule message parsing
70_updates.gs          Table update logic and week management
80_twitch.gs           Twitch URL management
```

### Key Improvements in v3.0.0

**Before v3.0.0:**
```
10main.gs - 2400 lines of monolithic code
  ↓
- Hard to test
- Hard to debug
- Function name conflicts
- Duplicated code
```

**After v3.0.0:**
```
11 focused modules - 200-300 lines each
  ↓
✅ Single-responsibility modules
✅ Easy to test independently
✅ Clear dependencies
✅ Consistent naming
✅ Comprehensive documentation
```

**Refactoring Results:**
- 🔧 Fixed 17 function definition inconsistencies
- 🧹 Removed 7 dead code functions
- 📚 Added comprehensive inline JSDoc comments
- 📋 Created MODULE_REFERENCE.md documentation
- ✅ Created DEPLOYMENT_CHECKLIST.md

---

## 🚀 Setup & Installation

### Prerequisites

- Google Account with access to Google Sheets
- Google Apps Script project
- Discord bot or webhook configured
- KTP Discord Relay deployed (see [KTP Discord Relay](https://github.com/afraznein/DiscordRelay))
- Google Sheet with KTP league structure

### Step 1: Prepare Google Sheet

**Required Sheets:**
```
Sheets:
├── General          (Map aliases, configuration)
├── Bronze           (Bronze division weekly blocks)
├── Silver           (Silver division weekly blocks)
├── Gold             (Gold division weekly blocks)
├── _Aliases         (Team name aliases - auto-created)
├── _Rematches       (Makeup match tracking - auto-created)
└── _Log             (System event log - auto-created)
```

**Division Sheet Format:**
```
Row 27:  Week ending Jan 10, 2025
Row 28:  de_dust2 (map name)
Row 29:  2025-01-10 (date)
Rows 30-39:  10 matches
  Col B: W/L/T (home)
  Col C: Home team name
  Col D: Home score
  Col E: "vs"
  Col F: W/L/T (away)
  Col G: Away team name
  Col H: Away score

Row 40:  Next week (row 27 + 11)...
```

**Grid Constants:**
- First label row: **27**
- Stride: **11 rows per block**
- Matches per block: **10**

### Step 2: Create Apps Script Project

1. Open your Google Sheet
2. Extensions → Apps Script
3. Delete default `Code.gs`
4. Create files in **dependency order**:
   ```
   00_config.gs
   05_util.gs
   10_storage.gs
   12_alias_suggestions.gs
   20_sheets.gs
   30_relay.gs
   40_logging.gs
   50_webapp.gs
   55_rendering.gs
   60_parser.gs
   70_updates.gs
   80_twitch.gs
   ```

### Step 3: Configure Script Properties

**File → Project Settings → Script Properties:**

| Property | Description | Example |
|----------|-------------|---------|
| `RELAY_BASE` | Discord relay base URL | `https://discord-relay-xxxxx.run.app` |
| `WM_RELAY_TOKEN` | Relay auth token | `your-secret-here` |
| `SCHEDULE_CHANNEL_ID` | Discord schedule channel | `1234567890123456789` |
| `RESULTS_LOG_CHANNEL_ID` | Discord log channel | `9876543210123456789` |
| `ADMIN_SECRET` | Web app auth secret | `admin-secret-123` |
| `SPREADSHEET_ID` | Google Sheets ID | `1a2b3c4d5e6f7g8h9i` |

### Step 4: Configure Constants

Edit `00_config.gs`:

```javascript
// Version
const VERSION = '3.0.0';
const VERSION_DATE = '2025-11-02';

// Emojis
const EMOJI_OK = '✅';
const EMOJI_EDIT = '✏️';
const EMOJI_X = '❌';

// Division sheets
const DIVISION_SHEETS = ['Bronze', 'Silver', 'Gold'];

// Grid geometry
const GRID = {
  firstLabelRow: 27,
  stride: 11,
  matchesPerBlock: 10
};
```

### Step 5: Deploy as Web App

1. **Apps Script → Deploy → New Deployment**
2. **Type:** Web app
3. **Description:** KTP Weekly Matches Bot v3.0.0
4. **Execute as:** Me
5. **Who has access:** Anyone
6. **Click Deploy**
7. **Copy Web App URL**

### Step 6: Configure Discord Webhook

1. **Discord → Channel Settings → Integrations → Webhooks**
2. **Create webhook** pointing to Web App URL
3. **Or:** Use KTP Discord Relay to forward events

### Step 7: Test Installation

```javascript
// In Apps Script console

// Test version
function testVersion() {
  Logger.log(VERSION);  // Should output: 3.0.0
}

// Test parser
function testParser() {
  var text = "Bronze: Team Alpha vs Team Beta on Friday 8pm";
  Logger.log(parseScheduleMessage_v3(text));
}

// Test alias resolution
function testAlias() {
  Logger.log(resolveTeamAlias_('alpha'));  // Should return canonical name
}

// Test storage
function testStorage() {
  var wk = '2025-01-10|de_dust2';
  saveWeekStore_(wk, { sched: { Bronze: {} } });
  Logger.log(loadWeekStore_(wk));
}

// Test weekly board
function testBoard() {
  var week = {
    date: new Date(2025, 0, 10),
    mapRef: 'de_dust2',
    weekKey: '2025-01-10|de_dust2'
  };
  Logger.log(upsertWeeklyDiscordMessage_(week));
}
```

**Test via Web:**
```bash
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?op=version"
# Should return: {"version":"3.0.0","date":"2025-11-02"}
```

---

## 📋 Usage

### For Admins - Posting Schedules

**Basic Format:**
```
Division: Team1 vs Team2 on Date Time
```

**Examples:**
```
Bronze: Wickeds vs Avengers on Friday 8pm ET
Silver: Team A v Team B Sat 9:00 PM
Gold: Alpha - Beta Jan 10 at 8:30pm
```

**What Happens:**
1. Admin posts message in schedule channel
2. Bot reacts with ✅ if parsed successfully
3. Bot updates Google Sheet for that week
4. Bot refreshes Discord weekly board
5. Bot posts confirmation to log channel

### For Players - Viewing Schedule

**Discord Weekly Boards:**
- Check pinned messages in division channels
- Boards auto-update when admins post schedules
- Shows all matches for current week grouped by time
- Displays shoutcaster assignments

**Google Sheets:**
- View complete season schedule
- See scores for completed matches
- Check standings and statistics

### For Shoutcasters

**Twitch Integration:**
```javascript
// Admin can associate your Discord user with Twitch
server_setTwitchUrl(adminSecret, discordUserId, 'twitch.tv/yourchannel');

// Your link will appear in weekly boards automatically
```

---

## 🔗 Related KTP Projects

### **KTP Competitive Infrastructure:**

**🎮 Game Server Layer:**
- **[KTP-ReHLDS](https://github.com/afraznein/KTP-ReHLDS)** - Custom engine with pause system
- **[KTP-ReAPI](https://github.com/afraznein/KTP-ReAPI)** - Custom ReAPI with pause hooks
- **[KTP Match Handler](https://github.com/afraznein/KTPMatchHandler)** - Match management plugin
- **[KTP Cvar Checker](https://github.com/afraznein/KTPCvarChecker)** - Anti-cheat system

**🌐 Supporting Services:**
- **[KTP Discord Relay](https://github.com/afraznein/DiscordRelay)** - HTTP proxy for Discord API
- **[KTP Score Parser](https://github.com/afraznein/KTPScoreBot-ScoreParser)** - Match score parsing
- **[KTP Weekly Matches](https://github.com/afraznein/KTPScoreBot-WeeklyMatches)** - This project
- **[KTP HLTV Kicker](https://github.com/afraznein/KTPHLTVKicker)** - HLTV management

---

## 📝 Version History

### v3.0.0 (2025-11-02)
- 🏗️ **Major Refactoring**: Split monolithic `10main.gs` into 11 focused modules
- 🔧 **Code Quality**: Fixed 17 function definition inconsistencies
- 🧹 **Cleanup**: Removed 7 dead code functions
- 📊 **Version Tracking**: Added VERSION constant and changelog
- 📚 **Documentation**: Created MODULE_REFERENCE.md and DEPLOYMENT_CHECKLIST.md
- ✨ **New Module**: `12_alias_suggestions.gs` for team name suggestions
- 🎯 **Maintainability**: Single-responsibility modules for easier testing
- 📝 **Comments**: Comprehensive JSDoc-style inline documentation

### v2.1.0 (2024-12-XX)
- ✨ Added team alias support via `_Aliases` sheet
- 🔍 Improved schedule parser with fuzzy team matching
- 📅 Enhanced date/time parsing flexibility
- 🐛 Fixed timezone handling edge cases

### v2.0.0 (2024-10-XX)
- 🎉 Initial weekly matches automation system
- 🌐 Discord relay integration
- 📋 Automatic weekly board posting
- 🎮 Multi-division support (Bronze/Silver/Gold)

---

## 🐛 Troubleshooting

### Schedule Not Parsing

**Problem:** No ✅ reaction on Discord message

**Solutions:**
- ✅ Check format: `Division: Team1 vs Team2 on Date Time`
- ✅ Verify division name (`Bronze`, `Silver`, or `Gold`)
- ✅ Ensure team names are in `_Aliases` sheet or roster
- ✅ Check date/time format (use day names like `Friday`)
- ✅ Review Apps Script execution logs
- ✅ Check `_Log` sheet for error details

### Team Not Found

**Problem:** "Unknown team" error in logs

**Solutions:**
- ✅ Add team to division roster (Column C in division sheet)
- ✅ Add alias to `_Aliases` sheet:
  ```
  Row: "teamalias" → "Canonical Team Name"
  ```
- ✅ Check spelling matches roster exactly
- ✅ Use alias suggestion feature to find close matches

### Week Not Found

**Problem:** "Could not identify week" error

**Solutions:**
- ✅ Verify division sheet has weekly blocks at row 27, 38, 49, etc.
- ✅ Each block should have map name (row +1) and date (row +2)
- ✅ Date format in sheet: `2025-01-10` (YYYY-MM-DD)
- ✅ Ensure teams in schedule message appear in weekly block

### Discord Board Not Updating

**Problem:** Weekly board shows outdated information

**Solutions:**
- ✅ Check `RESULTS_LOG_CHANNEL_ID` for error messages
- ✅ Verify bot has permissions to edit messages
- ✅ Check stored message ID in Script Properties
- ✅ Manually delete old board and bot will create new one
- ✅ Run `upsertWeeklyDiscordMessage_()` manually from Apps Script

### Relay Connection Issues

**Problem:** "Relay base URL missing" or connection errors

**Solutions:**
- ✅ Verify `RELAY_BASE` set in Script Properties
- ✅ Verify `WM_RELAY_TOKEN` matches relay secret
- ✅ Test relay: `curl https://relay-url/health`
- ✅ Check KTP Discord Relay is deployed and running
- ✅ Verify webhook URL is correct

### Webhook Not Triggering

**Problem:** Bot doesn't respond to schedule messages

**Solutions:**
- ✅ Verify webhook configured in Discord channel
- ✅ Check webhook URL matches deployed Web App URL
- ✅ Test webhook manually:
  ```bash
  curl -X POST "https://script.google.com/.../exec" \
    -H "Content-Type: application/json" \
    -d '{"content":"Bronze: Test vs Test Friday 8pm"}'
  ```
- ✅ Check Apps Script execution logs for errors

### Permission Errors

**Problem:** "Exception: Permission denied"

**Solutions:**
- ✅ Re-authorize script: Run any function manually
- ✅ Check Google account has edit access to sheet
- ✅ Verify Web App deployment settings ("Execute as: Me")
- ✅ Check Script Properties are set correctly

---

## 📚 Documentation

**Project Documentation:**
- **`MODULE_REFERENCE.md`** - Detailed module architecture, function reference, data flow diagrams
- **`DEPLOYMENT_CHECKLIST.md`** - Step-by-step deployment guide, test plan, validation checklist
- **`00_config.gs`** - Configuration constants, version info, comprehensive changelog
- **Inline JSDoc Comments** - Function-level documentation throughout codebase

**External Documentation:**
- [Google Apps Script Docs](https://developers.google.com/apps-script)
- [Discord API Documentation](https://discord.com/developers/docs)
- [KTP Discord Relay](https://github.com/afraznein/DiscordRelay)

---

## 🙏 Acknowledgments

- **Google Apps Script** - Automation platform
- **Discord** - Communication and board platform
- **KTP Discord Relay** - Discord API proxy service
- **KTP Community** - Testing, feedback, and schedule format suggestions
- **KTP Admin Team** - Deployment and operational support

---

## 📄 License

MIT License - Internal KTP project

See [LICENSE](LICENSE) file for details

---

## 👤 Author

**Nein_**
- GitHub: [@afraznein](https://github.com/afraznein)
- Project: KTP Competitive Infrastructure

---

## 💡 Tips & Best Practices

### For Admins

**Posting Schedules:**
- ✅ Use consistent format: `Division: Team1 vs Team2 on Date Time`
- ✅ Specify timezone (ET assumed if omitted)
- ✅ Use day names (`Friday`) instead of dates when possible
- ✅ Check for ✅ reaction to confirm parsing
- ✅ Review weekly board after posting

**Managing Aliases:**
- ✅ Add common typos to `_Aliases` sheet proactively
- ✅ Use lowercase in alias column, proper case in canonical column
- ✅ Document alias additions in `_Log` sheet

**Troubleshooting:**
- ✅ Check `_Log` sheet for system events
- ✅ Monitor log channel for error notifications
- ✅ Review Apps Script execution logs weekly
- ✅ Test parsing before posting schedule publicly

### For Developers

**Modifying Code:**
1. Update `VERSION` in `00_config.gs` if making changes
2. Document changes in changelog
3. Test critical paths before deploying
4. Add JSDoc comments to new functions
5. Update `MODULE_REFERENCE.md` if adding modules/functions

**Testing:**
- ✅ Use Apps Script debugger for step-through
- ✅ Add test functions for new features
- ✅ Test with various schedule formats
- ✅ Verify weekly board rendering after changes
- ✅ Check all divisions (Bronze/Silver/Gold)

**Deployment:**
- ✅ Follow `DEPLOYMENT_CHECKLIST.md` step-by-step
- ✅ Test in development before production
- ✅ Create new deployment version (don't update existing)
- ✅ Monitor logs for first hour after deployment
- ✅ Keep rollback deployment ID available

---

**KTP Weekly Matches Bot** - Keeping competitive schedules organized, one match at a time. 📅
