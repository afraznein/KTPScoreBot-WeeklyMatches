# KTP Weekly Matches Bot

**Version 4.1.4** | Automated weekly match scheduling and Discord board management for competitive Day of Defeat leagues

A Google Apps Script system that monitors Discord for schedule messages, parses match times using natural language, updates Google Sheets, and maintains live Discord weekly boards with formatted match tables across three competitive divisions.

Part of the [KTP Competitive Infrastructure](https://github.com/afraznein).

---

## Purpose

Managing weekly match schedules across multiple divisions manually is error-prone. KTP Weekly Matches Bot automates the workflow:

1. Admins post schedules in Discord using natural language
2. Bot parses division, teams, date/time automatically
3. Google Sheets updated in real-time
4. Discord weekly boards auto-refreshed with formatted tables
5. Fuzzy team matching resolves aliases and typos
6. Makeup matches tracked for unplayed games

---

## Architecture

```
Discord - Schedule Channel
  Admin posts: "Bronze: Team A vs Team B Friday 8pm ET"
     | Webhook (HTTPS)
     v
KTP Discord Relay (Cloud Run)
  Forwards to Apps Script Web App
     | HTTPS POST
     v
KTP Weekly Matches Bot (Google Apps Script - Web App)
  - Parses schedule message (division, teams, date/time)
  - Resolves team aliases via _Aliases sheet
  - Identifies week from map blocks in division sheets
  - Updates Google Sheets with match time
  - Refreshes Discord weekly board embed
  - Logs confirmation
     |                    |
     v                    v
Google Sheets         Discord - Weekly Boards
  Bronze/Silver/Gold    Auto-updated embeds per division
  _Aliases              Grouped by date/time
  _Rematches            Shoutcaster assignments
  _Log
```

---

## Schedule Format

**Basic:** `Division: Team1 vs Team2 on Date Time`

```
Bronze: Wickeds vs Avengers on Friday 8pm ET
Silver: Team A v Team B Sat 9:00 PM
Gold: Alpha - Beta Jan 10 at 8:30pm
```

**Supported features:**
- Division detection (Bronze, Silver, Gold)
- Team separators: `vs`, `v`, `-`
- Flexible dates: day names, dates, relative (`Tomorrow`, `Next Friday`)
- Time formats: `8pm`, `20:00`, `8:30 PM`
- Default timezone: Eastern (ET/EST/EDT with DST handling)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Schedule Parsing** | Natural language with fuzzy team matching and alias resolution |
| **Weekly Boards** | Auto-generated Discord embeds per division, grouped by date/time |
| **Makeup Tracking** | Scans for unplayed matches, logs to `_Rematches` sheet |
| **Twitch Integration** | Shoutcaster links displayed in weekly boards |
| **Web Control Panel** | HTTP API for version, status, remote parsing, polling control |
| **Batch Caching** | Team index + week list caches (~180 sheet reads saved per message) |

---

## Module Structure

```
00_config.gs              Configuration constants, version, changelog
05_util.gs                Utilities (strings, dates, hashing, team matching)
10_storage.gs             Script Properties persistence, week stores
12_alias_suggestions.gs   Team alias suggestion system (DM support)
20_sheets.gs              Google Sheets operations, grid reading
30_relay.gs               Discord API client via HTTP relay
40_logging.gs             Discord + sheet logging
50_webapp.gs              Web control panel and webhook handler
55_rendering.gs           Discord message/embed rendering
60_parser.gs              Schedule message parsing (1700+ lines)
70_updates.gs             Table update logic, week management
80_twitch.gs              Twitch URL management
ktp_control_panel.html    Web UI for control panel
```

---

## Setup

### Prerequisites
- Google Sheet with KTP league structure (Bronze/Silver/Gold division sheets)
- KTP Discord Relay deployed ([Discord Relay](https://github.com/afraznein/DiscordRelay))
- Discord channel for schedule messages

### Installation
1. Open Google Sheet > Extensions > Apps Script
2. Create files in numbered order (00-80) + HTML file
3. Set Script Properties:

| Property | Description |
|----------|-------------|
| `RELAY_BASE` | Discord relay base URL |
| `WM_RELAY_TOKEN` | Relay auth token |
| `SCHEDULE_CHANNEL_ID` | Discord schedule channel ID |
| `RESULTS_LOG_CHANNEL_ID` | Discord log channel ID |
| `ADMIN_SECRET` | Web app auth secret |
| `SPREADSHEET_ID` | Google Sheets ID |

4. Deploy > New Deployment > Web App (Execute as: Me, Anyone can access)
5. Configure Discord relay to forward schedule channel to Web App URL

### Sheet Structure
```
General          — Map aliases, configuration
Bronze           — Division weekly blocks (row 27 start, 11-row stride, 10 matches)
Silver           — Division weekly blocks
Gold             — Division weekly blocks
_Aliases         — Team name aliases (auto-created)
_Rematches       — Makeup match tracking (auto-created)
_Log             — System event log (auto-created)
```

See `deployment/DEPLOYMENT_CHECKLIST.md` for detailed setup and testing steps.

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET ?op=version` | Version info |
| `GET ?op=ping` | Connectivity test |
| `GET ?op=status` | System status |
| `POST` | Process webhook events (schedule messages) |

---

## Related Projects

**KTP Stack:**
- [Discord Relay](https://github.com/afraznein/DiscordRelay) — HTTP proxy for Discord API (required)
- [KTPScoreBot-ScoreParser](https://github.com/afraznein/KTPScoreBot-ScoreParser) — Match score parsing

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## License

MIT License — See [LICENSE](LICENSE).
