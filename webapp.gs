// =======================
// webapp.gs
// Web control panel UI + server_* endpoints for Weekly Matches
// =======================

function _checkSecret_(secret) {
  if (String(secret) !== WM_WEBAPP_SHARED_SECRET) throw new Error('Unauthorized');
}

function _summarizeAligned_(aligned) {
  if (!aligned) return null;
  return {
    date: Utilities.formatDate(aligned.date, Session.getScriptTimeZone(), 'EEE, MMM d, yyyy'),
    map: aligned.map,
    headerWeekName: aligned.headerWeekName || '',
    blocks: aligned.blocks
  };
}

// -------- server_* endpoints --------
function server_setStartId(secret, id) { _checkSecret_(secret);
  const snowflake = String(id || '').trim();
  if (!/^\d{5,30}$/.test(snowflake)) throw new Error('Invalid message ID format');
  PropertiesService.getScriptProperties().setProperty(LAST_SCHED_KEY, snowflake);
  return { ok: true, id: snowflake };
}
function server_getStartId(secret) { _checkSecret_(secret);
  const id = PropertiesService.getScriptProperties().getProperty(LAST_SCHED_KEY) || '';
  return { ok: true, id };
}
function server_clearStartId(secret) { _checkSecret_(secret);
  PropertiesService.getScriptProperties().deleteProperty(LAST_SCHED_KEY);
  return { ok: true };
}
function server_postOrUpdate(secret) { _checkSecret_(secret);
  const aligned = getAlignedUpcomingWeekOrReport_();
  if (!aligned) return { ok:false, reason:'no_aligned_week' };
  upsertWeeklyDiscordMessage_(aligned);
  return { ok:true, aligned:_summarizeAligned_(aligned) };
}
function server_pollNow(secret) { _checkSecret_(secret);
  const p = PropertiesService.getScriptProperties();
  const before = p.getProperty(LAST_SCHED_KEY) || '';
  WM_pollScheduling_locked();
  const after = p.getProperty(LAST_SCHED_KEY) || '';
  return { ok:true, before, after };
}
function server_runAnnounce(secret) { _checkSecret_(secret); WM_dailyCheckAndPostUpcoming(); return { ok:true }; }
function server_createTriggers(secret) { _checkSecret_(secret); WM_createFiveMinutePoll(); WM_createDailyAnnounceTrigger(); return { ok:true }; }
function server_deleteTriggers(secret) { _checkSecret_(secret); WM_deleteAllTriggers(); return { ok:true }; }
function server_clearWeekSchedules(secret) { _checkSecret_(secret); return clearAlignedWeekSchedules_(); }
function server_quickTest(secret) { _checkSecret_(secret);
  const who = UrlFetchApp.fetch(`${RELAY_BASE}/whoami`, { headers:{'X-Relay-Auth':RELAY_AUTH}, muteHttpExceptions:true });
  const aligned = getAlignedUpcomingWeekOrReport_();
  return { ok:true, relay:{ code:who.getResponseCode(), body:(who.getContentText()||'').slice(0,200) }, aligned:_summarizeAligned_(aligned) };
}
function server_getStatus(secret) { _checkSecret_(secret);
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty(LAST_SCHED_KEY) || '';
  const aligned = getAlignedUpcomingWeekOrReport_();
  return { ok:true, startId:id, aligned:_summarizeAligned_(aligned) };
}

// -------- Web UI --------
function doGet(e) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Weekly Matches — Control Panel</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  :root { --bg:#0b0e14; --panel:#121826; --text:#e5e7eb; --sub:#9aa3b2; --accent:#5eead4; --muted:#2a3244; --warn:#fbbf24; }
  html,body { margin:0; padding:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--muted); border-radius: 12px; padding: 16px; }
  label { display:block; font-size:12px; color:var(--sub); margin-bottom:6px; }
  input[type="text"], input[type="password"] { width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--muted); background:#0f1422; color:#e5e7eb; font-size:14px; outline:none; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .row > div { flex:1; min-width:220px; }
  .btns { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  button { border:none; padding:10px 14px; border-radius:8px; background:#1f2937; color:#e5e7eb; cursor:pointer; font-weight:600; }
  button.primary { background:var(--accent); color:#05241f; }
  button.warn { background:var(--warn); color:#231a02; }
  pre { margin-top:12px; padding:12px; background:#0a0f1d; border:1px solid var(--muted); border-radius:8px; color:#D1D5DB; font-size:12px; overflow:auto; max-height:300px; white-space:pre-wrap; }
  #status { margin-left:8px; opacity:.8 }
</style>
</head>
<body>
<div class="wrap">
  <h1>Weekly Matches — Control Panel <span id="status">loading…</span></h1>

  <div class="grid">
    <div class="card">
      <div class="row">
        <div>
          <label>Shared Secret</label>
          <input id="secret" type="password" placeholder="Enter shared secret"/>
          <div style="margin-top:8px;color:#9aa3b2;font-size:12px">
            <label><input id="remember" type="checkbox"/> Remember secret in this browser</label>
          </div>
        </div>
        <div>
          <label>Starting Message ID (Discord snowflake)</label>
          <input id="msgid" type="text" placeholder="e.g. 123456789012345678"/>
        </div>
      </div>
      <div class="btns">
        <button class="primary" onclick="setStartId()">Set Start ID</button>
        <button onclick="getStartId()">Get Start ID</button>
        <button class="warn" onclick="clearStartId()">Clear Start ID</button>
      </div>
    </div>

    <div class="card">
      <div class="btns">
        <button class="primary" onclick="postOrUpdate()">Post / Update Weekly Board</button>
        <button onclick="pollNow()">Poll Scheduling Now</button>
        <button onclick="runAnnounce()">Run Monday Announce Check</button>
      </div>
      <div class="btns">
        <button onclick="createTriggers()">Create 5-min Poll + Daily Announce</button>
        <button class="warn" onclick="deleteTriggers()">Delete All Triggers</button>
        <button onclick="quickTest()">Quick Test</button>
        <button class="warn" onclick="clearWeek()">🧹 Clear Current Week Schedules</button>
      </div>
      <pre id="out">{ ready: true }</pre>
    </div>
  </div>
</div>

<script>
function setStatus(s){ document.getElementById('status').textContent = s; }
function out(o){ document.getElementById('out').textContent = typeof o==='string' ? o : JSON.stringify(o,null,2); }
function sec(){ return document.getElementById('secret').value.trim(); }
function msg(){ return document.getElementById('msgid').value.trim(); }

(function initRemember(){
  try {
    const saved = localStorage.getItem('wm_secret');
    if (saved) { document.getElementById('secret').value = saved; document.getElementById('remember').checked = true; }
  } catch (_) {}
})();

function rememberSecretMaybe(){
  try {
    const remember = document.getElementById('remember').checked;
    const s = sec();
    if (remember && s) localStorage.setItem('wm_secret', s);
    else localStorage.removeItem('wm_secret');
  } catch (_) {}
}

function gs(){
  if (!(google && google.script && google.script.run)) {
    out({error:'google.script.run unavailable'}); setStatus('error'); throw new Error('no gs.run');
  }
  return google.script.run
    .withSuccessHandler(res => { out(res); setStatus('ready'); })
    .withFailureHandler(e => {
      const msg = String(e);
      setStatus('error');
      if (/Unauthorized|unauthorized/i.test(msg)) out({ error:'unauthorized (check shared secret)' });
      else out({ error: msg });
    });
}

function setStartId(){ rememberSecretMaybe(); const s=sec(), m=msg(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } if(!/^[0-9]{5,30}$/.test(m)){ setStatus('invalid id'); return out({error:'invalid_id_format'}); } setStatus('working…'); gs().server_setStartId(s,m); }
function getStartId(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } setStatus('working…'); gs().server_getStartId(s); }
function clearStartId(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } if(!confirm('Clear starting message ID?')) return; setStatus('working…'); gs().server_clearStartId(s); }

function postOrUpdate(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } setStatus('posting…'); gs().server_postOrUpdate(s); }
function pollNow(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } setStatus('polling…'); gs().server_pollNow(s); }
function runAnnounce(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } setStatus('announcing…'); gs().server_runAnnounce(s); }
function createTriggers(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } setStatus('creating triggers…'); gs().server_createTriggers(s); }
function deleteTriggers(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } if(!confirm('Delete ALL triggers?')) return; setStatus('deleting triggers…'); gs().server_deleteTriggers(s); }
function quickTest(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } setStatus('testing…'); gs().server_quickTest(s); }
function clearWeek(){ rememberSecretMaybe(); const s=sec(); if(!s){ setStatus('need secret'); return out({error:'missing_secret'}); } if(!confirm('Remove ALL schedules & shoutcasters for current aligned week?')) return; setStatus('clearing…'); gs().server_clearWeekSchedules(s); }

// Initial status load
(function refresh(){
  const s = sec();
  if (!s){ setStatus('enter secret'); out('Enter secret to load status'); return; }
  setStatus('loading…');
  google.script.run
    .withSuccessHandler(res => { out(res); setStatus('ready'); })
    .withFailureHandler(e => { setStatus('error'); out({ error:String(e) }); })
    .server_getStatus(s);
})();
</script>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
