# KTPScoreBot-WeeklyMatches

**Version**: 3.0.0
**Last Updated**: 2025-11-02

Google Apps Script automation system for managing KTP Counter-Strike weekly match schedules. Automatically parses Discord schedule messages, updates Google Sheets, and maintains Discord weekly boards with match times, teams, and shoutcasters.

## Overview

KTPScoreBot-WeeklyMatches integrates Discord, Google Sheets, and a custom HTTP relay to automate the weekly match scheduling workflow for three competitive divisions (Bronze, Silver, Gold). The system features intelligent team alias resolution, flexible date/time parsing, automatic weekly board updates, and makeup match tracking.

## Features

- **Automatic Schedule Parsing**: Parse Discord messages like "Bronze: Team Alpha vs Team Beta on Friday 8pm"
- **Fuzzy Team Matching**: Resolves team aliases and variations to canonical names
- **Flexible Date/Time Parsing**: Understands various date formats and relative times
- **Weekly Board Management**: Creates and updates Discord embeds with formatted match tables
- **Multi-Division Support**: Handles Bronze, Silver, and Gold divisions independently
- **Makeup Match Tracking**: Automatically identifies and reports unplayed matches
- **Twitch Integration**: Associates shoutcaster Twitch URLs with scheduled matches
- **Web Control Panel**: HTTP API for external integrations
- **Version Tracking**: Built-in version display and changelog

## Architecture (v3.0.0)

The codebase is currently **8 focused modules** with single responsibilities:

### Module Structure

```
00_config.gs       Configuration constants and version tracking
05_util.gs         General utility functions
10_storage.gs      Week stores and message ID tracking
20_sheets.gs       Google Sheets operations
30_relay.gs        Discord API & relay HTTP
40_logging.gs      Discord/sheet logging
55_rendering.gs    Discord message rendering
60_parser.gs       Schedule message parsing
70_updates.gs      Table update logic
80_twitch.gs       Twitch integration
50_webapp.gs       Web control panel
```

### Key Improvements in v3.0.0

- **Maintainability**: Single-responsibility modules replaced 2400-line monolith main.gs
- **Testability**: Each module can be tested independently
- **Documentation**: Comprehensive inline comments and reference docs
- **Version Control**: VERSION constant and changelog tracking
- **Error Handling**: Improved error messages and logging
- **Code Quality**: Fixed 17 function definition inconsistencies, removed dead functions

## Quick Start

### Prerequisites

- Google Apps Script project
- Google Spreadsheet with division sheets (Bronze, Silver, Gold)
- Discord bot with webhook or relay service
- Script Properties configured (see below)

### Deployment

1. **Upload files** in dependency order (see `DEPLOYMENT_CHECKLIST.md`)
2. **Configure Script Properties**:
   - `RELAY_BASE` - Discord relay URL
   - `WM_RELAY_TOKEN` - Relay auth token
   - `SCHEDULE_CHANNEL_ID` - Discord schedule channel
   - `RESULTS_LOG_CHANNEL_ID` - Discord log channel
   - `ADMIN_SECRET` - Web app auth secret
   - `SPREADSHEET_ID` - Google Sheets ID

3. **Deploy as web app** with appropriate permissions
4. **Test version endpoint**: `GET /exec?op=version`

### Sheet Structure

Each division sheet (Bronze, Silver, Gold) contains weekly blocks:

```
Row 27:  Week ending Jan 10, 2025
Row 28:  de_dust2
Row 29:  2025-01-10
Rows 30-39:  Match data (10 matches)
  Col B: W/L/T
  Col C: Home team
  Col D: Home score
  Col E: (vs)
  Col F: L/W/T
  Col G: Away team
  Col H: Away score

Row 38:  Next week...
```

**Grid Constants**:
- First label row: 27
- Stride: 11 rows per block
- Matches per block: 10

### Supporting Sheets

- **General**: Map alias catalog
- **_Aliases**: Team synonym mappings
- **_Log**: System event logging
- **_Rematches**: Makeup match tracking

## Usage

### Parse a Schedule Message

```javascript
var text = "Bronze: Team Alpha vs Team Beta on Friday 8pm ET";
var parsed = parseScheduleMessage_v3(text);
// Returns: {
//   division: 'Bronze',
//   home: 'Team Alpha',
//   away: 'Team Beta',
//   whenText: 'Friday 8pm ET',
//   epochSec: 1234567890,
//   weekKey: '2025-01-10|de_dust2'
// }
```

### Update Weekly Board

```javascript
var week = {
  date: new Date(2025, 0, 10),
  mapRef: 'de_dust2',
  weekKey: '2025-01-10|de_dust2'
};
var result = upsertWeeklyDiscordMessage_(week);
// Creates/updates Discord weekly board
```

### Apply Schedule Updates

```javascript
var pairs = [
  { division: 'Bronze', home: 'Alpha', away: 'Beta', whenText: 'Friday 8pm' }
];
var result = updateTablesMessageFromPairs_('2025-01-10|de_dust2', pairs);
// Updates Google Sheets and Discord
```

## API Endpoints

### Web App Endpoints

- `GET /exec?op=version` - Get version info
- `GET /exec?op=ping` - Test connectivity
- `GET /exec?op=status` - System status
- `POST /exec` - Process webhook events

### Server Functions

- `server_getTwitchUrl(secret, userId)` - Get Twitch URL for user
- `server_parseSchedule(secret, text)` - Parse schedule text
- Additional endpoints documented in `50_webapp.gs`

## Data Flow

### Schedule Update Flow

1. User posts schedule message in Discord
2. Webhook triggers `doPost()` in `50_webapp.gs`
3. Message parsed by `parseScheduleMessage_v3()` in `60_parser.gs`
4. Teams resolved via `resolveTeamAlias_()` using `_Aliases` sheet
5. Week identified via `_chooseWeekForPair_()` scanning sheet blocks
6. Tables updated via `updateTablesMessageFromPairs_()` in `70_updates.gs`
7. Store persisted via `saveWeekStore_()` in `10_storage.gs`
8. Discord board refreshed via `upsertWeeklyDiscordMessage_()` in `55_rendering.gs`
9. Confirmation posted via `sendLog_()` in `40_logging.gs`

See `MODULE_REFERENCE.md` for detailed data flow diagrams.

## Configuration

### Script Properties

| Property | Description | Example |
|----------|-------------|---------|
| `RELAY_BASE` | Discord relay base URL | `https://relay.example.com` |
| `WM_RELAY_TOKEN` | Relay authentication token | `abc123...` |
| `SCHEDULE_CHANNEL_ID` | Discord channel for schedules | `1234567890` |
| `RESULTS_LOG_CHANNEL_ID` | Discord log channel | `9876543210` |
| `ADMIN_SECRET` | Web app authentication | `secret123` |
| `SPREADSHEET_ID` | Google Sheets ID | `1a2b3c4d5e...` |

### Constants (00_config.gs)

- `VERSION = '3.0.0'` - Current version
- `VERSION_DATE = '2025-11-02'` - Release date
- `EMOJI_OK`, `EMOJI_EDIT`, `EMOJI_X` - Discord reaction emojis

## Testing

See `DEPLOYMENT_CHECKLIST.md` for comprehensive test plan.

### Quick Test Functions

```javascript
// Test schedule parsing
function testParser() {
  var text = "Bronze: Alpha vs Beta on Friday 8pm";
  Logger.log(parseScheduleMessage_v3(text));
}

// Test team alias resolution
function testAlias() {
  Logger.log(resolveTeamAlias_('alpha'));
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

## Documentation

- **`MODULE_REFERENCE.md`**: Detailed module architecture and function reference
- **`DEPLOYMENT_CHECKLIST.md`**: Step-by-step deployment and testing guide
- **`00_config.gs`**: Configuration constants and changelog
- **Inline comments**: JSDoc-style comments throughout codebase

## Version History

### v3.0.0 (2025-11-02)
- **Major Refactoring**: Split monolithic 10main.gs into 8 focused modules
- **Code Quality**: Fixed 17 function definition inconsistencies
- **Cleanup**: Removed 7 dead code functions
- **Version Tracking**: Added VERSION constant, changelog, and display endpoints
- **Documentation**: Created MODULE_REFERENCE.md and DEPLOYMENT_CHECKLIST.md

### v2.1.0 (2024-12-XX)
- Added team alias support via _Aliases sheet
- Improved schedule parser with fuzzy team matching
- Enhanced date/time parsing flexibility

### v2.0.0 (2024-10-XX)
- Initial weekly matches automation system
- Discord relay integration
- Automatic weekly board posting

## Troubleshooting

### Common Issues

**Issue**: "Relay base URL missing"
**Fix**: Set `RELAY_BASE` in Script Properties

**Issue**: Team not found
**Fix**: Add team alias to `_Aliases` sheet

**Issue**: Week not found
**Fix**: Verify sheet blocks have map and date rows

**Issue**: Discord message not updating
**Fix**: Check `RESULTS_LOG_CHANNEL_ID` for error logs

### Logs

- **Apps Script Console**: Execution logs and errors
- **`_Log` Sheet**: Persistent event logging
- **Discord Log Channel**: User-visible notifications

## Contributing

When modifying code:
1. Update version in `00_config.gs` if making changes
2. Test critical paths before deploying
3. Document new functions with JSDoc comments
4. Update `MODULE_REFERENCE.md` if adding functions

## Support

For issues or questions:
1. Check execution logs (Apps Script console)
2. Review `_Log` sheet in spreadsheet
3. Monitor Discord log channel
4. Verify Script Properties configuration

## License

Internal KTP project - Not for public distribution