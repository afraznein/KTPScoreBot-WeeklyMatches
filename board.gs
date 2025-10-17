// =======================
// board.gs
// Render + upsert hybrid weekly board (embed header + plaintext tables)
// =======================

// ---- Local pads ----
function _padR_(s, w){ s=String(s||''); if (s.length>w) return s.slice(0,w); return s + ' '.repeat(w - s.length); }
function _padL_(s, w){ s=String(s||''); if (s.length>w) return s.slice(0,w); return ' '.repeat(w - s.length) + s; }
function _repeat_(ch,n){ return new Array(n+1).join(ch); }

// ---- Message IDs storage (header + table pages) ----
function _msgIdsKey_(wk){ return `WEEKLY_MSG_IDS_${wk}`; }
function _loadMsgIds_(wk){
  const raw = PropertiesService.getScriptProperties().getProperty(_msgIdsKey_(wk));
  return raw ? JSON.parse(raw) : { header:'', tables:[] };
}
function _saveMsgIds_(wk, ids){
  PropertiesService.getScriptProperties().setProperty(_msgIdsKey_(wk), JSON.stringify(ids));
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
  const sh  = getSheetByName_(division);
  const top = week.blocks[division].top;
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
  const sh = getSheetByName_(division); if (!sh) return false;
  const top = week.blocks[division]?.top; if (!top) return false;
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
    const sh = getSheetByName_(division); if(!sh) return false;
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

function upsertWeeklyDiscordMessage_(week) {
  const wkKey  = weekKey_(week);
  const store  = loadWeekStore_(wkKey);
  const pages  = renderTablesPages_(week, store);      // code-block pages
  const header = renderHeaderEmbedPayload_(week);      // {content:'', embeds:[...]}

  let ids = _loadMsgIds_(wkKey);
  const existing = ids && ids.cluster ? ids.cluster : [];
  const newIds = [];

  // Delete old cluster if it exists
  for (const mid of existing) {
    if (mid) { try { deleteMessage_(WEEKLY_POST_CHANNEL_ID, mid); } catch(_) {} }
  }

  // Post header first (embed only)
  const headerId = postChannelMessageAdvanced_(WEEKLY_POST_CHANNEL_ID, '', header.embeds);
  if (headerId) newIds.push(headerId);

  // Post tables (each page as code block)
  for (let i=0; i<pages.length; i++) {
    const pid = postChannelMessage_(WEEKLY_POST_CHANNEL_ID, pages[i]);
    if (pid) newIds.push(pid);
  }

  ids.cluster = newIds;
  _saveMsgIds_(wkKey, ids);

  sendLog_(`✅ Weekly board rebuilt — header=${headerId}, tables=${pages.length}`);
}