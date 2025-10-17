// =======================
// store.gs
// Per-week store + global registry + stable match keys
// =======================

/** Compact, stable key for a week (date + map). */
function weekKey_(week){
  // date in YYYY-MM-DD plus normalized map (dod_*)
  return `${fmtDay_(week.date)}|${normalizeMap_(week.map)}`;
}

/** Property keys */
function _weekStoreKey_(wk){ return `WEEKLY_STORE_${wk}`; }

/** Load/save the per-week store: { schedules: {matchKey: whenText}, shoutcasters: {matchKey: tag} } */
function loadWeekStore_(wk){
  const p   = PropertiesService.getScriptProperties();
  const raw = p.getProperty(_weekStoreKey_(wk));
  if (!raw) return { schedules:{}, shoutcasters:{} };
  try {
    const obj = JSON.parse(raw);
    if (!obj.schedules)   obj.schedules   = {};
    if (!obj.shoutcasters) obj.shoutcasters = {};
    return obj;
  } catch {
    return { schedules:{}, shoutcasters:{} };
  }
}
function saveWeekStore_(wk, obj){
  PropertiesService.getScriptProperties()
    .setProperty(_weekStoreKey_(wk), JSON.stringify(obj || { schedules:{}, shoutcasters:{} }));
}

/** Load/save the global registry used for Rematches table.
 *  Shape:
 *    {
 *      "Division|TEAM_A|TEAM_B|dod_map|YYYY-MM-DD": {
 *         whenIso: "",               // reserved; display prefers whenText
 *         whenText: "Sat, Sep 28 @ 9:00 PM",
 *         sourceWeekDay: "2025-09-28",
 *         sourceWeekName: "Week 3",
 *         shoutcaster: "https://twitch.tv/Someone" | "<@123>"
 *      },
 *      ...
 *    }
 */
function loadGlobalSchedules_(){
  const raw = PropertiesService.getScriptProperties().getProperty(GLOBAL_SCHED_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function saveGlobalSchedules_(obj){
  PropertiesService.getScriptProperties().setProperty(GLOBAL_SCHED_KEY, JSON.stringify(obj || {}));
}

/** Stable match key (ignores Home/Away order). */
function matchKey_(division, team1, team2){
  const t1 = normalizeTeam_(team1);
  const t2 = normalizeTeam_(team2);
  const [a,b] = [t1, t2].sort();
  return `${division}|${a}|${b}`;
}