// =======================
// board.gs
// Render + upsert hybrid weekly board (embed header + plaintext tables)
// =======================

// ---- Local pads ----
function _padR_(s,n){ s=String(s||''); var k=Math.max(0,n-s.length); return s+(k?Array(k+1).join(' '):''); }
function _padL_(s,n){ s=String(s||''); var k=Math.max(0,n-s.length); return (k?Array(k+1).join(' '):'')+s; }
function _truncate_(s,n){ s=String(s||''); return (s.length>n)?(s.slice(0,n-1)+'…'):s; }
function _padC_(s,n){
  s = String(s||''); var k=Math.max(0,n-s.length), L=Math.floor(k/2), R=k-L;
  return (L?Array(L+1).join(' '):'') + s + (R?Array(R+1).join(' '):'');
}

function _normTeam_(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function _splitVs_(vsCell){
  // vsCell is padded like "   HOME … vs … AWAY   "
  var m = String(vsCell||'').match(/^(.*)\s+vs\s+(.*)$/i);
  return m ? [m[1].trim(), m[2].trim()] : [vsCell.trim(), ''];
}
function _w_(){ // widths
  return (typeof _getTableWidths_==='function') ? _getTableWidths_() : { COL1:34, COL2:14, COL3:12 };
}


function _msgIdsKey_(wk) { return 'WEEKLY_MSG_IDS_' + String(wk); }

function discordEpochAt9pmFromISO_(dateISO, tz) {
  if (!dateISO) return null;
  tz = tz || (typeof getTz_==='function' ? getTz_() : 'America/New_York');
  // Apps Script `Date` uses project timezone; set that to your league TZ in Project Settings for perfect alignment.
  var p = String(dateISO).split('-');
  var y = +p[0], m = +p[1]-1, d = +p[2];
  var dt = new Date(y, m, d, 21, 0, 0, 0); // 9:00 PM local
  return Math.floor(dt.getTime() / 1000);
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

function renderHeaderEmbedPayload_(week) {
  var tz     = (week && week.tz) || (typeof getTz_==='function' ? getTz_() : 'America/New_York');
  var wkKey  = (week && week.weekKey) || '';
  var mapRef = (week && week.mapRef)  || '';
  var season = (week && week.seasonWeek) || '';
  var label  = (week && week.label) || '';

  var keyDate = (wkKey && wkKey.indexOf('|') > -1) ? wkKey.split('|')[0] : '';
  var epoch   = keyDate ? discordEpochAt9pmFromISO_(keyDate, tz) : null;

  var title = 'KTP Weekly Matches' + (season ? (' — ' + season)
               : keyDate ? (' — ' + keyDate) : '');

  var lines = [];
  if (label) lines.push('**' + label + '**');
  if (mapRef) {
    var mapLine = 'Map: `'+ mapRef +'`';
    if (epoch != null) mapLine += ' @ default: <t:'+epoch+':F> • <t:'+epoch+':R>';
    lines.push(mapLine);
  }

  return {
    embeds: [{
      title: title,
      description: lines.join('\n'),
      color: 5814783,
      // Hide wkKey here; keep a simple "Updated ..." footer for humans
      footer: { text: 'Updated ' + Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a z') }
    }]
  };
}


function _getTableWidths_() {
  if (typeof getDivisionTableWidths_ === 'function') {
    try { var W = getDivisionTableWidths_(); if (W && W.COL1 && W.COL2 && W.COL3) return W; } catch(_){}
  }
  return { COL1:34, COL2:14, COL3:12 };
}

function _formatVsCell_(home, away, col1) {
  var token=' vs ', L=Math.floor((col1-token.length)/2), R=col1-token.length-L;
  home=_truncate_(String(home||''),L); away=_truncate_(String(away||''),R);
  return _padL_(home,L)+token+_padR_(away,R);
}
function _formatVsHeader_(col1){ return _formatVsCell_('Home','Away',col1); }

// Safely call legacy division renderer (if present)
function _renderDivisionTableSafely_(division, week, store) {
  if (typeof renderDivisionTableBody_ !== 'function') return '';
  try { return renderDivisionTableBody_(division, week, store) || ''; }
  catch(_){ try { return renderDivisionTableBody_(week, store, division) || ''; } catch(e){ return ''; } }
}

/// works whether the division table used ``` fences or not
function _extractTableRows_(rendered) {
  if (!rendered) return [];
  var s = String(rendered);
  if (s.indexOf('```') >= 0) {
    var i1 = s.indexOf('```'), i2 = s.indexOf('```', i1+3);
    if (i1 >= 0 && i2 > i1) s = s.substring(i1+3, i2);
  }
  var lines = s.split(/\r?\n/);
  var hdrIdx=-1, sepIdx=-1;
  for (var i=0;i<lines.length;i++){
    if (hdrIdx<0 && /Home\s+vs\s+Away/i.test(lines[i]) && /Shoutcaster/i.test(lines[i])) hdrIdx=i;
    if (hdrIdx>=0 && /^-[-\s]+$/.test(lines[i])) { sepIdx=i; break; }
  }
  if (sepIdx < 0) return [];
  return lines.slice(sepIdx+1).filter(function(x){ return /\S/.test(x) && !/^```$/.test(x); });
}

function renderDivisionCurrentTable_(division, week, store) {
  var W = _getTableWidths_();
  var header = _formatVsHeader_(W.COL1)+' | '+_padC_('Scheduled',W.COL2)+' | '+_padC_('Shoutcaster',W.COL3);
  var sep    = Array(header.length+1).join('-');

  // Try harvesting from the renderer output
  var rendered = _renderDivisionTableSafely_(division, week, store);
  var items = _harvestDivisionRows_(rendered);

  // If nothing harvested, fallback to direct grid read
  if (!items || !items.length) {
    items = _harvestDivisionRowsFromGridBlock_(division, week);
    try { logLocal_('INFO','harvest.fallback',{ division:division, count:items.length }); } catch(_){}
  }

  if (!items || !items.length) return ''; // still nothing

  var out = [];
  out.push('```');
  out.push(division);  // plain division label inside fence
  out.push(header);
  out.push(sep);
  for (var i=0;i<items.length;i++){
    var it = items[i];
    var vs   = _formatVsCell_(it.home, it.away, W.COL1);
    var sched = it.sched ? it.sched : 'TBD';
    var cast  = it.cast  ? it.cast  : '-';
    out.push(vs+' | '+_padC_(sched,W.COL2)+' | '+_padC_(cast,W.COL3));
  }
  out.push('```');
  return out.join('\n');
}


function renderCurrentWeekTablesSplit_(week, store) {
  var divs  = (typeof getDivisionSheets_==='function') ? getDivisionSheets_() : ['Bronze','Silver','Gold'];
  var order = ['Bronze','Silver','Gold'].filter(function(d){ return divs.indexOf(d)!==-1; });
  var parts = [];
  for (var i=0;i<order.length;i++){
    var tbl = renderDivisionCurrentTable_(order[i], week, store);
    if (tbl) parts.push(tbl);
  }
  return parts;
}

function renderRematchesTableBody_(week, store, maxBack) {
  maxBack = (maxBack == null) ? 3 : parseInt(maxBack, 10);
  var detail = collectMakeupsDetailed_(week, maxBack);
  if (!detail || !detail.divisions) return '';

  var W = _getTableWidths_();
  var header = _formatVsHeader_(W.COL1) + ' | ' + _padC_('Scheduled', W.COL2) + ' | ' + _padC_('Shoutcaster', W.COL3);
  var sep    = Array(header.length + 1).join('-');

  function _divOrderIdx_(name){
    var n = String(name||'').toLowerCase();
    if (n === 'bronze') return 0;
    if (n === 'silver') return 1;
    if (n === 'gold')   return 2;
    return 99;
  }

  var byMap = {}; // map -> [{division,t1,t2}]
  var total = 0;
  detail.divisions.forEach(function(d){
    var division = d && d.division;
    if (!d || !d.previous) return;
    d.previous.forEach(function(blk){
      if (!blk || !blk.rows || !blk.rows.length) return;
      var map = (blk.map || '').trim() || '(unknown map)';
      blk.rows.forEach(function(r){
        var t1 = r && r.cols ? String(r.cols.t1 || '').trim() : '';
        var t2 = r && r.cols ? String(r.cols.t2 || '').trim() : '';
        if (!t1 || !t2) return;
        (byMap[map] = byMap[map] || []).push({ division:division, t1:t1, t2:t2 });
        total++;
      });
    });
  });
  if (!total) return '';

  var mapNames = Object.keys(byMap).sort(function(a,b){ return String(a).localeCompare(String(b)); });

  var out = [];
  out.push('**Make-ups / Rematches**');
  out.push('```');

  mapNames.forEach(function(mapName, idx){
    var items = byMap[mapName] || [];
    if (!items.length) return;

    items.sort(function(a,b){
      var da = _divOrderIdx_(a.division), db = _divOrderIdx_(b.division);
      if (da !== db) return da - db;
      var aa = (a.t1 + ' vs ' + a.t2).toLowerCase();
      var bb = (b.t1 + ' vs ' + b.t2).toLowerCase();
      return aa.localeCompare(bb);
    });

    if (idx > 0) out.push('');         // single blank line between map sections
    out.push(mapName);                  // no brackets
    out.push(header);
    out.push(sep);

    for (var i=0;i<items.length;i++){
      var it   = items[i];
      var vs   = _formatVsCell_(it.t1, it.t2, W.COL1);
      var sched = 'TBD';
      var cast  = '-';
      out.push(vs + ' | ' + _padC_(sched, W.COL2) + ' | ' + _padC_(cast, W.COL3));
    }
  });

  out.push('```');
  return out.join('\n');
}


function findUnscoredRowsInBlock_(sheet, top) {
  var out = [];
  try {
    var lastCol = sheet.getLastColumn();
    var end = Math.min(sheet.getLastRow(), top + 10); // ~11 rows per block
    var vals = sheet.getRange(top, 1, Math.max(1, end - top + 1), Math.min(12, lastCol)).getDisplayValues();
    for (var r=0; r<vals.length; r++) {
      var rowTxt = (vals[r]||[]).join(' ').trim();
      if (!rowTxt) continue;
      var low = rowTxt.toLowerCase();
      var looksMatch = /\bvs\b| v\. | v /i.test(rowTxt);
      var hasScore   = /\b\d{1,2}\s*[-:]\s*\d{1,2}\b/.test(low);
      var hasResult  = /\b(win|loss|defeats|defeated)\b/.test(low) || hasScore;
      var saysPending= /\bpending\b|\btbd\b|\bmake[\- ]?up\b/.test(low);
      if ((looksMatch && !hasResult) || saysPending) {
        out.push(rowTxt);
      }
    }
  } catch (_){}
  return out;
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

function renderTablesPages_(week, store) {
  var pieces = [];
  var currentParts = renderCurrentWeekTablesSplit_(week, store);
  if (currentParts && currentParts.length) pieces = pieces.concat(currentParts);

  var lookback = parseInt(PropertiesService.getScriptProperties().getProperty('MAKEUPS_LOOKBACK_BLOCKS') || '3', 10);
  var rem = renderRematchesTableBody_(week, store, lookback);
  if (rem) pieces.push(rem);

  var msg = pieces.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!msg) msg = '**No matches found for this week.**';
  try {
  logLocal_('INFO','tables.rendered.v2',{
    wkKey:String(week && week.weekKey || ''),
    bronze: !!(currentParts[0]),
    silver: !!(currentParts[1]),
    gold:   !!(currentParts[2])
  });
} catch(_){}
  return [msg]; // exactly one tables message
}

function upsertWeeklyDiscordMessage_(week, opts) {
  if (!week && typeof getAlignedUpcomingWeekOrReport_ === 'function') week = getAlignedUpcomingWeekOrReport_();
  if (!week) throw new Error('upsertWeeklyDiscordMessage_: no week object');

  // tz / label
  week.tz    = week.tz || (typeof getTz_ === 'function' ? getTz_() : 'America/New_York');
  week.label = week.label || (typeof getWeekLabel_ === 'function' ? getWeekLabel_(week) : '');

  // Build blocks per division (so resolveDivisionBlockTop_ knows what to pick)
  if (typeof buildWeekBlocksForAllDivisions_ === 'function') {
    var wb = buildWeekBlocksForAllDivisions_(week) || {};
    week.blocks = wb.blocks || {};
  } else {
    week.blocks = week.blocks || {};
  }

  // --- GRID-BASED wkKey + map (YYYY-MM-DD|map) ---
  var gridMeta = (typeof chooseWeekMetaAcrossDivisions_ === 'function') ? chooseWeekMetaAcrossDivisions_(week) : { dateISO:'', map:'' };
  week.weekKey = (gridMeta.dateISO || '') + '|' + (gridMeta.map || '');
  week.mapRef  = gridMeta.map || week.mapRef || '';
  week.seasonWeek = gridMeta.seasonWeek || week.seasonWeek || '';
  if (!week.label) {
    week.label = week.seasonWeek || gridMeta.dateISO || (typeof getWeekLabel_==='function' ? getWeekLabel_(week) : '');
  }


  // load store + mirror map into store.meta
  var sp    = PropertiesService.getScriptProperties();
  var store = (typeof loadWeekStore_ === 'function') ? (loadWeekStore_(String(week.weekKey)) || {}) : {};
  if (!store.meta) store.meta = {};
  store.meta.mapRef = (store.meta.mapRef != null) ? store.meta.mapRef : (week.mapRef || '');

  // render header + main tables
  var header = (typeof renderHeaderEmbedPayload_ === 'function') ? renderHeaderEmbedPayload_(week) : { embeds: [] };
  var pages  = (typeof renderTablesPages_ === 'function') ? renderTablesPages_(week, store) : [];

  try {
  logLocal_('INFO','tables.rendered',{
    wkKey:String(week.weekKey||''),
    pageCount: (pages||[]).length,
    hasAll: /\*\*This Week — All Matches\*\*/.test(pages[0]||''),
    hasRem: /\*\*Make-ups \/ Rematches\*\*/.test(pages[0]||''),
    chars: (pages[0]||'').length
  });
} catch(_){}


  // ids + hashes
  var wkKey = String(week.weekKey);
  var ids = (typeof _loadMsgIds_ === 'function') ? (_loadMsgIds_(wkKey) || { header:'', tables:[] }) : { header:'', tables:[] };
  if (!Array.isArray(ids.tables)) ids.tables = [];

  var headerForHash = JSON.parse(JSON.stringify(header || {}));
  try {
    if (headerForHash.embeds && headerForHash.embeds[0]) {
      delete headerForHash.embeds[0].footer;
      delete headerForHash.embeds[0].timestamp;
    }
  } catch(_){}
  var headerHash = (typeof sha256Hex_ === 'function') ? sha256Hex_(JSON.stringify(headerForHash)) : JSON.stringify(headerForHash);
  var pagesHash  = pages.map(function(p){ var s = String(p||''); return (typeof sha256Hex_==='function') ? sha256Hex_(s) : s; });

  var hashKey = 'WEEKLY_MSG_HASHES_' + wkKey;
  var prev    = (function(){ try { return JSON.parse(sp.getProperty(hashKey) || '{}'); } catch(_){ return {}; } })();
  var prevHeaderHash = prev.header || '';
  var prevPagesHash  = Array.isArray(prev.pages) ? prev.pages : [];

  // dry run?
  var DRY_RUN = (String(sp.getProperty('DRY_RUN')||'').toLowerCase()==='true') ||
                (opts && String(opts.dryRun||'').toLowerCase()==='true');

  var channelId = (typeof getWeeklyPostChannelId_==='function') ? getWeeklyPostChannelId_() : (sp.getProperty('WEEKLY_POST_CHANNEL_ID')||'');
  if (!channelId) throw new Error('upsertWeeklyDiscordMessage_: WEEKLY_POST_CHANNEL_ID missing');

  if (DRY_RUN) {
    if (typeof sendLog_==='function') sendLog_('🧪 DRY_RUN — wkKey=' + wkKey);
    return { ok:true, action:'dry_run', messageIds: [ids.header].concat(ids.tables||[]).filter(Boolean),
             channelId: channelId, prevHash:{header:prevHeaderHash,pages:prevPagesHash}, newHash:{header:headerHash,pages:pagesHash} };
  }

  var sameHeader = !!ids.header && (prevHeaderHash === headerHash);
  var samePages  = (ids.tables.length === pagesHash.length) && pagesHash.every(function(h,i){ return prevPagesHash[i] === h; });

  if (sameHeader && samePages && !(opts && opts.force)) {
    if (typeof sendLog_==='function') sendLog_('↩️ No changes — wkKey='+wkKey);
    return { ok:true, action:'skipped_no_change',
             messageIds:[ids.header].concat(ids.tables||[]).filter(Boolean),
             channelId:channelId,
             prevHash:{header:prevHeaderHash,pages:prevPagesHash},
             newHash:{header:headerHash,pages:pagesHash} };
  }

  // relay helpers
  function idFromRelayLocal_(resp) {
    try {
      if (!resp) return null;
      if (resp.id) return String(resp.id);
      if (resp.message && resp.message.id) return String(resp.message.id);
      if (resp.data && resp.data.id) return String(resp.data.id);
    } catch(_){}
    return null;
  }
  var idFromRelayFn = (typeof idFromRelay_ === 'function') ? idFromRelay_ : idFromRelayLocal_;

  var messageIds = [];
  var didCreate=false, didEdit=false, didDelete=false;

  if (ids.header) { // After you’ve ensured ids.header exists…
    try {
      // Always refresh footer/timestamp visually (hash ignores footer so force-touch is safe)
      if (typeof editChannelMessageAdvanced_==='function') {
        editChannelMessageAdvanced_(WEEKLY_POST_CHANNEL_ID, ids.header, '', header.embeds);
      }
    } catch(_){}
  }
  // header
  if (!ids.header) {
    var rH = postChannelMessageAdvanced_(channelId, '', header.embeds);
    var hdrId = idFromRelayFn(rH);
    if (hdrId) { ids.header = hdrId; messageIds.push(hdrId); }
    didCreate = true;
  } else if (!sameHeader || (opts && opts.force)) {
    var rHe = editChannelMessageAdvanced_(channelId, ids.header, '', header.embeds);
    var hdrEditId = idFromRelayFn(rHe) || ids.header;
    if (hdrEditId) messageIds.push(hdrEditId);
    didEdit = true;
  }

  // pages
  var newTableIds = [];
  for (var i=0; i<pages.length; i++) {
    var content = pages[i];
    var hadId   = !!ids.tables[i];
    var unchanged = hadId && prevPagesHash[i] && (prevPagesHash[i] === pagesHash[i]);
    if (unchanged && !(opts && opts.force)) {
      newTableIds.push(ids.tables[i]);
      continue;
    }
    if (hadId) {
      var rE = editChannelMessage_(channelId, ids.tables[i], content);
      var eid = idFromRelayFn(rE) || ids.tables[i];
      newTableIds.push(eid);
      if (eid) messageIds.push(eid);
      didEdit = true;
    } else {
      var rC = postChannelMessage_(channelId, content);
      var cid = idFromRelayFn(rC);
      if (cid) { newTableIds.push(cid); messageIds.push(cid); }
      else { newTableIds.push(ids.tables[i] || null); }
      didCreate = true;
    }
  }

  // delete extra pages
  for (var j = pages.length; j < ids.tables.length; j++) {
    var mid = ids.tables[j];
    if (mid) { try { deleteMessage_(channelId, mid); didDelete = true; } catch(_){ } }
  }
  ids.tables = newTableIds;

  if (typeof _saveMsgIds_ === 'function') _saveMsgIds_(wkKey, ids);
  sp.setProperty(hashKey, JSON.stringify({ header: headerHash, pages: pagesHash }));

  try {
    PropertiesService.getScriptProperties().setProperty('LAST_POSTED_CLUSTER',
      JSON.stringify({
        wkKey: String(week.weekKey || ''),
        channelId: String(channelId || ''),
        ids: { header: ids.header || '', tables: ids.tables || [] },
        when: (new Date()).toISOString()
      })
    );
  } catch(_) {}



  var actionBits=[]; if(didCreate) actionBits.push('created'); if(didEdit) actionBits.push('edited'); if(didDelete) actionBits.push('pruned');
  var action = actionBits.length ? actionBits.join('+') : 'unknown';

  if (typeof sendLog_==='function') sendLog_('✅ Weekly board ' + action + ' — header=' + String(ids.header||'') +
    ', pages=' + String(ids.tables.length) + ', wkKey=' + wkKey + ', map=' + (week.mapRef || store.meta.mapRef || ''));

    // --- Compose & emit human notice (SAFE even if created/edited are not defined) ---

  // Safely read arrays if present; otherwise default empty
  var _created = (typeof created !== 'undefined' && Array.isArray(created)) ? created : [];
  var _edited  = (typeof edited  !== 'undefined' && Array.isArray(edited )) ? edited  : [];
  var _deleted = (typeof deleted !== 'undefined' && Array.isArray(deleted)) ? deleted : [];

  var createdCount = _created.length;
  var editedCount  = _edited.length;
  var deletedCount = _deleted.length;

  // Prefer explicit action, otherwise infer from counts
  var actionWord = (function(){
    if (createdCount && editedCount) return 'Posted/Edited';
    if (createdCount)               return 'Posted';
    if (editedCount)                return 'Edited';
    if (typeof action === 'string' && action === 'skipped_no_change') return 'Up-to-date';
    return 'Posted/Edited'; // conservative default
  })();

  // Build and send the notice
  var notice = formatWeeklyNotice_(week, actionWord);
  try { sendLog_(notice); } catch (_){}

  try {
    logLocal_('INFO','weekly.board.notice', {
      text: notice,
      wkKey: String(wkKey || ''),
      headerId: (ids && ids.header) ? String(ids.header) : null,
      tableId:  (ids && ids.tables && ids.tables[0]) ? String(ids.tables[0]) : null,
      action: actionWord,
      counts: { created: createdCount, edited: editedCount, deleted: deletedCount }
    });
  } catch (_){}

  // --- Return a rich result payload for the panel ---
  return {
    ok: true,
    action: (typeof action === 'string' ? action : actionWord),
    wkKey: String(wkKey || ''),
    channelId: String(channelId || ''),
    ids: {
      header: (ids && ids.header) ? String(ids.header) : '',
      table:  (ids && ids.tables && ids.tables[0]) ? String(ids.tables[0]) : ''
    },
    created: _created,
    edited:  _edited,
    deleted: _deleted
  };
}

// 1A) Harvest from a rendered table string (flexible matcher)
function _harvestDivisionRows_(rendered) {
  if (!rendered) return [];
  var s = String(rendered);
  if (s.indexOf('```') >= 0) {
    var i1 = s.indexOf('```'), i2 = s.indexOf('```', i1+3);
    if (i1 >= 0 && i2 > i1) s = s.substring(i1+3, i2);
  }
  var lines = s.split(/\r?\n/), rows = [];
  for (var i=0;i<lines.length;i++) {
    var raw = lines[i];
    if (!/\S/.test(raw)) continue;
    var line = raw.replace(/\s+$/,'');
    if (/^[-\s]{5,}$/.test(line)) continue;                // dashed separator
    if (/Home\s+vs\s+Away/i.test(line)) continue;          // header
    if (/^\s*[A-Za-z]+$/.test(line)) continue;             // single word like "Bronze"
    if (!/\bvs\b/i.test(line)) continue;                   // must contain " vs "
    var vsPart, sched='', cast='';
    if (line.indexOf('|') >= 0) {
      var parts = line.split('|');
      vsPart = (parts[0]||'').trim();
      if (parts.length>1) sched = String(parts[1]).trim();
      if (parts.length>2) cast  = String(parts[2]).trim();
    } else {
      vsPart = line.trim();
    }
    var m = vsPart.match(/^(.*)\s+vs\s+(.*)$/i);
    if (!m) continue;
    var home = m[1].trim(), away = m[2].trim();
    rows.push({ home:home, away:away, sched:sched, cast:cast });
  }
  return rows;
}

// 1B) Harvest directly from the grid block (fallback if renderer returns 0 rows)
function _harvestDivisionRowsFromGridBlock_(division, week) {
  try {
    var sh   = (typeof getDivisionSheet_==='function') ? getDivisionSheet_(division) : null;
    if (!sh) return [];
    var top  = (typeof resolveDivisionBlockTop_==='function') ? resolveDivisionBlockTop_(division, week) : null;
    if (!top) return [];

    var sp = PropertiesService.getScriptProperties();
    var stride = parseInt(sp.getProperty('GRID_BLOCK_STRIDE') || '11', 10);

    // Determine a safe column span (use known COL_* constants if present; else 8)
    var lastCol = 8;
    try {
      var cands = [COL_T1_NAME, COL_T2_NAME, COL_T1_SCORE, COL_T2_SCORE, COL_T1_RESULT, COL_T2_RESULT];
      for (var i=0;i<cands.length;i++) if (typeof cands[i] === 'number') lastCol = Math.max(lastCol, cands[i]);
    } catch(_){}

    var vals = sh.getRange(top, 1, Math.max(6, stride), lastCol).getValues(); // read ~one block
    var out = [];
    for (var r=0;r<vals.length;r++) {
      var row = vals[r];

      var t1 = String(row[(typeof COL_T1_NAME==='number'?COL_T1_NAME:3)-1] || '').trim();
      var t2 = String(row[(typeof COL_T2_NAME==='number'?COL_T2_NAME:7)-1] || '').trim();

      if (!t1 && !t2) continue;           // empty row
      if (!t1 || !t2) continue;           // need a pair
      if (t1 === 'BYE' || t2 === 'BYE') continue; // skip BYE

      // If the results & scores exist, skip completed rows (we want scheduled/pending)
      var wl1 = String(row[(typeof COL_T1_RESULT==='number'?COL_T1_RESULT:2)-1] || '').trim();
      var wl2 = String(row[(typeof COL_T2_RESULT==='number'?COL_T2_RESULT:6)-1] || '').trim();
      var s1  = String(row[(typeof COL_T1_SCORE ==='number'?COL_T1_SCORE :4)-1] || '').trim();
      var s2  = String(row[(typeof COL_T2_SCORE ==='number'?COL_T2_SCORE :8)-1] || '').trim();
      var pending = (!wl1 && !wl2 && !s1 && !s2);

      // For current-week table we list the matches regardless; if you only want pending, gate on pending
      out.push({ home:t1, away:t2, sched:'TBD', cast:'-' });
    }
    return out;
  } catch (e) {
    try { logLocal_('WARN','harvest.grid.error',{ division:division, err:String(e&&e.message||e) }); } catch(_){}
    return [];
  }
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

// End-of-block row (exclusive) = next block's top, else sheet.lastRow+1.
// We read A..maxCol across [top, end).
function findUnscoredRowsInBlockDetailed_(sheet, top) {
  var out = [];
  if (!sheet || !top) return out;

  var blocks = [];
  try { if (typeof getAllBlocks_ === 'function') blocks = getAllBlocks_(sheet) || []; } catch(_){}
  var nextTop = null;
  if (blocks && blocks.length) {
    for (var i=0; i<blocks.length; i++) {
      var t = blocks[i] && (blocks[i].top || blocks[i].startRow);
      if (t === top && blocks[i+1]) {
        nextTop = blocks[i+1].top || blocks[i+1].startRow || null;
        break;
      }
    }
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var start = top;
  var end   = nextTop ? nextTop-1 : lastRow;
  if (end < start) return out;

  var maxCol = Math.max(8, lastCol);
  var rng = sheet.getRange(start, 1, end - start + 1, maxCol);
  var vals = rng.getDisplayValues();

  var C = getGridCols_(); // {WL1,T1,S1,WL2,T2,S2}

  for (var r = 0; r < vals.length; r++) {
    var rowIdx = start + r;
    var row = vals[r];

    var t1 = String(row[C.T1-1] || '').trim();
    var t2 = String(row[C.T2-1] || '').trim();

    // 🚫 Skip BYE rows (either side is exactly "BYE", case-insensitive)
    var isBye = function(s){ return /^\s*bye\s*$/i.test(s); };
    if (!t1 || !t2 || isBye(t1) || isBye(t2)) continue;

    var wl1 = row[C.WL1-1], wl2 = row[C.WL2-1];
    var s1  = row[C.S1-1],  s2  = row[C.S2-1];

    // Looks like a populated matchup row
    var isMatchRow = true; // t1/t2 already non-empty & non-BYE
    var noWL    = !String(wl1||'').trim() && !String(wl2||'').trim();
    var hasNum  = function(v){ return /\d/.test(String(v||'')); };
    var noScore = !hasNum(s1) && !hasNum(s2);

    if (isMatchRow && noWL && noScore) {
      var summary = t1 + ' vs ' + t2;
      out.push({ row: rowIdx, text: summary, cols: { t1:t1, t2:t2, wl1:wl1, wl2:wl2, s1:s1, s2:s2 } });
    }
  }
  return out;
}



/** Detailed collector across divisions, scanning previous blocks up to maxBack. */
function collectMakeupsDetailed_(week, maxBack) {
  maxBack = (maxBack == null) ? 3 : parseInt(maxBack,10);
  var result = { maxBack: maxBack, divisions: [] };
  var tz = (typeof getTz_ === 'function') ? getTz_() : 'America/New_York';
  var todayMid = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00' + Utilities.formatDate(new Date(), tz, 'XXX'));

  var divs = (typeof getDivisionSheets_ === 'function') ? getDivisionSheets_() : [];
  for (var i = 0; i < divs.length; i++) {
    var div = divs[i];
    var sh  = (typeof getSheetByName_ === 'function') ? getSheetByName_(div) : null;
    if (!sh) { result.divisions.push({ division:div, error:'no_sheet' }); continue; }

    var alignedTop = (typeof resolveDivisionBlockTop_ === 'function') ? resolveDivisionBlockTop_(div, week) : null;

    // Blocks
    var blocks = [];
    try { if (typeof getAllBlocks_ === 'function') blocks = getAllBlocks_(sh) || []; } catch(_){}
    if (!blocks.length) { result.divisions.push({ division: div, error: 'no_blocks' }); continue; }

    // Find aligned index (use nearest lower if exact not found)
    var aIdx = -1;
    for (var b = 0; b < blocks.length; b++) {
      var t = blocks[b] && (blocks[b].top || blocks[b].startRow);
      if (t === alignedTop) { aIdx = b; break; }
      if (t && alignedTop && alignedTop >= t) aIdx = b;
    }
    if (aIdx < 0) aIdx = 0;

    var prev = [];
    // Walk up to maxBack previous blocks ONLY
    for (var k = 1; k <= maxBack; k++) {
      var idx = aIdx - k;
      if (idx < 0) break;
      var top = blocks[idx] && (blocks[idx].top || blocks[idx].startRow);
      if (!top) continue;

      // Pull block's date/map from A-column grid meta
      var meta = (typeof getWeekMetaAt_ === 'function') ? getWeekMetaAt_(sh, top) : { dateISO:'', map:'' };
      var overdue = false;
      if (meta && meta.date) {
        var d0 = new Date(meta.date.getFullYear(), meta.date.getMonth(), meta.date.getDate()); // midnight
        overdue = d0.getTime() < todayMid.getTime();
      } else if (meta && meta.dateISO) {
        var p = meta.dateISO.split('-'); // crude parse
        var d1 = new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
        overdue = d1.getTime() < todayMid.getTime();
      } else {
        // If no date is found, skip (we don't want to over-flag)
        overdue = false;
      }
      if (!overdue) continue; // Only consider past-due blocks

      var unscored = findUnscoredRowsInBlockDetailed_(sh, top);
      prev.push({
        idx: idx,
        top: top,
        dateISO: meta.dateISO || null,
        map: meta.map || null,
        count: unscored.length,
        rows: unscored
      });
    }

    result.divisions.push({
      division: div,
      alignedTop: alignedTop || null,
      previous: prev
    });
  }
  return result;
}


/** Build a pretty page (string) from collectMakeupsDetailed_ output, for preview/posts. */
function makeupsPageFromDetailed_(detail) {
  if (!detail || !detail.divisions) return '';
  var lines = ['**Make-ups / Rematches**'];
  var any = false;

  for (var i = 0; i < detail.divisions.length; i++) {
    var d = detail.divisions[i];
    if (!d || !d.previous) continue;

    var addedHeader = false;
    for (var j = 0; j < d.previous.length; j++) {
      var blk = d.previous[j];
      if (!blk || !blk.rows || !blk.rows.length) continue;

      if (!addedHeader) {
        lines.push('');
        lines.push('__' + d.division + '__');
        addedHeader = true;
      }
      var when = blk.dateISO ? ' (' + blk.dateISO + ')' : '';
      var map  = blk.map     ? ' [' + blk.map + ']' : '';

      for (var r = 0; r < blk.rows.length; r++) {
        var item = blk.rows[r];
        lines.push('• ' + item.text + ' — r' + item.row + when + map);
        any = true;
      }
    }
  }

  if (!any) lines.push('_None detected in the last ' + (detail.maxBack || 3) + ' block(s)._');
  return lines.join('\n');
}

// --- helpers (only add if you don't already have them) ---
function _padRight_(s, n){ s = String(s||''); var k = Math.max(0, n - s.length); return s + (k ? Array(k+1).join(' ') : ''); }
function _truncate_(s, n){ s = String(s||''); return (s.length > n) ? (s.slice(0, n-1) + '…') : s; }
function _divOrderIdx_(name){
  // Bronze → Silver → Gold ordering; unknowns at bottom
  var n = String(name||'').toLowerCase();
  if (n === 'bronze') return 0;
  if (n === 'silver') return 1;
  if (n === 'gold')   return 2;
  return 99;
}

/** Build a pretty table page grouped by MAP, rows ordered Bronze → Silver → Gold.
 *  Uses collectMakeupsDetailed_(week, maxBack) output (which already excludes BYE rows).
 *  Returns '' if nothing to render.
 */
function renderMakeupsPrettyPage_(week, maxBack){
  maxBack = (maxBack == null) ? 3 : parseInt(maxBack,10);
  var detail = collectMakeupsDetailed_(week, maxBack);
  if (!detail || !detail.divisions) return '';

  // Normalize into flat items and group by map
  var byMap = {}; // mapName -> [{division, t1, t2, dateISO}]
  detail.divisions.forEach(function(d){
    var division = d && d.division;
    if (!d || !d.previous) return;
    d.previous.forEach(function(blk){
      if (!blk || !blk.rows || !blk.rows.length) return;
      var map = (blk.map || '').trim();
      var dateISO = blk.dateISO || '';
      if (!map) return; // need a map to group
      blk.rows.forEach(function(r){
        var t1 = (r.cols && r.cols.t1) || '';
        var t2 = (r.cols && r.cols.t2) || '';
        if (!t1 || !t2) return;
        (byMap[map] = byMap[map] || []).push({
          division: division,
          t1: String(t1).trim(),
          t2: String(t2).trim(),
          dateISO: dateISO
        });
      });
    });
  });

  var mapNames = Object.keys(byMap);
  if (!mapNames.length) return '';

  // Order maps alphabetically (or change here to another order if desired)
  mapNames.sort(function(a,b){ return String(a).localeCompare(String(b)); });

  // Column widths (match your normal grid look)
  var COL1 = 34; // "Home vs Away"
  var COL2 = 14; // "Scheduled"
  var COL3 = 12; // "Shoutcaster"

  // Header row + separator
  var header = _padRight_('Home vs Away', COL1) + ' | ' +
               _padRight_('Scheduled',   COL2) + ' | ' +
               _padRight_('Shoutcaster', COL3);
  var sep = Array(header.length+1).join('-');

  var out = [];
  out.push('**Make-ups / Rematches (by map)**');

  mapNames.forEach(function(mapName, idx){
    var items = byMap[mapName] || [];
    if (!items.length) return;

    // Order rows: Bronze → Silver → Gold; keep original order inside same division
    items.sort(function(a,b){
      var da = _divOrderIdx_(a.division);
      var db = _divOrderIdx_(b.division);
      if (da !== db) return da - db;
      // Secondary: alphabetical by team names for stability
      var aa = (a.t1 + ' vs ' + a.t2).toLowerCase();
      var bb = (b.t1 + ' vs ' + b.t2).toLowerCase();
      return aa.localeCompare(bb);
    });

    // Section heading per map (outside of code fence so the table matches your other grids)
    out.push('');
    out.push('__' + mapName + '__');
    out.push('```'); // code fence for aligning columns

    out.push(header);
    out.push(sep);

    items.forEach(function(it){
      var vs   = _truncate_(it.t1 + ' vs ' + it.t2, COL1);
      var date = it.dateISO || 'TBD';
      var cast = ''; // unknown; left blank
      var line = _padRight_(vs,   COL1) + ' | ' +
                 _padRight_(date, COL2) + ' | ' +
                 _padRight_(cast, COL3);
      out.push(line);
    });

    out.push('```');
  });

  return out.join('\n');
}

function getSeasonInfo_() {
  var ss = ss_();
  var sh = ss.getSheetByName('KTP Info');
  if (!sh) return '';
  var v = sh.getRange('A1').getDisplayValue();
  return String(v || '').trim();
}

var KTP_EMOJI_ID = '1002382703020212245'; // <:ktp:ID>
function ktpEmoji_() { return '<:ktp:' + KTP_EMOJI_ID + '>'; }

function formatWeeklyNotice_(week, actionWord) {
  var tz     = (week && week.tz) || (typeof getTz_==='function' ? getTz_() : 'America/New_York');
  var season = (week && week.seasonWeek) || '';
  var mapRef = (week && week.mapRef) || '';
  var seasonInfo = (typeof getSeasonInfo_==='function' ? getSeasonInfo_() : '');
  var ts = Utilities.formatDate(new Date(), tz, 'MMM d, h:mm a z');

  // :white_check_mark: <KTP_SEASON_INFO> <season> <mapRef> Weekly Boards <Posted/Edited>. <timestamp> <:ktp:...>
  return ':white_check_mark: ' +
         [seasonInfo, season, mapRef].filter(Boolean).join(' ') +
         ' Weekly Boards ' + (actionWord || 'Posted/Edited') + '. ' +
         ts + ' ' + ktpEmoji_();
}

// pairs: [{division, home, away, whenIso (optional), shoutcasterUserId (optional)}]
function updateTablesMessageFromPairs_(wkKey, pairs) {
  var sp = PropertiesService.getScriptProperties();
  var channelId = sp.getProperty('WEEKLY_POST_CHANNEL_ID');
  if (!wkKey) throw new Error('wkKey required');
  var ids = _loadMsgIds_(wkKey);
  var tableMsgId = ids && ids.tables && ids.tables[0];
  if (!tableMsgId) throw new Error('No tables message id for '+wkKey);

  var rel = fetchMessageById_(channelId, tableMsgId);
  var text = contentFromRelay_(rel);
  if (!text) throw new Error('Could not load current tables message');

  var W = _w_();
  var lines = text.split(/\r?\n/);

  // build index of rows -> {i, homeN, awayN}
  var rowIdx = {};
  for (var i=0;i<lines.length;i++){
    var ln = lines[i];
    if (!/\|/.test(ln)) continue;
    var parts = ln.split('|');
    if (!/vs/i.test(parts[0])) continue;
    var ab = _splitVs_(parts[0]);
    var key = _normTeam_(ab[0])+'|'+_normTeam_(ab[1]);
    rowIdx[key] = i;
  }

  // optional default shoutcaster(s) from reactions
  var scEmoji = sp.getProperty('SHOUTCASTER_EMOJI') || 'Shoutcaster';
  var reactors = [];
  try {
    var users = listReactions_(channelId, tableMsgId, scEmoji) || [];
    // expect array of {id, username} etc; adjust if your relay shape differs
    for (var u=0; u<users.length; u++){
      var uid = String(users[u].id || '');
      var un  = String(users[u].username || users[u].global_name || users[u].tag || uid);
      var url = getTwitchForUser_(uid);
      reactors.push({ userId: uid, username: un, twitch: url });
      if (!url) {
        try {
          // politely DM once to request their twitch link
          var msg = "Hey " + un + "! Please reply with your Twitch URL so I can attach it to the weekly board (e.g., https://twitch.tv/yourname).";
          if (typeof postDM_==='function') postDM_(uid, msg);
          setTwitchForUser_(uid, un, ''); // remember we asked
        } catch(_){}
      }
    }
  } catch(e) {
    try { logLocal_('WARN','shoutcaster.reactions.error',{err:String(e&&e.message||e)}); } catch(_){}
  }

  function findCasterUrl_(pair) {
    // 1) explicit shoutcasterUserId on the pair
    if (pair.shoutcasterUserId) {
      var url = getTwitchForUser_(pair.shoutcasterUserId);
      if (url) return url;
    }
    // 2) any reactor with a twitch url (default caster)
    for (var r=0;r<reactors.length;r++) {
      if (reactors[r].twitch) return reactors[r].twitch;
    }
    return ''; // unknown yet
  }

  var changed = 0;
  for (var p=0;p<pairs.length;p++){
    var pair = pairs[p];
    var key  = _normTeam_(pair.home)+'|'+_normTeam_(pair.away);
    var idx  = rowIdx[key];
    if (typeof idx === 'undefined') {
      // try swapped order
      key = _normTeam_(pair.away)+'|'+_normTeam_(pair.home);
      idx = rowIdx[key];
    }
    if (typeof idx === 'undefined') {
      try { logLocal_('INFO','update.row.not_found',{ pair:pair }); } catch(_){}
      continue;
    }

    var parts = lines[idx].split('|');
    if (parts.length < 3) continue;

    var whenTxt = '';
    if (pair.whenIso) {
      var tz = (typeof getTz_==='function') ? getTz_() : 'America/New_York';
      var d = new Date(pair.whenIso);
      whenTxt = Utilities.formatDate(d, tz, 'M/d h:mm a z');
    } else {
      whenTxt = 'TBD';
    }

    var casterUrl = findCasterUrl_(pair);
    var casterTxt = casterUrl ? casterUrl.replace(/^https?:\/\//,'') : '-';

    // rewrite col2/col3 with centered text
    parts[1] = ' ' + _padC_(whenTxt, W.COL2) + ' ';
    parts[2] = ' ' + _padC_(casterTxt, W.COL3);
    var newLine = parts[0] + '|' + parts[1] + '|' + parts[2];

    if (newLine !== lines[idx]) {
      lines[idx] = newLine;
      changed++;
    }
  }

  if (!changed) return { ok:true, edited:false, msgId: tableMsgId };

  var newText = lines.join('\n');
  // Edit the same message (no new posts)
  if (typeof editChannelMessage_==='function') {
    editChannelMessage_(channelId, tableMsgId, newText);
  } else if (typeof editChannelMessageAdvanced_==='function') {
    // advanced version requires content param
    editChannelMessageAdvanced_(channelId, tableMsgId, newText, null);
  }

  try { logLocal_('INFO','tables.updated', { wkKey:wkKey, rowsChanged:changed }); } catch(_){}
  return { ok:true, edited:true, rowsChanged:changed, msgId: tableMsgId };
}

function _normTeam_(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function _splitVs_(vsCell){
  var m = String(vsCell||'').match(/^(.*)\s+vs\s+(.*)$/i);
  return m ? [m[1].trim(), m[2].trim()] : [vsCell.trim(), ''];
}
function _w_(){
  return (typeof _getTableWidths_==='function') ? _getTableWidths_() : { COL1:34, COL2:14, COL3:12 };
}
function _padC_(s,n){
  s = String(s||''); var k=Math.max(0,n-s.length), L=Math.floor(k/2), R=k-L;
  return (L?Array(L+1).join(' '):'') + s + (R?Array(R+1).join(' '):'');
}

/**
 * Edits the existing weekly tables message in place, changing only the Shoutcaster cell
 * for the row matching (map, home, away).
 *
 * If map equals the current week mapRef, we allow match rows in the three current-week tables.
 * Otherwise, we only accept rows inside the rematches section under that map.
 */
function updateRowCasterInTablesMessage_(wkKey, mapName, home, away, twitchUrl) {
  var sp = PropertiesService.getScriptProperties();
  var channelId = sp.getProperty('WEEKLY_POST_CHANNEL_ID');
  if (!wkKey) throw new Error('wkKey required');

  var ids = _loadMsgIds_(wkKey);
  var tableMsgId = ids && ids.tables && ids.tables[0];
  if (!tableMsgId) throw new Error('No tables message id for '+wkKey);

  // Load message text
  var rel = fetchMessageById_(channelId, tableMsgId);
  var text = contentFromRelay_(rel);
  if (!text) throw new Error('Could not load current tables message');

  var weekMap = '';
  try {
    if (wkKey.indexOf('|')>0) weekMap = wkKey.split('|')[1] || '';
  } catch(_){}

  var wantMap = String(mapName||'').toLowerCase();
  var isCurrentMap = (weekMap && wantMap) ? (weekMap.toLowerCase() === wantMap) : false;

  var lines = text.split(/\r?\n/);
  var W = _w_();

  // Walk the fences and map sections to find the target line index
  var inFence = false, inRem = false, currentMap = '';
  var targetIdx = -1;

  function matchVs_(line) {
    if (!/\|/.test(line)) return false;
    var parts = line.split('|');
    if (!/vs/i.test(parts[0])) return false;
    var ab = _splitVs_(parts[0]);
    var kHome = _normTeam_(home), kAway = _normTeam_(away);
    var L = _normTeam_(ab[0]), R = _normTeam_(ab[1]);
    return (L===kHome && R===kAway) || (L===kAway && R===kHome);
  }

  for (var i=0;i<lines.length;i++){
    var ln = lines[i];

    if (/^\*\*Make-ups \/ Rematches\*\*/.test(ln)) { inRem = true; continue; }
    if (/^```/.test(ln)) { inFence = !inFence; continue; }
    if (!inFence) continue;

    if (inRem) {
      // map label line inside rematches fence
      if (/^dod_[a-z0-9_]+$/i.test(ln.trim())) {
        currentMap = ln.trim().toLowerCase();
        continue;
      }
      if (!wantMap) continue; // must know map to target rematches
      if (currentMap !== wantMap) continue;
      if (matchVs_(ln)) { targetIdx = i; break; }
    } else {
      // current-week fences (Bronze/Silver/Gold) - no map label
      if (wantMap && !isCurrentMap) continue; // user asked a different map than current week; skip
      if (matchVs_(ln)) { targetIdx = i; break; }
    }
  }

  if (targetIdx < 0) {
    try { logLocal_('INFO','caster.row.not_found',{ wkKey:wkKey, map:mapName, home:home, away:away }); } catch(_){}
    return { ok:false, reason:'row_not_found' };
  }

  // Edit only the caster column (col3)
  var parts = lines[targetIdx].split('|');
  if (parts.length < 3) return { ok:false, reason:'malformed_row' };

  var casterTxt = twitchUrl ? String(twitchUrl).replace(/^https?:\/\//,'') : '-';
  parts[2] = ' ' + _padC_(casterTxt, W.COL3);  // keep centered padding
  var newLine = parts[0] + '|' + parts[1] + '|' + parts[2];

  if (newLine === lines[targetIdx]) {
    return { ok:true, edited:false, msgId: tableMsgId };
  }

  lines[targetIdx] = newLine;
  var newText = lines.join('\n');

  if (typeof editChannelMessage_==='function') {
    editChannelMessage_(channelId, tableMsgId, newText);
  } else if (typeof editChannelMessageAdvanced_==='function') {
    editChannelMessageAdvanced_(channelId, tableMsgId, newText, null);
  }
  try { logLocal_('INFO','caster.updated',{ wkKey:wkKey, map:mapName, home:home, away:away, url:twitchUrl }); } catch(_){}
  return { ok:true, edited:true, msgId: tableMsgId };
}

function touchWeeklyHeaderTimestamp_(wkKey, week) {
  var sp = PropertiesService.getScriptProperties();
  var channelId = sp.getProperty('WEEKLY_POST_CHANNEL_ID');
  var ids = _loadMsgIds_(wkKey);
  if (!ids || !ids.header) return { ok:false, reason:'no_header_id' };

  // Rebuild header embed (keeps title/description; updates footer/timestamp)
  var header = (typeof renderHeaderEmbedPayload_ === 'function')
    ? renderHeaderEmbedPayload_(week || null)
    : { embeds: [{ title: 'KTP Weekly Matches', description: '', color: 5814783, timestamp: (new Date()).toISOString() }] };

  if (typeof editChannelMessageAdvanced_ === 'function') {
    editChannelMessageAdvanced_(channelId, ids.header, '', header.embeds);
  } else if (typeof editChannelMessage_ === 'function') {
    // Fallback: if you only have content editor, skip (header is embed-only)
  }
  try { logLocal_('INFO','header.touched',{ wkKey:wkKey, headerId:ids.header }); } catch(_){}
  return { ok:true, headerId: ids.header };
}



