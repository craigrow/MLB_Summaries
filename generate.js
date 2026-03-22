#!/usr/bin/env node
// generate.js — Fetches yesterday's MLB games, generates LLM summaries, outputs index.html

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

const API = 'https://statsapi.mlb.com';
const SORT_ORDER = {SEA:0,HOU:1,LAA:2,TEX:3,ATH:4,OAK:4,
  BAL:10,BOS:11,NYY:12,TB:13,TOR:14,
  CLE:20,CWS:21,DET:22,KC:23,MIN:24,
  AZ:30,COL:31,LAD:32,SD:33,SF:34,
  ATL:40,MIA:41,NYM:42,PHI:43,WSH:44,
  CHC:50,CIN:51,MIL:52,PIT:53,STL:54};

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtDate(s) {
  const d = new Date(s + 'T12:00:00');
  return d.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});
}

function formatIP(ip) {
  const [w, f] = String(ip).split('.');
  const frac = parseInt(f || '0', 10);
  if (frac === 0) return w;
  if (frac === 1) return w + ' ⅓';
  if (frac === 2) return w + ' ⅔';
  return String(ip);
}

function sortKey(game) {
  const a = game.teams.away.team.abbreviation;
  const h = game.teams.home.team.abbreviation;
  return Math.min(SORT_ORDER[a] ?? 99, SORT_ORDER[h] ?? 99);
}

// --- LLM Summary ---
async function generateSummary(scoringPlays, allPlays, decisions, awayName, homeName, awayR, homeR, keyHitters) {
  const plays = scoringPlays.map(i => allPlays[i]).filter(Boolean);
  const playDescs = plays.map(p => {
    const a = p.about;
    const half = a.isTopInning ? 'Top' : 'Bottom';
    return `${half} ${a.inning}: ${p.result.description} (Score: ${p.result.awayScore}-${p.result.homeScore})`;
  }).join('\n');

  const w = decisions?.winner?.fullName || 'unknown';
  const l = decisions?.loser?.fullName || 'unknown';
  const sv = decisions?.save?.fullName;

  const hitterLines = keyHitters.map(h => {
    let s = `${h.name}: ${h.h}-for-${h.ab}`;
    if (h.hr) s += `, ${h.hr} HR`;
    if (h.rbi) s += `, ${h.rbi} RBI`;
    return s;
  }).join('\n');

  const userMsg = `Game: ${awayName} ${awayR}, ${homeName} ${homeR}
Winning pitcher: ${w}
Losing pitcher: ${l}${sv ? '\nSave: ' + sv : ''}

Scoring plays:
${playDescs}

Key hitters:
${hitterLines}`;

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `Write a short baseball game recap in natural newspaper-style English. Two paragraphs, no more.

Rules:
- Start with the key turning point or decisive stretch — do NOT restate the final score.
- Name the players involved in the big hits and pitching moments.
- Use "the" before team names (e.g. "the Mariners").
- Do not narrate inning-by-inning unless needed for flow.
- Avoid robotic phrasing and redundancy with the box score.
- Sound like a real game recap from a newspaper sports section.
- All facts must come from the provided data. Do not invent anything.
- Keep it concise — two short paragraphs.` },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.7,
    max_tokens: 300
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`  OpenAI error ${r.status}: ${err}`);
    return null;
  }
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content?.trim() || null;
  if (text) console.log(`    Summary generated (${text.length} chars)`);
  else console.error('    OpenAI returned empty response');
  return text;
}

// --- Build meta line ---
function buildMeta(decisions, boxAway, boxHome) {
  const parts = [];
  if (decisions?.winner) parts.push(`W: ${decisions.winner.fullName}`);
  if (decisions?.loser) parts.push(`L: ${decisions.loser.fullName}`);
  if (decisions?.save) parts.push(`S: ${decisions.save.fullName}`);

  const hitters = getKeyHitters(boxAway, boxHome);
  if (hitters.length) {
    const strs = hitters.map(h => {
      let s = `${h.name} ${h.h}-for-${h.ab}`;
      if (h.hr) s += `, ${h.hr} HR`;
      if (h.rbi) s += `, ${h.rbi} RBI`;
      return s;
    });
    parts.push('Key: ' + strs.join('; '));
  }
  return parts.join(' • ');
}

function getKeyHitters(boxAway, boxHome) {
  const hitters = [];
  [boxAway, boxHome].forEach(side => {
    Object.values(side.players || {}).forEach(p => {
      const s = p.stats?.batting;
      if (!s || !s.atBats) return;
      const val = (s.hits||0) + (s.rbi||0) + (s.homeRuns||0)*2;
      if (val >= 2) hitters.push({name:p.person.fullName, ab:s.atBats, h:s.hits||0, hr:s.homeRuns||0, rbi:s.rbi||0, val});
    });
  });
  hitters.sort((a, b) => b.val - a.val);
  return hitters.slice(0, 3);
}

// --- Box score HTML ---
function renderBoxScore(boxAway, boxHome, awayName, homeName) {
  function batTable(side, name) {
    const players = side.players || {};
    const order = side.battingOrder || [];
    let rows = '', tAB=0, tR=0, tH=0, tRBI=0, tBB=0, tSO=0;
    const seen = new Set();
    const addPlayer = (id) => {
      if (seen.has(id)) return;
      const p = players['ID'+id]; if (!p) return;
      const s = p.stats?.batting; if (!s) return;
      seen.add(id);
      const pos = p.position?.abbreviation || '';
      tAB+=s.atBats||0; tR+=s.runs||0; tH+=s.hits||0; tRBI+=s.rbi||0; tBB+=s.baseOnBalls||0; tSO+=s.strikeOuts||0;
      rows += `<tr><td>${esc(p.person.fullName)} <small>${pos}</small></td><td>${s.atBats||0}</td><td>${s.runs||0}</td><td>${s.hits||0}</td><td>${s.rbi||0}</td><td>${s.baseOnBalls||0}</td><td>${s.strikeOuts||0}</td><td>${s.avg||'.000'}</td></tr>`;
    };
    order.forEach(addPlayer);
    // Subs with at-bats
    Object.values(players).forEach(p => { if (p.stats?.batting?.atBats) addPlayer(p.person.id); });
    rows += `<tr class="totals"><td>Totals</td><td>${tAB}</td><td>${tR}</td><td>${tH}</td><td>${tRBI}</td><td>${tBB}</td><td>${tSO}</td><td></td></tr>`;
    return `<h4>${esc(name)} Batting</h4><table><thead><tr><th>Player</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th><th>AVG</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function pitchTable(side, name) {
    const players = side.players || {};
    let rows = '';
    (side.pitchers || []).forEach(id => {
      const p = players['ID'+id]; if (!p) return;
      const s = p.stats?.pitching; if (!s) return;
      rows += `<tr><td>${esc(p.person.fullName)}</td><td>${formatIP(s.inningsPitched||'0')}</td><td>${s.hits||0}</td><td>${s.runs||0}</td><td>${s.earnedRuns||0}</td><td>${s.baseOnBalls||0}</td><td>${s.strikeOuts||0}</td><td>${s.era||'0.00'}</td></tr>`;
    });
    return `<h4>${esc(name)} Pitching</h4><table><thead><tr><th>Player</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>ERA</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  return batTable(boxAway, awayName) + batTable(boxHome, homeName) + pitchTable(boxAway, awayName) + pitchTable(boxHome, homeName);
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// --- Main ---
async function main() {
  const date = yesterday();
  console.log(`Generating digest for ${date}`);

  const sched = await fetchJSON(`${API}/api/v1/schedule?date=${date}&sportId=1&hydrate=team,linescore,decisions`);
  const games = (sched.dates || [])[0]?.games || [];
  const final = games.filter(g => g.status?.abstractGameState === 'Final');
  console.log(`${final.length} completed games`);

  final.sort((a, b) => sortKey(a) - sortKey(b) || new Date(a.gameDate) - new Date(b.gameDate));

  const cards = [];
  for (const game of final) {
    const away = game.teams.away;
    const home = game.teams.home;
    const at = away.team;
    const ht = home.team;

    console.log(`  ${at.teamName} @ ${ht.teamName}`);

    let liveData = null;
    try {
      const live = await fetchJSON(`${API}/api/v1.1/game/${game.gamePk}/feed/live`);
      liveData = live.liveData;
    } catch (e) { console.error(`    Failed to fetch live data: ${e.message}`); }

    const ls = liveData?.linescore || game.linescore || {};
    const totals = ls.teams || {};
    const aR = totals.away?.runs ?? away.score ?? 0;
    const hR = totals.home?.runs ?? home.score ?? 0;
    const aH = totals.away?.hits ?? '—';
    const hH = totals.home?.hits ?? '—';
    const aE = totals.away?.errors ?? '—';
    const hE = totals.home?.errors ?? '—';
    const aWin = aR > hR;
    const hWin = hR > aR;
    const aLogo = `https://a.espncdn.com/i/teamlogos/mlb/500/${at.fileCode || at.abbreviation?.toLowerCase()}.png`;
    const hLogo = `https://a.espncdn.com/i/teamlogos/mlb/500/${ht.fileCode || ht.abbreviation?.toLowerCase()}.png`;

    const box = liveData?.boxscore;
    const plays = liveData?.plays;
    const decisions = liveData?.decisions || {};

    // Generate LLM summary
    let summaryHtml = '';
    if (plays) {
      const keyHitters = box ? getKeyHitters(box.teams.away, box.teams.home) : [];
      const summary = await generateSummary(plays.scoringPlays || [], plays.allPlays || [], decisions, at.teamName, ht.teamName, aR, hR, keyHitters);
      if (summary) {
        summaryHtml = summary.split('\n').filter(l => l.trim()).map(l => `<p>${esc(l)}</p>`).join('');
      }
    }

    const metaHtml = box ? buildMeta(decisions, box.teams.away, box.teams.home) : '';
    const boxHtml = box ? renderBoxScore(box.teams.away, box.teams.home, at.teamName, ht.teamName) : '';
    const boxId = 'box-' + game.gamePk;

    cards.push(`<article class="game-card">
  <div class="scoreboard">
    <div class="sb-top">Final</div>
    <div class="sb-head"><div></div><div>R</div><div>H</div><div>E</div></div>
    <div class="sb-row${aWin ? ' winner' : ''}">
      <div class="team"><img src="${aLogo}" alt="${esc(at.teamName)}" class="team-logo"/><div class="team-name">${esc(at.teamName)}</div></div>
      <div class="stat">${aR}</div><div class="stat">${aH}</div><div class="stat">${aE}</div>
    </div>
    <div class="sb-row${hWin ? ' winner' : ''}">
      <div class="team"><img src="${hLogo}" alt="${esc(ht.teamName)}" class="team-logo"/><div class="team-name">${esc(ht.teamName)}</div></div>
      <div class="stat">${hR}</div><div class="stat">${hH}</div><div class="stat">${hE}</div>
    </div>
  </div>
  ${summaryHtml ? `<div class="summary">${summaryHtml}</div>` : ''}
  ${metaHtml ? `<div class="meta">${esc(metaHtml)}</div>` : ''}
  ${boxHtml ? `<button class="box-toggle" onclick="document.getElementById('${boxId}').classList.toggle('open');this.textContent=this.textContent.includes('▸')?'Box Score ▾':'Box Score ▸'">Box Score ▸</button><div class="box-content" id="${boxId}">${boxHtml}</div>` : ''}
</article>`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MLB Yesterday — ${fmtDate(date)}</title>
<style>
:root{--bg:#f3f4f6;--card:#fff;--line:#d1d5db;--muted:#6b7280;--text:#111827}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.page{max-width:860px;margin:0 auto;padding:20px 14px 40px}
header{margin:4px 4px 18px}
h1{font-size:1.9rem;line-height:1.1;margin:0 0 4px}
.subtitle{color:var(--muted);font-size:.98rem;margin-bottom:10px}
.grid{display:grid;gap:18px}
.game-card{background:var(--card);border-radius:16px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.scoreboard{border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:14px}
.sb-top{background:#f8fafc;color:var(--muted);font-weight:800;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;padding:8px 14px;border-bottom:1px solid #e5e7eb}
.sb-head,.sb-row{display:grid;grid-template-columns:minmax(0,1fr) 44px 44px 44px;align-items:center}
.sb-head{color:var(--muted);font-size:.78rem;font-weight:800;padding:6px 14px;border-bottom:1px solid #e5e7eb}
.sb-head>div{text-align:center}.sb-head>div:first-child{text-align:left}
.sb-row{padding:10px 14px;border-bottom:1px solid #e5e7eb}
.sb-row:last-child{border-bottom:0}
.sb-row.winner{background:#f9fafb}
.sb-row.winner .team-name,.sb-row.winner .stat{font-weight:800}
.team{display:flex;align-items:center;gap:10px;min-width:0}
.team-logo{width:28px;height:28px;object-fit:contain;flex:0 0 auto}
.team-name{font-size:1rem;font-weight:600}
.stat{text-align:center;font-size:1rem;font-weight:700}
.summary{margin-bottom:12px}
.summary p{margin:0 0 10px;font-size:1.02rem;line-height:1.55}
.summary p:last-child{margin-bottom:0}
.meta{padding-top:10px;border-top:1px solid #e5e7eb;color:var(--muted);font-size:.92rem;margin-bottom:10px}
.box-toggle{background:none;border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:.85rem;font-weight:600;color:var(--muted);cursor:pointer;width:100%}
.box-toggle:hover{background:#f9fafb}
.box-content{display:none;margin-top:12px;overflow-x:auto}
.box-content.open{display:block}
.box-content h4{font-size:.85rem;font-weight:700;margin:12px 0 4px;color:var(--muted)}
.box-content h4:first-child{margin-top:0}
.box-content table{width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:8px}
.box-content th,.box-content td{padding:4px 6px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap}
.box-content th:first-child,.box-content td:first-child{text-align:left}
.box-content th{font-weight:700;color:var(--muted);font-size:.75rem}
.box-content .totals td{font-weight:700;border-top:2px solid var(--line)}
.no-games{text-align:center;padding:40px 20px;color:var(--muted);font-size:1rem}
@media(min-width:760px){.grid{grid-template-columns:1fr 1fr}.game-card{break-inside:avoid}}
</style>
</head>
<body>
<main class="page">
  <header>
    <h1>MLB Yesterday</h1>
    <div class="subtitle">${fmtDate(date)}</div>
  </header>
  <section class="grid">
    ${cards.length ? cards.join('\n') : '<div class="no-games">No completed games for this date.</div>'}
  </section>
</main>
</body>
</html>`;

  const fs = require('fs');
  fs.writeFileSync('index.html', html);
  console.log(`Done — wrote index.html with ${cards.length} games`);
}

main().catch(e => { console.error(e); process.exit(1); });
