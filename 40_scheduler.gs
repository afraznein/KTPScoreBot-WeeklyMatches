// =======================
// scheduler.gs – Polling and scheduling functions
// =======================
function _pollAndProcessFromId_(channelId, startId, opt) {
  opt = opt || {};
  var inclusive = !!opt.inclusive;

  var processed = 0;
  var updatedPairs = 0;
  var errors = [];
  var lastId = startId ? String(startId) : '';

  // 0) If inclusive: try to fetch/process the start message itself
  if (inclusive && startId) {
    try {
      var msg0 = _fetchSingleMessageInclusive_(channelId, String(startId)); // best-effort
      if (msg0) {
        var res0 = _processOneDiscordMessage_(msg0);
        processed++;
        if (res0 && res0.updated) updatedPairs += res0.updated;
        lastId = String(msg0.id || lastId);
      }
    } catch (e) {
      errors.push('inclusive fetch failed: ' + String(e && e.message || e));
    }
  }

  // 1) Now walk forward “after” the (possibly same) startId
  var cursor = startId || lastId || '';
  var pageLimit = 100; // how many to fetch per page (relay dependent)
  var loops = 0, SAFETY = 50; // don’t infinite-loop

  while (loops++ < SAFETY) {
    var page = [];
    try {
      // Your relay uses `after` semantics: returns messages with id > after
      page = fetchChannelMessages_(channelId, { after: cursor, limit: pageLimit }) || [];
    } catch (e) {
      errors.push('fetch page failed: ' + String(e && e.message || e));
      break;
    }
    if (!page.length) break;

    // Ensure chronological (Discord often returns newest first)
    page.sort(function(a,b){ return BigInt(a.id) < BigInt(b.id) ? -1 : 1; });

    for (var i=0; i<page.length; i++) {
      var msg = page[i];
      try {
        var res = _processOneDiscordMessage_(msg);
        processed++;
        if (res && res.updated) updatedPairs += res.updated;
        lastId = String(msg.id || lastId);
      } catch (e) {
        errors.push('process '+String(msg && msg.id)+': '+String(e && e.message || e));
      }
    }
    // advance cursor to last processed id
    cursor = lastId;
    // If fewer than pageLimit, we reached the end
    if (page.length < pageLimit) break;
  }

  // 2) Persist last pointer
  if (lastId) _setPointer_(lastId);

  return { processed:processed, updatedPairs:updatedPairs, errors:errors, lastPointer:lastId };
}