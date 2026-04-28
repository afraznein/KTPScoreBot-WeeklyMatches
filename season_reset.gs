/**
 * Season Reset Utility — Run ONCE to clear all Season 8 data from Script Properties.
 * Preserves all configuration keys (relay URLs, auth secrets, channel IDs, grid config).
 *
 * Usage: Paste into Apps Script editor, run resetForNewSeason(), then delete this file.
 */

function resetForNewSeason() {
  var sp = PropertiesService.getScriptProperties();
  var all = sp.getProperties();
  var keys = Object.keys(all);

  // Prefixes/patterns for season-specific data to DELETE
  var deletePatterns = [
    'WEEKLY_STORE_',           // Per-week schedule stores
    'WEEKLY_MSG_IDS::',        // Discord message IDs for weekly boards (new format)
    'WEEKLY_MSG_IDS_',         // Discord message IDs (legacy underscore format)
    'WEEKLY_MSG_HASHES::',     // Content hashes for change detection (new format)
    'WEEKLY_MSG_HASHES_',      // Content hashes (legacy underscore format)
    'WEEKLY_REMATCH_HASH::',   // Rematch content hashes
    'PENDING_ALIAS_SUGGESTION::',  // Pending alias DM suggestions
    'DM_CHANNEL_ID::',        // Cached DM channel IDs
    'TWITCH_URL',             // Twitch URLs
  ];

  // Exact keys for season-specific data to DELETE
  var deleteExact = [
    'DISCORD_LAST_POINTER',    // Polling cursor — must reset for new season
    'LAST_SCHED_MSG_ID',       // Last schedule message ID
    'LAST_POSTED_CLUSTER',     // Last posted cluster reference
    'WEEKLY_GLOBAL_SCHEDULES', // Global schedules
    'LAST_BATCH_TIMESTAMP',    // Batch execution timestamp
    'TEAM_SYNONYMS_JSON',     // Team synonyms cache — rebuild for S9 teams
    'DIV_SHEETS_JSON',        // Division sheets cache — rebuild for S9
  ];

  var toDelete = [];
  var toKeep = [];

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var shouldDelete = false;

    // Check prefix patterns
    for (var j = 0; j < deletePatterns.length; j++) {
      if (key.indexOf(deletePatterns[j]) === 0) {
        shouldDelete = true;
        break;
      }
    }

    // Check exact matches
    if (!shouldDelete) {
      for (var j = 0; j < deleteExact.length; j++) {
        if (key === deleteExact[j]) {
          shouldDelete = true;
          break;
        }
      }
    }

    if (shouldDelete) {
      toDelete.push(key);
    } else {
      toKeep.push(key);
    }
  }

  // Log what we're about to do
  Logger.log('=== SEASON RESET PREVIEW ===');
  Logger.log('Total properties: ' + keys.length);
  Logger.log('Will DELETE: ' + toDelete.length);
  Logger.log('Will KEEP: ' + toKeep.length);
  Logger.log('');
  Logger.log('--- DELETING ---');
  toDelete.sort();
  for (var i = 0; i < toDelete.length; i++) {
    Logger.log('  DELETE: ' + toDelete[i]);
  }
  Logger.log('');
  Logger.log('--- KEEPING ---');
  toKeep.sort();
  for (var i = 0; i < toKeep.length; i++) {
    Logger.log('  KEEP: ' + toKeep[i]);
  }

  // Perform the deletion one at a time (GAS has no bulk deleteProperties)
  if (toDelete.length > 0) {
    for (var i = 0; i < toDelete.length; i++) {
      sp.deleteProperty(toDelete[i]);
    }
    Logger.log('');
    Logger.log('Deleted ' + toDelete.length + ' season-specific properties.');
    Logger.log('Preserved ' + toKeep.length + ' configuration properties.');
  } else {
    Logger.log('Nothing to delete — already clean.');
  }

  return {
    deleted: toDelete.length,
    kept: toKeep.length,
    deletedKeys: toDelete,
    keptKeys: toKeep
  };
}
