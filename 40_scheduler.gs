// =======================
// scheduler.gs – Polling and scheduling functions
// =======================

/** Main polling loop: fetch new schedule messages, parse them, and update store. */
function WM_pollScheduling() {
  const startTime = Date.now();
  const sp = PropertiesService.getScriptProperties();
  const lastId = sp.getProperty(LAST_SCHED_KEY) || '';  // last processed schedule message ID

  // Warm up caches if available
  const week = getAlignedUpcomingWeekOrReport_();
  const weekKey = week.weekKey || '';
  const teamMap = getCanonicalTeamMap_();  // ensure team map cached

  // Pull new schedule messages (after the last seen ID, if any)
  const messages = fetchChannelMessages_(SCHED_INPUT_CHANNEL_ID, lastId) || [];
  if (!messages.length) {
    return { ok: true, lastPointer: lastId, tookMs: Date.now() - startTime };
  }

  // Sort messages by ID (ascending chronological order)
  messages.sort((a, b) => compareSnowflakes(a.id, b.id));
  const schedulesStore = {};
  let updatedLastId = lastId;

  for (const msg of messages) {
    const msgId = String(msg.id);
    if (compareSnowflakes(msgId, lastId) <= 0) continue;
    updatedLastId = maxSnowflake(updatedLastId, msgId);
    const content = contentFromRelay_(msg);
    if (!content) continue;
    // Determine division (from channel name or mention in content)
    let division = '';
    try {
      const chanName = (msg.channel && msg.channel.name) || '';
      division = canonDivision_(chanName);
    } catch (e) {}
    // Parse schedule message content
    const result = parseScheduleMessage_(content, division);
    if (result && Array.isArray(result.pairs)) {
      for (const pair of result.pairs) {
        const div = pair.division || division || '(unknown)';
        schedulesStore[div] = schedulesStore[div] || [];
        schedulesStore[div].push({
          home: pair.home,
          away: pair.away,
          homeScore: null, awayScore: null,
          homeWin: undefined, awayWin: undefined
        });
      }
    }
  }

  // Save parsed schedules to week store
  const store = loadWeekStore_(weekKey);
  store.schedules = schedulesStore;
  saveWeekStore_(weekKey, store);
  // Update last seen message ID pointer
  sp.setProperty(LAST_SCHED_KEY, updatedLastId);

  return { ok: true, lastPointer: updatedLastId, tookMs: Date.now() - startTime };
}

/** A locked version of WM_pollScheduling using LockService (to avoid concurrent execution). */
function WM_pollScheduling_locked() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Could not obtain lock for WM_pollScheduling');
  try {
    return WM_pollScheduling();
  } finally {
    lock.releaseLock();
  }
}