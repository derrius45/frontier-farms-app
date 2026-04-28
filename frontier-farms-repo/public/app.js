// Frontier Farms App — Shared logic
// All pages load this file

// ── Config — update these ─────────────────────────────────────────────────
const CONFIG = {
  station:      'KDEC',
  gduAhead:     390,           // update weekly
  ownerEmail:   '',            // set on first load, saved to localStorage
  anthropicKey: '',            // paste your key — stored in localStorage
  fields: [
    { name: 'North 40',    planted: '2026-04-25', rm: 111,  crop: 'corn' },
    { name: 'South Creek', planted: '2026-05-02', rm: 108,  crop: 'corn' },
    { name: 'East Strip',  planted: '2026-04-29', rm: 113,  crop: 'corn' },
    { name: 'West Bean',   planted: '2026-05-05', rm: 4.2,  crop: 'soy'  },
  ]
};

// ── Persist settings across pages ─────────────────────────────────────────
function loadSettings() {
  const saved = localStorage.getItem('ff_settings');
  if (saved) {
    const s = JSON.parse(saved);
    if (s.ownerEmail)   CONFIG.ownerEmail   = s.ownerEmail;
    if (s.anthropicKey) CONFIG.anthropicKey = s.anthropicKey;
    if (s.gduAhead)     CONFIG.gduAhead     = s.gduAhead;
    if (s.fields)       CONFIG.fields       = s.fields;
  }
}
function saveSettings() {
  localStorage.setItem('ff_settings', JSON.stringify({
    ownerEmail:   CONFIG.ownerEmail,
    anthropicKey: CONFIG.anthropicKey,
    gduAhead:     CONFIG.gduAhead,
    fields:       CONFIG.fields
  }));
}

// ── Weather — NOAA KDEC ───────────────────────────────────────────────────
async function fetchWeather() {
  const url = `https://api.weather.gov/stations/${CONFIG.station}/observations?limit=48`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FrontierFarmsApp/1.0 (contact@frontierfarms.com)' }
  });
  const data = await res.json();

  const readings = data.features
    .map(f => ({
      time:  f.properties.timestamp,
      rh:    f.properties.relativeHumidity?.value,
      tempC: f.properties.temperature?.value
    }))
    .filter(r => r.rh != null && r.tempC != null);

  if (!readings.length) throw new Error('No weather data from NOAA');

  const { tempC, rh } = readings[0];
  const tempF = +((tempC * 9/5) + 32).toFixed(1);
  const es    = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const vpd   = +(es - es * (rh / 100)).toFixed(2);

  // RH streak
  const chron = [...readings].reverse();
  let streak = 0, cur = 0, totalAbove = 0;
  for (const r of chron) {
    if (r.rh >= 85) { cur++; streak = Math.max(streak, cur); totalAbove++; }
    else cur = 0;
  }

  return { tempF, rh: Math.round(rh), vpd, rhStreak: streak, totalAbove, readings };
}

// ── GDU window calculator ─────────────────────────────────────────────────
const DAILY_GDU = { 4:10, 5:14, 6:18, 7:20, 8:18, 9:12 };

function dateFromGDU(plantedStr, target) {
  let acc = CONFIG.gduAhead;
  let d   = new Date(plantedStr);
  while (acc < target) {
    d.setDate(d.getDate() + 1);
    acc += (DAILY_GDU[d.getMonth() + 1] ?? 10);
  }
  return new Date(d);
}

function getFieldWindows() {
  const today = new Date();
  return CONFIG.fields.map(f => {
    if (f.crop === 'corn') {
      const winStart = dateFromGDU(f.planted, 1250);
      const winPeak  = dateFromGDU(f.planted, 1350);
      const winEnd   = dateFromGDU(f.planted, 1500);
      const blackLyr = dateFromGDU(f.planted, 2400 + (f.rm - 95) * 20);
      const daysOut  = Math.round((winStart - today) / 86400000);
      const inWindow = today >= winStart && today <= winEnd;
      return { ...f, winStart, winPeak, winEnd, blackLyr, daysOut, inWindow };
    } else {
      // Soy: R1 ~75 days, R3 ~100 days after planting
      const plant = new Date(f.planted);
      const r1 = new Date(plant); r1.setDate(r1.getDate() + 75);
      const r3 = new Date(plant); r3.setDate(r3.getDate() + 100);
      const inWindow = today >= r1 && today <= r3;
      const daysOut  = Math.round((r1 - today) / 86400000);
      return { ...f, winStart: r1, winPeak: r1, winEnd: r3, daysOut, inWindow };
    }
  });
}

// ── Field status summary string (for Claude prompt) ───────────────────────
function buildFieldSummary() {
  return getFieldWindows().map(f => {
    if (f.crop === 'corn') {
      const status = f.inWindow
        ? 'IN POLLINATION WINDOW NOW'
        : f.daysOut > 0
          ? `pollination est ${f.winPeak.toLocaleDateString('en-US',{month:'short',day:'numeric'})} (${f.daysOut}d)`
          : 'pollination window passed';
      return `${f.name}: corn RM${f.rm}, planted ${f.planted}, ${status}`;
    } else {
      return `${f.name}: soy MG${f.rm}, planted ${f.planted}, R1 est ${f.winStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
    }
  }).join('\n');
}

// ── Claude API call ────────────────────────────────────────────────────────
async function callClaude(prompt) {
  if (!CONFIG.anthropicKey) throw new Error('No API key set — go to Settings');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ── Build the full report prompt ───────────────────────────────────────────
function buildReportPrompt(wx) {
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric', year:'numeric' });
  return `You are the Farm Operations Manager AI for Frontier Farms, a large corn and soybean operation in De Land, Illinois. The owner is an executive managing 6+ field managers. He reads this at 6am on his iPhone.

Today: ${today}

LIVE WEATHER (KDEC Decatur, ~18mi from De Land):
- Temp: ${wx.tempF}°F, RH: ${wx.rh}%
- VPD: ${wx.vpd} kPa (normal <1.5, watch 1.5-2.5, stress >2.5)
- RH above 85% for: ${wx.rhStreak} consecutive hours (disease alert triggers at 48h)
- Season GDU offset: +${CONFIG.gduAhead} above 30-yr normal (season ~10-14 days early)

FIELD STATUS:
${buildFieldSummary()}

MARKET CONTEXT:
- Late April 2026, central IL corn/soy operation
- El Niño 62% likely by June-August (NOAA official April 2026)
- Subsoil moisture deficit from 2024-2025 dry cycle
- Use directional market guidance — farmer is making hold/sell decisions, not trading

Write a daily owner briefing with exactly four sections:
1. FIELD OPS
2. EQUIPMENT + LABOR
3. MARKET + GRAIN
4. ENVIRONMENT

Format rules:
- First line must be: "FF Brief — ${today} · FIELD [GREEN/YELLOW/RED] · EQUIP [GREEN/YELLOW/RED] · MARKET [GREEN/YELLOW/RED] · ENV [GREEN/YELLOW/RED]"
- Each section: 2-3 sentences, end with "Decision needed: ..." or "No decision needed today."
- Plain English. No bullet points. No jargon. Write like you're talking to a farmer, not a consultant.
- Under 300 words total.`;
}

// ── Parse report into sections ─────────────────────────────────────────────
function parseReport(text) {
  const lines  = text.split('\n').filter(l => l.trim());
  const status = lines[0] || '';

  function extractStatus(key) {
    const m = status.match(new RegExp(key + '\\s+(GREEN|YELLOW|RED)', 'i'));
    return m ? m[1].toUpperCase() : 'GRAY';
  }

  const sections = [];
  let current = null;
  const keywords = ['FIELD OPS','EQUIPMENT','LABOR','MARKET','GRAIN','ENVIRONMENT','ENV'];

  for (const line of lines.slice(1)) {
    const upper = line.toUpperCase();
    const isHeader = keywords.some(k => upper.includes(k)) && line.length < 80;
    if (isHeader) {
      if (current) sections.push(current);
      current = { title: line.replace(/^\d+\.\s*/, '').replace(/[:\-–]/g,'').trim(), text: '', decision: '' };
    } else if (current) {
      const di = line.indexOf('Decision needed:');
      const dn = line.indexOf('No decision needed');
      const split = di > -1 ? di : dn > -1 ? dn : -1;
      if (split > -1) {
        current.text += (current.text ? ' ' : '') + line.slice(0, split).trim();
        current.decision = line.slice(split).trim();
      } else {
        current.text += (current.text ? ' ' : '') + line.trim();
      }
    }
  }
  if (current) sections.push(current);

  return {
    statusLine: status,
    field:  extractStatus('FIELD'),
    equip:  extractStatus('EQUIP'),
    market: extractStatus('MARKET'),
    env:    extractStatus('ENV'),
    sections
  };
}

// ── Status helpers ─────────────────────────────────────────────────────────
function statusClass(s) {
  if (s === 'GREEN')  return 'trio-green';
  if (s === 'YELLOW') return 'trio-amber';
  if (s === 'RED')    return 'trio-red';
  return 'trio-gray';
}
function tagClass(s) {
  if (s === 'GREEN')  return 'tag-green';
  if (s === 'YELLOW') return 'tag-amber';
  if (s === 'RED')    return 'tag-red';
  return 'tag-gray';
}
function statusLabel(s) {
  if (s === 'GREEN')  return 'Green';
  if (s === 'YELLOW') return 'Yellow';
  if (s === 'RED')    return 'Red';
  return '—';
}

// ── Shared report storage (sessionStorage so pages share it) ───────────────
function saveReport(parsed, wx) {
  sessionStorage.setItem('ff_report', JSON.stringify({ parsed, wx, ts: Date.now() }));
}
function loadReport() {
  const r = sessionStorage.getItem('ff_report');
  return r ? JSON.parse(r) : null;
}

// ── Open email client with report ──────────────────────────────────────────
function sendReportEmail(parsed, emailAddr) {
  if (!emailAddr) { alert('Enter an email address first'); return; }
  const fullText = [parsed.statusLine, '',
    ...parsed.sections.flatMap(s => [
      s.title.toUpperCase(), s.text, s.decision ? s.decision : '', ''
    ])
  ].join('\n');
  const subject = encodeURIComponent(parsed.statusLine.slice(0, 100));
  const body    = encodeURIComponent(fullText);
  window.location.href = `mailto:${emailAddr}?subject=${subject}&body=${body}`;
}

// ── Nav active state ───────────────────────────────────────────────────────
function setActiveNav(pageId) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });
}

// ── Date display ───────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
}

// ── Init ───────────────────────────────────────────────────────────────────
loadSettings();
