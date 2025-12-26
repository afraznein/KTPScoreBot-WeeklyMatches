# Changelog

All notable changes to KTP ScoreBot Weekly Matches will be documented in this file.

## [4.1.4] - 2025-11-25

### Fixed
- Timezone offset causing wrong dates and times in match scheduling

## [4.1.3] - 2025-11-23

### Added
- Debug logging to diagnose week detection issues

## [4.1.2] - 2025-11-21

### Fixed
- Week detection to properly handle current week window

## [4.1.1] - 2025-11-21

### Fixed
- Playoff parser enhancement and bugfixes
- Skip Discord notification when no matches are parsed

## [4.0.2] - 2025-11-12

### Fixed
- Minor bugfixes from 4.0.0 release

## [4.0.0] - 2025-11-09

### Changed
- Major rewrite of core parsing and scheduling system
- Improved match detection and display

## [3.11.0] - 2025-11-04

### Added
- Enhanced scheduling features

## [3.8.2] - Previous

### Added
- Base functionality for weekly match announcements
- Discord integration
- Google Sheets data source
- Playoff bracket support
- Twitch stream integration
- Web app control panel

### Components
- `00_config.gs` - Configuration and settings
- `05_util.gs` - Utility functions
- `10_storage.gs` - Data persistence
- `12_alias_suggestions.gs` - Team alias handling
- `20_sheets.gs` - Google Sheets interface
- `30_relay.gs` - Discord relay integration
- `40_logging.gs` - Logging system
- `50_webapp.gs` - Web application endpoint
- `55_rendering.gs` - Message rendering
- `60_parser.gs` - Schedule parsing
- `70_updates.gs` - Update handling
- `80_twitch.gs` - Twitch integration
