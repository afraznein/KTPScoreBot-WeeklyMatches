// =======================
// 80_twitch.gs - Twitch Integration
// =======================
// Purpose: Twitch URL storage for shoutcaster assignments
// Dependencies: 00_config.gs, 50_webapp.gs
// Used by: webapp endpoints
//
// Functions in this module:
// - saveTwitchForUser(userId, twitchUrl)
// - server_getTwitchUrl(secret, userId)
//
// Total: 2 functions
// =======================

/**
 * Save a Twitch URL for a Discord user ID.
 * @param {string} userId - Discord user ID (snowflake)
 * @param {string} twitchUrl - Twitch channel URL or username
 */
function saveTwitchForUser(userId, twitchUrl) {
  const key = 'TWITCH_URL' + String(userId);
  props().setProperty(key, String(twitchUrl));
}

/**
 * Retrieve a stored Twitch URL for a Discord user.
 * @param {string} secret - Authentication secret
 * @param {string} userId - Discord user ID (snowflake)
 * @returns {Object} {ok: true, data: {userId, twitchUrl}} or {ok: false, error}
 */
function server_getTwitchUrl(secret, userId) {
  try {
    checkSecret(secret);
    const key = 'TWITCH_URL' + String(userId);
    const url = props().getProperty(key) || '';
    return ok({ userId: String(userId), twitchUrl: url });
  } catch (e) {
    return error(e);
  }
}
