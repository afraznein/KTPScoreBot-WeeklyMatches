// =======================
// debug.gs
// =======================
function WM_quickRelayPing_() {
  const r = UrlFetchApp.fetch(`${RELAY_BASE}/whoami`, { headers:{'X-Relay-Auth': RELAY_AUTH}, muteHttpExceptions:true });
  sendLog_(`whoami → ${r.getResponseCode()} ${(r.getContentText()||'').slice(0,120)}`);
}
function WM_debugPostPage1Once() {
  const week  = getAlignedUpcomingWeekOrReport_();
  const wkKey = weekKey_(week);
  const store = loadWeekStore_(wkKey);
  const pages = renderTablesPages_(week, store);
  const header= renderHeaderEmbedPayload_(week);
  const id = postChannelMessageAdvanced_(WEEKLY_POST_CHANNEL_ID, pages[0] || '```(no data)```', header.embeds);
  sendLog_(`DEBUG post page1 → ${id||'null'}`);
}
function WM_debugEditMessage(msgId) {
  const week  = getAlignedUpcomingWeekOrReport_();
  const wkKey = weekKey_(week);
  const store = loadWeekStore_(wkKey);
  const pages = renderTablesPages_(week, store);
  const header= renderHeaderEmbedPayload_(week);
  const ok = editChannelMessageAdvanced_(WEEKLY_POST_CHANNEL_ID, String(msgId), pages[0], header.embeds);
  sendLog_(`DEBUG edit page1 → ${ok}`);
}