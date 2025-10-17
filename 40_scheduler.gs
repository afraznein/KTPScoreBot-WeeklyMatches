// =======================
// scheduler.gs
// Batched poller, deferred shoutcaster pass, announce job, clear-week helpers
// =======================

/** Lock wrapper so a timed trigger and a manual run don't overlap. */
function WM_pollScheduling_locked(){
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { sendLog_('⏸️ Skipping poll: lock in use'); return; }
  try { WM_pollScheduling(); }
  finally { try { lock.releaseLock(); } catch(_){} }
}

/** Main polling loop: small batches, soft deadline guard, optional deferred shoutcaster scan. */
function WM_pollScheduling(){
  const start = Date.now();
  const props = props_();

  // Compute aligned week ONCE; warm caches if available
  const alignedWeek = getAlignedUpcomingWeekOrReport_();
  if (alignedWeek) {
    try { getWeekMatchIndex_(alignedWeek); } catch(_) {}
  }

  // Pull new messages (INCLUSIVE start ID)
  const last = props.getProperty(LAST_SCHED_KEY) || '';
  let msgs = [];
  if (last) {
    const one = fetchSingleMessage_(SCHED_INPUT_CHANNEL_ID, last);
    if (one) msgs.push(one);
  }
  const newer = fetchChannelMessages_(SCHED_INPUT_CHANNEL_ID, last) || [];
  if (newer.length) msgs = msgs.concat(newer);
  if (!msgs.length){ sendLog_('ℹ️ No new scheduling messages.'); return; }

  // Oldest → newest; cap per run
  msgs.sort((a,b)=>compareSnowflakes(a.id,b.id));
  if (msgs.length > POLL_MAX_MESSAGES_PER_RUN) msgs = msgs.slice(0, POLL_MAX_MESSAGES_PER_RUN);

  let newest = last;
  let processed = 0;
  const deferred = []; // shoutcaster follow-up items

  for (const m of msgs){
    if (Date.now() - start > POLL_SOFT_DEADLINE_MS) {
      props.setProperty(LAST_SCHED_KEY, newest || last);
      sendLog_(`⏳ Soft deadline after ${processed} msg(s); will resume next run.`);
      break;
    }

    const msgId   = String(m.id);
    newest = maxSnowflake(newest, msgId);

    const contentRaw = String(m.content || '');
    const content    = contentRaw.trim();
    if (!content) continue;

    // Quick twitch self-report: "twitch <something>"
    const twitchCmd = content.match(/^\s*twitch\s+(.{2,})$/i);
    if (twitchCmd && m.author && m.author.id) {
      const ok = setTwitchForUser_(String(m.author.id), twitchCmd[1]);
      const who = `<@${String(m.author.id)}>`;
      if (ok) {
        const saved = getTwitchForUser_(String(m.author.id));
        if (RESULTS_LOG_CHANNEL_ID) postChannelMessage_(RESULTS_LOG_CHANNEL_ID, `🎙️ Saved Twitch for ${who}: ${saved}`);
        appendLogRow_('INFO','twitch_saved','Saved Twitch', { userId: String(m.author.id), url: saved, msgId });
        postReaction_(SCHED_INPUT_CHANNEL_ID, msgId, '✅');
        processed++; continue;
      } else {
        if (RESULTS_LOG_CHANNEL_ID) postChannelMessage_(RESULTS_LOG_CHANNEL_ID, `⚠️ ${who} Twitch not recognized. Send: \`twitch twitch.tv/YourName\` or \`twitch YourName\`.`);
        appendLogRow_('WARN','twitch_unrecognized','Unrecognized Twitch input', { userId: String(m.author.id), raw: twitchCmd[1], msgId });
        postReaction_(SCHED_INPUT_CHANNEL_ID, msgId, '⚠️');
        processed++; continue;
      }
    }

    // Parse schedule message (division optional; map optional; team order flexible; emojis/whitespace handled in parser)
    const parsed = parseScheduleMessage_(content);
    if (!parsed) {
      appendLogRow_('INFO','parse_skip','Skipped (unparseable)', { msgId, preview: content.slice(0,160) });
      continue;
    }

    // Require a resolved division (your parser should do this; if not, log+continue)
    if (!parsed.division) {
      const warn = `⚠️ Could not determine division for "${(content||'').slice(0,120)}"`;
      sendLog_(warn);
      appendLogRow_('WARN','division_undetermined', warn, { msgId });
      continue;
    }

    // Prefer aligned week pending row; else earliest pending rematch across history
    const pick = locatePendingMatchAlignedThenHistory_(parsed.division, alignedWeek, parsed.teamA, parsed.teamB);
    if (!pick || !pick.located) {
      const msg = `❗ No PENDING row for ${parsed.teamA} vs ${parsed.teamB} (div=${parsed.division}).`;
      sendLog_(msg);
      appendLogRow_('WARN','match_not_found_pending', msg, {
        division: parsed.division, teamA: parsed.teamA, teamB: parsed.teamB,
        alignedWeek: alignedWeek ? weekKey_(alignedWeek) : '(none)'
      });
      continue;
    }
    const located   = pick.located;   // { absRow, division, t1, t2, weekObject, ... }
    const foundFrom = pick.from;      // 'aligned' | 'history'

    // Build schedule string (extract from content; default TBD; assume PM if no AM/PM)
    const whenStr = whenStringFromText_(content) || 'TBD';

    // Update per-week store (schedules + optional shoutcaster)
    const wk    = weekKey_(located.weekObject);
    const key   = matchKey_(located.division, located.t1, located.t2); // stable key (order-insensitive)
    const store = loadWeekStore_(wk);
    store.schedules[key] = whenStr;
    saveWeekStore_(wk, store);

    // Mirror to global registry (for Rematches section)
    const glob    = loadGlobalSchedules_();
    const weekDay = fmtDay_(located.weekObject.date);
    const gkey    = `${located.division}|${located.t1}|${located.t2}|${normalizeMap_(located.weekObject.map)}|${weekDay}`;
    if (!glob[gkey]) glob[gkey] = {};
    glob[gkey].whenIso        = ''; // display prefers whenText
    glob[gkey].whenText       = whenStr;
    glob[gkey].sourceWeekDay  = weekDay;
    glob[gkey].sourceWeekName = located.weekObject.headerWeekName || '';
    saveGlobalSchedules_(glob);

    // Defer shoutcaster read to a tiny follow-up run (faster main loop)
    if (DEFER_SC_REACTIONS) {
      const authorId = m.author && m.author.id ? String(m.author.id) : '';
      deferred.push({
        channelId: SCHED_INPUT_CHANNEL_ID,
        messageId: msgId,
        division: located.division,
        t1: located.t1,
        t2: located.t2,
        wk,
        authorId
      });
    } else {
      const scInfo = getShoutcasterInfoForMessage_(SCHED_INPUT_CHANNEL_ID, msgId);
      if (scInfo) {
        store.shoutcasters = store.shoutcasters || {};
        store.shoutcasters[key] = scInfo.tag;
        saveWeekStore_(wk, store);
        glob[gkey].shoutcaster = scInfo.tag;
        saveGlobalSchedules_(glob);
      }
    }

    // Acknowledge + log
    const authorId = m.author && m.author.id ? String(m.author.id) : '';
    const mention  = authorId ? `<@${authorId}>` : '';
    if (RESULTS_LOG_CHANNEL_ID) {
      postChannelMessage_(RESULTS_LOG_CHANNEL_ID,
        `✅ Schedule ${foundFrom==='history'?'(rematch) ':''}updated: **${located.division}** — **${located.t1}** vs **${located.t2}** → \`${whenStr}\` ${mention}`);
    }
    postReaction_(SCHED_INPUT_CHANNEL_ID, msgId, '✅');
    processed++;

    // Soft deadline guard inside loop
    if (Date.now() - start > POLL_SOFT_DEADLINE_MS) {
      props.setProperty(LAST_SCHED_KEY, newest || last);
      sendLog_(`⏳ Soft deadline after ${processed} msg(s); will resume next run.`);
      break;
    }
  } // end for msgs

  if (newest) props.setProperty(LAST_SCHED_KEY, newest);

  // Final board refresh for currently aligned week (if any)
  const alignedForRefresh = alignedWeek || getAlignedUpcomingWeekOrReport_();
  if (alignedForRefresh) upsertWeeklyDiscordMessage_(alignedForRefresh);

  // Queue tiny follow-up for shoutcasters
  if (DEFER_SC_REACTIONS && deferred.length){
    props.setProperty('WM_DEFERRED_SC', JSON.stringify(deferred));
    ScriptApp.newTrigger('WM_pollScExtras').timeBased().after(5 * 1000).create();
  }

  sendLog_(`✅ Processed ${processed} msg(s); last=${props.getProperty(LAST_SCHED_KEY)||''}`);
}


/** Short follow-up run to read shoutcaster reactions and update stores/board quickly. */
function WM_pollScExtras(){
  const props = props_();
  const raw = props.getProperty('WM_DEFERRED_SC');
  if (!raw) return;
  props.deleteProperty('WM_DEFERRED_SC');

  let items = [];
  try { items = JSON.parse(raw) || []; } catch(_) { items = []; }
  if (!items.length) return;

  const start = Date.now();
  for (const it of items){
    if (Date.now() - start > 60 * 1000) break; // keep this tiny

    const scInfo = getShoutcasterInfoForMessage_(it.channelId, it.messageId);
    if (!scInfo) continue;

    const store = loadWeekStore_(it.wk);
    const key   = matchKey_(it.division, it.t1, it.t2);
    store.shoutcasters = store.shoutcasters || {};
    store.shoutcasters[key] = scInfo.tag;
    saveWeekStore_(it.wk, store);

    const glob = loadGlobalSchedules_();
    for (const gkey in glob){
      const p = gkey.split('|');
      if (p[0]===it.division && [p[1],p[2]].sort().join('|') === [it.t1,it.t2].sort().join('|')) {
        glob[gkey].shoutcaster = scInfo.tag;
      }
    }
    saveGlobalSchedules_(glob);
  }

  const aligned = getAlignedUpcomingWeekOrReport_();
  if (aligned) upsertWeeklyDiscordMessage_(aligned);
}

/** Week-announce job: runs daily; only posts Monday before aligned date, once per week. */
function WM_dailyCheckAndPostUpcoming(){
  const aligned = getAlignedUpcomingWeekOrReport_(); if (!aligned) return;
  const weekDate = aligned.date;

  // Monday before the match date (local)
  const mondayBefore = (function(d){
    const x = new Date(d); // week date
    // move back to previous Monday
    const dow = x.getDay(); // 0=Sun..6=Sat
    const delta = (dow + 6) % 7; // days since Monday
    x.setDate(x.getDate() - delta - 6); // previous Monday
    return startOfDay_(x);
  })(weekDate);

  const todayStr  = fmtDay_(new Date());
  const mondayStr = fmtDay_(mondayBefore);
  if (todayStr !== mondayStr) { sendLog_(`ℹ️ Not announce day. Today=${todayStr}, MondayBefore=${mondayStr}`); return; }

  const wk = weekKey_(aligned);
  const p  = PropertiesService.getScriptProperties();
  if (p.getProperty(`WEEKLY_ANNOUNCED_${wk}`) === '1') {
    sendLog_(`ℹ️ Weekly announce already posted for ${wk}.`);
    return;
  }

  upsertWeeklyDiscordMessage_(aligned);
  p.setProperty(`WEEKLY_ANNOUNCED_${wk}`, '1');
  sendLog_(`📣 Weekly board announced for ${wk}.`);
}

/** Clear all schedules + shoutcasters for the aligned (current) week and refresh board. */
function clearAlignedWeekSchedules_() {
  const aligned = getAlignedUpcomingWeekOrReport_();
  if (!aligned) return { ok:false, reason:'no_aligned_week' };

  const wk = weekKey_(aligned);
  const store = loadWeekStore_(wk);
  const schedCount = store && store.schedules ? Object.keys(store.schedules).length : 0;
  const shoutCount = store && store.shoutcasters ? Object.keys(store.shoutcasters).length : 0;

  // Wipe per-week store
  store.schedules = {};
  store.shoutcasters = {};
  saveWeekStore_(wk, store);

  // Prune global entries for this map+day
  const glob = loadGlobalSchedules_();
  const dayKey = fmtDay_(aligned.date);
  const mapKey = normalizeMap_(aligned.map);
  let pruned = 0;

  for (const key of Object.keys(glob)) {
    const parts = key.split('|');
    const gMap = normalizeMap_(parts[3] || '');
    const gDay = parts[4] || '';
    if (gMap === mapKey && gDay === dayKey) { delete glob[key]; pruned++; }
  }
  saveGlobalSchedules_(glob);

  // Refresh board
  upsertWeeklyDiscordMessage_(aligned);

  const msg = `🧹 Cleared current week schedules & shoutcasters: week=${wk} (removed ${schedCount} schedules, ${shoutCount} shoutcasters; pruned ${pruned} global entries)`;
  sendLog_(msg);
  appendLogRow_('INFO','clear_current_week', msg, { weekKey: wk, schedCount, shoutCount, pruned });

  return { ok:true, week: {
    date: Utilities.formatDate(aligned.date, Session.getScriptTimeZone(), 'EEE, MMM d, yyyy'),
    map: aligned.map,
    headerWeekName: aligned.headerWeekName || ''
  }, removedSchedules: schedCount, removedShoutcasters: shoutCount, prunedGlobal: pruned };
}

// Find a PENDING match row for (teamA vs teamB) in the aligned week; fallback to previous block.
function locatePendingMatchAlignedThenHistory_(division, alignedWeek, teamA, teamB) {
  division = (typeof canonDivision_ === 'function') ? canonDivision_(division) : String(division||'');
  var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(division) : null;
  if (!sh) return { located:false, reason:'no_sheet', division:division };

  // helper to scan rows in a block top
  function scanBlock_(top) {
    try {
      var lastCol = sh.getLastColumn();
      var lastRow = sh.getLastRow();
      var start = top;
      var end = Math.min(lastRow, top + 10); // assume ~11-row blocks
      var vals = sh.getRange(start, 1, Math.max(1, end-start+1), lastCol).getDisplayValues();
      var normA = normalizeText_(teamA);
      var normB = normalizeText_(teamB);
      for (var r = 0; r < vals.length; r++) {
        var row = vals[r].join(' ').toLowerCase();
        var nrow = normalizeText_(row);
        if (nrow.indexOf(normA) !== -1 && nrow.indexOf(normB) !== -1 &&
            nrow.indexOf('pending') !== -1) {
          var rowIdx = start + r;
          return { located:true, division:division, row:rowIdx, top:top, weekObject:alignedWeek, t1:teamA, t2:teamB, from:'aligned' };
        }
      }
    } catch (e) {}
    return null;
  }

  // 1) aligned block
  var topAligned = (typeof resolveDivisionBlockTop_ === 'function') ? resolveDivisionBlockTop_(division, alignedWeek) : null;
  var found = topAligned ? scanBlock_(topAligned) : null;
  if (found) return found;

  // 2) previous block via getAllBlocks_
  try {
    if (typeof getAllBlocks_ === 'function') {
      var blocks = getAllBlocks_(sh) || [];
      // find index of aligned block by top
      var idx = -1;
      for (var i = 0; i < blocks.length; i++) {
        var t = blocks[i] && (blocks[i].top || blocks[i].startRow);
        if (t && topAligned && t === topAligned) { idx = i; break; }
      }
      if (idx > 0) {
        var prevTop = blocks[idx-1] && (blocks[idx-1].top || blocks[idx-1].startRow);
        var foundPrev = prevTop ? scanBlock_(prevTop) : null;
        if (foundPrev) { foundPrev.from = 'history'; return foundPrev; }
      }
    }
  } catch (e2) {}

  return { located:false, reason:'no_pending_match', division:division, from:'none' };
}
