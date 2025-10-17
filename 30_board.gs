// =======================
// board.gs
// Render + upsert hybrid weekly board (embed header + plaintext tables)
// =======================

// ---- Local pads ----
function _padR_(s, w){ s=String(s||''); if (s.length>w) return s.slice(0,w); return s + ' '.repeat(w - s.length); }
function _padL_(s, w){ s=String(s||''); if (s.length>w) return s.slice(0,w); return ' '.repeat(w - s.length) + s; }
function _repeat_(ch,n){ return new Array(n+1).join(ch); }

// ---- Message IDs storage (header + table pages) ----
function _msgIdsKey_(wk) {
  // keep consistent; if you already have this, keep your version
  return 'WEEKLY_MSG_IDS_' + String(wk || '');
}

function _asStrId_(v) {
  if (!v && v !== 0) return '';
  try {
    // Handle objects from relay {id}, {message:{id}}, {data:{id}}
    if (typeof v === 'object') {
      if (v.id) return String(v.id);
      if (v.message && v.message.id) return String(v.message.id);
      if (v.data && v.data.id) return String(v.data.id);
    }
  } catch (_) {}
  return String(v);
}

function _loadMsgIds_(wk) {
  var raw = PropertiesService.getScriptProperties().getProperty(_msgIdsKey_(wk));
  var obj = null;
  if (raw) { try { obj = JSON.parse(raw); } catch (_) {} }
  if (!obj) obj = { header: '', tables: [] };

  // Back-compat
  if (!obj.tables && Array.isArray(obj.cluster)) {
    obj.header = obj.cluster[0] || '';
    obj.tables = obj.cluster.slice(1);
  }
  if (!Array.isArray(obj.tables)) obj.tables = [];

  // Normalize to strings and prune empties/dupes
  var seen = {};
  obj.header = _asStrId_(obj.header);
  obj.tables = obj.tables.map(_asStrId_).filter(function(id){
    if (!id) return false;
    if (seen[id]) return false;
    seen[id] = 1;
    return true;
  });
  return obj;
}

function _saveMsgIds_(wk, ids) {
  var header = _asStrId_(ids && ids.header);
  var uniq = {}, tables = [];
  if (ids && Array.isArray(ids.tables)) {
    for (var i = 0; i < ids.tables.length; i++) {
      var s = _asStrId_(ids.tables[i]);
      if (!s || uniq[s]) continue;
      uniq[s] = 1; tables.push(s);
    }
  }
  var obj = { header: header, tables: tables };
  obj.cluster = [header].concat(tables);
  PropertiesService.getScriptProperties().setProperty(_msgIdsKey_(wk), JSON.stringify(obj));
}

// ---- Embed header payload (always includes a fresh "Updated ..." timestamp) ----
function renderHeaderEmbedPayload_(week) {
  const dateStr = Utilities.formatDate(week.date, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');
  const map     = (week.map || '').toLowerCase();
  const weekLbl = (week.headerWeekName || '').trim();

  const fields = [
    { name: 'Map',       value: '`' + normalizeMap_(map) + '`', inline: true },
    { name: 'Date',      value: dateStr, inline: true },
    { name: 'Divisions', value: 'Bronze • Silver • Gold', inline: true }
  ];

  return {
    content: '',
    embeds: [{
      title: weekLbl ? `Weekly Matches — ${weekLbl}` : 'Weekly Matches',
      description: 'Schedule for this week. Tables are posted below.',
      color: EMBED_COLOR,
      fields,
      thumbnail: EMBED_ICON_URL ? { url: EMBED_ICON_URL } : undefined,
      image:     EMBED_BANNER_URL ? { url: EMBED_BANNER_URL } : undefined,
      footer: { text: `Updated ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, h:mm a z')}` }
    }]
  };
}

// ---- Division table (plaintext) ----
function renderDivisionTableBody_(week, store, division){
  const sh  = getDivisionSheet_(division);
  const top = resolveDivisionBlockTop_(division, week);
  const rows = sh.getRange(top,1,GRID.matchesPerBlock,GRID.cols).getValues();

  const lines = [];
  lines.push(`${division}`);
  // Away header is left-aligned per your latest request
  lines.push(_padL_('Home',18)+' vs '+_padR_('Away',18)+'   | '+_padR_('Scheduled',20)+' | '+_padR_('Shoutcaster',16));
  lines.push(_repeat_('-', 18+4+18+3+1+20+3+16));

  for (let i=0;i<rows.length;i++){
    const r = rows[i];
    const home = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
    const away = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
    if (!home || !away) continue;

    const key   = matchKey_(division, home, away);
    const sched = (store.schedules && store.schedules[key]) || 'TBD';

    let scTag = (store.shoutcasters && store.shoutcasters[key]) ? store.shoutcasters[key] : '-';
    const m = scTag && scTag.match(/^<@(\d+)>$/);
    if (m) {
      const tw = getTwitchForUser_(m[1]);
      if (tw) scTag = tw;
    }

    lines.push(_padL_(home,18)+' vs '+_padR_(away,18)+'   | '+_padR_(sched,20)+' | '+_padR_(scTag,16));
  }

  return lines.join('\n');
}

// ---- Rematches (exclude this week’s pairs) ----
function _pairInThisWeek_(week, division, t1, t2){
  const sh = getDivisionSheet_(division); if (!sh) return false;
  const top = resolveDivisionBlockTop_(division, week);
if (!top) return false;

  const vals = sh.getRange(top,1,GRID.matchesPerBlock,GRID.cols).getValues();
  const A = t1.toUpperCase(), B = t2.toUpperCase();
  for (const r of vals){
    const home = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
    const away = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
    if (!home||!away) continue;
    if ((home===A && away===B) || (home===B && away===A)) return true;
  }
  return false;
}

function buildRematchRowsFiltered_(week){
  const lines = [];
  const glob  = loadGlobalSchedules_();
  const map   = normalizeMap_((week.map||''));
  const thisWeekDay = fmtDay_((week.date));

  function isPendingRow_(division, t1, t2){
    const sh = getDivisionSheet_(division); if(!sh) return false;
    const blocks = getAllBlocks_(sh);
    for (const b of blocks){
      const vals = sh.getRange(b.top,1,GRID.matchesPerBlock,GRID.cols).getValues();
      for (const r of vals){
        const c = String(r[COL_T1_NAME-1]||'').trim().toUpperCase();
        const g = String(r[COL_T2_NAME-1]||'').trim().toUpperCase();
        if (!c||!g) continue;
        if ((c===t1 && g===t2) || (c===t2 && g===t1)) {
          if (!hasResult_(r)) return true;
        }
      }
    }
    return false;
  }

  for (const gkey in glob){
    const parts = gkey.split('|');
    const division = parts[0], HOME = parts[1], AWAY = parts[2], mapp = parts[3], srcDay = parts[4] || '';
    if (normalizeMap_(mapp) !== map) continue;       // only same map rematches
    if (srcDay === thisWeekDay) continue;            // exclude this week's rows
    if (_pairInThisWeek_(week, division, HOME, AWAY)) continue; // exclude if already in this week
    if (!isPendingRow_(division, HOME, AWAY)) continue;         // only show if still pending

    const rec = glob[gkey];
    const pretty = rec.whenText || (rec.whenIso ? Utilities.formatDate(new Date(rec.whenIso), Session.getScriptTimeZone(), 'EEE, MMM d @ h:mm a z') : 'TBD');
    const fromLabel = (rec.sourceWeekName && rec.sourceWeekName.trim()) ? rec.sourceWeekName.trim() : (rec.sourceWeekDay || '');
    const sc = rec.shoutcaster || '-';

    lines.push(_padL_(division,10)+'  '+_padL_(HOME,18)+' vs '+_padR_(AWAY,18)+'   | '+_padR_(pretty,20)+' | '+_padR_(fromLabel||'-',14)+' | '+_padR_(sc,16));
  }
  return lines;
}

function renderRematchesTableBody_(week){
  const rows = buildRematchRowsFiltered_(week);
  if (!rows.length) return 'Rematches / Make-ups\n(none yet)';
  const hdr = _padL_('Division',10)+'  '+_padL_('Home',18)+' vs '+_padR_('Away',18)+'   | '+_padR_('Scheduled',20)+' | '+_padR_('From',14)+' | '+_padR_('Shoutcaster',16);
  const line = _repeat_('-', 10+2+18+4+18+3+1+20+3+14+3+16);
  return ['Rematches / Make-ups', hdr, line].concat(rows).join('\n');
}

// ---- Build table pages (≤2000 chars per message) ----
function renderTablesPages_(week, store){
  const sections = [];
  sections.push(renderDivisionTableBody_(week, store, 'Bronze'));
  sections.push('');
  sections.push(renderDivisionTableBody_(week, store, 'Silver'));
  sections.push('');
  sections.push(renderDivisionTableBody_(week, store, 'Gold'));
  sections.push('');
  sections.push(renderRematchesTableBody_(week));

  const full = '```\n' + sections.join('\n') + '\n```';
  const MAX = 1990; // headroom for closing ```
  if (full.length <= MAX) return [full];

  const chunks = [];
  let buf = '```\n';
  for (const block of sections){
    const piece = (block ? block : '') + '\n';
    if ((buf.length + piece.length + 4) > MAX) { // +4 for closing ```
      buf += '```';
      chunks.push(buf);
      buf = '```\n' + piece;
    } else {
      buf += piece;
    }
  }
  buf += '```';
  chunks.push(buf);
  return chunks;
}

function upsertWeeklyDiscordMessage_(week, opts) {
  // ---- setup & guards ----
  if (!week) {
    if (typeof getAlignedUpcomingWeekOrReport_ === 'function') {
      week = getAlignedUpcomingWeekOrReport_();
    }
  }
  if (!week || !week.date) throw new Error('No aligned week (week.date missing)');

  var sp = PropertiesService.getScriptProperties();

  // >>> Ensure week meta is present <<<
  var wkKey = getWeekKeyFromWeek_(week);
  week.weekKey = String(wkKey);
  week.tz = week.tz || getTz_();
  if (!week.label) {
    week.label = Utilities.formatDate(week.start || week.date, week.tz, "MMM d") + "–" +
                 Utilities.formatDate(week.end   || week.date, week.tz, "MMM d");
  }
  week.tz = week.tz || (typeof getTz_ === 'function' ? getTz_() : 'America/New_York');
  if (!week.label) {
    week.label = Utilities.formatDate(week.start || week.date, week.tz, "MMM d") + "–" +
                 Utilities.formatDate(week.end   || week.date, week.tz, "MMM d");
  }

  // Build week.blocks for all divisions and lift mapRef
  var wb = buildWeekBlocksForAllDivisions_(week); // defined below
  week.blocks = wb.blocks || {};

  var store = loadWeekStore_(week.weekKey) || {};
  if (!store.meta) store.meta = {};
  store.wkKey = week.weekKey;
  store.meta.wkKey = store.meta.wkKey || week.weekKey;
  store.meta.label = store.meta.label || week.label;
  store.meta.tz = store.meta.tz || week.tz;
  if (store.meta.mapRef == null) store.meta.mapRef = wb.mapRef || ''; {
      store.meta.mapRef = (wb.mapRef || '');
  }


  // Now it’s safe to render
  var pages  = renderTablesPages_(week, store);        // array of strings
  var header = renderHeaderEmbedPayload_(week);        // { embeds: [...] }

  var pages = renderTablesPages_(week, store);        // array of strings
  var header = renderHeaderEmbedPayload_(week);       // { embeds: [...] }

  // ids structure from your persistence
  var ids = _loadMsgIds_(wkKey) || { header: null, tables: [] };
  if (!ids.tables) ids.tables = [];

  // Helper to normalize relay responses into an ID
  function idFromRelay_(resp) {
    try {
      if (!resp) return null;
      if (resp.id) return String(resp.id);
      if (resp.message && resp.message.id) return String(resp.message.id);
      if (resp.data && resp.data.id) return String(resp.data.id);
    } catch (e) {}
    return null;
  }

  // ---- hashing (ignore volatile footer in header) ----
  var headerForHash = JSON.parse(JSON.stringify(header || {}));
  try { if (headerForHash.embeds && headerForHash.embeds[0] && headerForHash.embeds[0].footer) delete headerForHash.embeds[0].footer; } catch (_){}
  var headerHash = sha256Hex_(JSON.stringify(headerForHash));
  var pagesHash  = pages.map(function (p) { return sha256Hex_(String(p || '')); });

  // prev
  var hashKey = 'WEEKLY_MSG_HASHES_' + wkKey;
  var prev = (function () { try { return JSON.parse(sp.getProperty(hashKey) || '{}'); } catch (_){ return {}; } })();
  var prevHeaderHash = prev.header || '';
  var prevPagesHash  = Array.isArray(prev.pages) ? prev.pages : [];

  // ---- DRY-RUN short-circuit ----
  var dryRunProp = String(sp.getProperty('DRY_RUN') || '').toLowerCase() === 'true';
  var dryRunArg  = opts && String(opts.dryRun).toLowerCase() === 'true';
  var DRY_RUN    = dryRunProp || dryRunArg;

  if (DRY_RUN) {
    sendLog_('🧪 DRY_RUN weekly board (no writes) — wkKey=' + wkKey);
    return {
      ok: true,
      action: 'dry_run',
      messageIds: [ids.header].concat(ids.tables || []).filter(Boolean),
      channelId: channelId,
      prevHash: { header: prevHeaderHash, pages: prevPagesHash },
      newHash:  { header: headerHash,   pages: pagesHash }
    };
  }

  // ---- quick no-op check ----
  var sameHeader = !!ids.header && prevHeaderHash === headerHash;
  var samePages  = (ids.tables.length === pagesHash.length) &&
                   pagesHash.every(function (h, i) { return prevPagesHash[i] === h; });

  if (sameHeader && samePages && !(opts && opts.force)) {
    sendLog_('↩️ Weekly board unchanged — wkKey=' + wkKey);
    return {
      ok: true,
      action: 'skipped_no_change',
      messageIds: [ids.header].concat(ids.tables || []).filter(Boolean),
      channelId: channelId,
      prevHash: { header: prevHeaderHash, pages: prevPagesHash },
      newHash:  { header: headerHash,     pages: pagesHash }
    };
  }

  // ---- apply changes ----
  var messageIds = [];
  var didCreate = false, didEdit = false, didDelete = false;

  // 1) Header
  if (!ids.header) {
    var rH = postChannelMessageAdvanced_(channelId, '', header.embeds);
    var hdrId = idFromRelay_(rH);
    ids.header = hdrId || ids.header; // keep if relay already returned id
    if (hdrId) messageIds.push(hdrId);
    didCreate = true;
  } else if (!sameHeader || (opts && opts.force)) {
    var rHe = editChannelMessageAdvanced_(channelId, ids.header, '', header.embeds);
    var hdrEditId = idFromRelay_(rHe) || ids.header;
    if (hdrEditId) messageIds.push(hdrEditId);
    didEdit = true;
  }

  // 2) Pages: edit when changed; create when missing; keep when same
  var newTableIds = [];
  for (var i = 0; i < pages.length; i++) {
    var content = pages[i];
    var hadId = !!ids.tables[i];
    var unchanged = hadId && prevPagesHash[i] && prevPagesHash[i] === pagesHash[i];

    if (unchanged && !(opts && opts.force)) {
      // keep existing
      newTableIds.push(ids.tables[i]);
      continue;
    }

    if (hadId) {
      // content changed: edit existing
      var rE = editChannelMessage_(channelId, ids.tables[i], content);
      var eid = idFromRelay_(rE) || ids.tables[i];
      newTableIds.push(eid);
      if (eid) messageIds.push(eid);
      didEdit = true;
    } else {
      // missing: create
      var rC = postChannelMessage_(channelId, content);
      var cid = idFromRelay_(rC);
      if (cid) { newTableIds.push(cid); messageIds.push(cid); }
      else { newTableIds.push(ids.tables[i] || null); }
      didCreate = true;
    }
  }

  // 3) Delete extra old pages
  for (var j = pages.length; j < ids.tables.length; j++) {
    var mid = ids.tables[j];
    if (mid) { try { deleteMessage_(channelId, mid); didDelete = true; } catch (_){ } }
  }
  ids.tables = newTableIds;

  // persist ids and hashes
  _saveMsgIds_(wkKey, ids);
  sp.setProperty(hashKey, JSON.stringify({ header: headerHash, pages: pagesHash }));

  // log summary
  var summary = [];
  if (didCreate) summary.push('created');
  if (didEdit)   summary.push('edited');
  if (didDelete) summary.push('pruned');
  if (!summary.length) summary.push('unknown');
  var action = summary.join('+');

  sendLog_('✅ Weekly board ' + action + ' — header=' + String(ids.header || '') +
           ', pages=' + String(ids.tables.length) + ', wkKey=' + wkKey);

  return {
    ok: true,
    action: action,
    messageIds: messageIds.length ? messageIds
              : [ids.header].concat(ids.tables || []).filter(Boolean),
    channelId: channelId,
    prevHash: { header: prevHeaderHash, pages: prevPagesHash },
    newHash:  { header: headerHash,     pages: pagesHash }
  };
}

// Delete the posted weekly header/tables for the aligned week and clear caches.
function deleteWeeklyCluster_() {
  var w = (typeof getAlignedUpcomingWeekOrReport_ === 'function') ? getAlignedUpcomingWeekOrReport_() : null;
  if (!w) throw new Error('deleteWeeklyCluster_: no aligned week');
  var wkKey = (typeof getWeekKeyFromWeek_ === 'function') ? getWeekKeyFromWeek_(w) : (w.weekKey || '');
  if (!wkKey) throw new Error('deleteWeeklyCluster_: no week key');

  var sp = PropertiesService.getScriptProperties();
  var ids = (typeof _loadMsgIds_ === 'function') ? (_loadMsgIds_(wkKey) || { header:'', tables:[] }) : { header:'', tables:[] };
  if (!ids.tables) ids.tables = [];

  var channelId = (typeof getWeeklyPostChannelId_ === 'function') ? getWeeklyPostChannelId_() : (sp.getProperty('WEEKLY_POST_CHANNEL_ID') || '');
  if (!channelId) throw new Error('deleteWeeklyCluster_: WEEKLY_POST_CHANNEL_ID missing');

  var deleted = { header:false, tables:0 };

  // Delete header
  if (ids.header) { try { deleteMessage_(channelId, ids.header); deleted.header = true; } catch (e) {} }

  // Delete table pages
  for (var i = 0; i < ids.tables.length; i++) {
    var mid = ids.tables[i];
    if (!mid) continue;
    try { deleteMessage_(channelId, mid); deleted.tables++; } catch (e) {}
  }

  // Clear persisted IDs/hashes
  try { sp.deleteProperty('WEEKLY_MSG_HASHES_' + wkKey); } catch (e) {}
  try { if (typeof _msgIdsKey_ === 'function') sp.deleteProperty(_msgIdsKey_(wkKey)); } catch (e) {}

  // Optional: log and return summary
  if (typeof sendLog_ === 'function') {
    sendLog_('🧹 Deleted weekly cluster wkKey=' + wkKey + ' — header=' + deleted.header + ', tables=' + deleted.tables);
  }
  return { ok:true, wkKey:wkKey, deleted:deleted };
}

function buildWeekBlocksForAllDivisions_(week) {
  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : ['Bronze','Silver','Gold'];
  var blocks = {};
  var globalMap = '';

  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var sh = (typeof getSheetByName_ === 'function') ? getSheetByName_(div) : null;
    if (!sh) continue;

    var top = resolveDivisionBlockTop_(div, week);
    var name = '';
    try { if (typeof getWeekNameAt_ === 'function') name = String(getWeekNameAt_(sh, top) || ''); } catch (_){}

    var mapRef = getMapRefAt_(sh, top) || '';
    if (!globalMap && mapRef) globalMap = mapRef;

    blocks[div] = { top: top, name: name, mapRef: mapRef };
  }
  return { blocks: blocks, mapRef: globalMap };
}

function getDivisionSheet_(divName) {
  var canon = canonDivision_(divName);
  return canon ? getSheetByName_(canon) : null;
}