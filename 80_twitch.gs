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

function saveTwitchForUser(userId, twitchUrl) {
  const key = 'TWITCH_URL' + String(userId);
  _props_().setProperty(key, String(twitchUrl));
}

function server_getTwitchUrl(secret, userId) {
  try {
    _checkSecret_(secret);
    const key = 'TWITCH_URL' + String(userId);
    const url = _props_().getProperty(key) || '';
    return _ok_({ userId: String(userId), twitchUrl: url });
  } catch (e) {
    return _err_(e);
  }
}
