#!/usr/bin/env node
// generate-leaders.js — Fetches MLB stat leaders, outputs leaders.html

const API = 'https://statsapi.mlb.com';

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const CATEGORIES = [
  { key: 'battingAverage', label: 'Batting Average', group: 'Hitting' },
  { key: 'onBasePct', label: 'On-Base Pct', group: 'Hitting' },
  { key: 'sluggingPct', label: 'Slugging', group: 'Hitting' },
  { key: 'onBasePlusSlugging', label: 'OPS', group: 'Hitting' },
  { key: 'hits', label: 'Hits', group: 'Hitting' },
  { key: 'wins', label: 'Wins', group: 'Pitching' },
  { key: 'saves', label: 'Saves', group: 'Pitching' },
  { key: 'inningsPitched', label: 'Innings Pitched', group: 'Pitching' },
  { key: 'strikeouts', label: 'Strikeouts', group: 'Pitching' },
  { key: 'strikeoutsPer9Inn', label: 'K/9', group: 'Pitching' },
  { key: 'walksPer9Inn', label: 'BB/9', group: 'Pitching' },
  { key: 'homeRunsAllowed', label: 'HR Allowed', group: 'Pitching' },
];

// Lower is better for these
const LOWER_BETTER = new Set(['walksPer9Inn', 'homeRunsAllowed']);

async function main() {
  const now = new Date();
  const season = now.getFullYear();
  const catKeys = CATEGORIES.map(c => c.key).join(',');
  const data = await fetchJSON(`${API}/api/v1/stats/leaders?leaderCategories=${catKeys}&season=${season}&limit=10&sportId=1`);

  const leaderMap = {};
  for (const cat of data.leagueLeaders || []) {
    leaderMap[cat.leaderCategory] = cat.leaders || [];
  }

  let hitting = '', pitching = '';
  for (const cat of CATEGORIES) {
    const leaders = leaderMap[cat.key] || [];
    let rows = '';
    for (const l of leaders) {
      const name = l.person?.fullName || '?';
      const team = l.team?.abbreviation || '?';
      const logo = `https://a.espncdn.com/i/teamlogos/mlb/500/${(l.team?.fileCode || team || '').toLowerCase()}.png`;
      rows += `<tr><td class="rank">${l.rank}</td><td class="player"><img src="${logo}" alt="${esc(team)}" class="logo"/>${esc(name)}</td><td class="val">${l.value}</td></tr>`;
    }
    const note = LOWER_BETTER.has(cat.key) ? ' <span class="note">(lower is better)</span>' : '';
    const section = `<div class="leader-card">
      <h3>${esc(cat.label)}${note}</h3>
      <table><tbody>${rows}</tbody></table>
    </div>`;
    if (cat.group === 'Hitting') hitting += section;
    else pitching += section;
  }

  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MLB Leaders</title>
<style>
:root{--bg:#f3f4f6;--card:#fff;--line:#d1d5db;--muted:#6b7280;--text:#111827;--accent:#1d4ed8}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.page{max-width:860px;margin:0 auto;padding:20px 14px 40px}
header{margin:4px 4px 18px}
h1{font-size:1.9rem;line-height:1.1;margin:0 0 4px}
.subtitle{color:var(--muted);font-size:.98rem;margin-bottom:10px}
nav{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
nav a{display:inline-block;padding:8px 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--text);font-weight:600;font-size:.9rem}
nav a.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.group-title{font-size:1.3rem;font-weight:700;margin:20px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.group-title:first-of-type{margin-top:0}
.leaders-grid{display:grid;gap:14px}
.leader-card{background:var(--card);border-radius:16px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.leader-card h3{font-size:.95rem;margin-bottom:8px;color:var(--text)}
.note{font-weight:400;color:var(--muted);font-size:.8rem}
table{width:100%;border-collapse:collapse;font-size:.88rem}
tr{border-bottom:1px solid #e5e7eb}
tr:last-child{border-bottom:0}
td{padding:6px 4px}
.rank{width:28px;color:var(--muted);font-weight:700;text-align:center}
.player{white-space:nowrap}
.logo{width:20px;height:20px;object-fit:contain;vertical-align:middle;margin-right:6px}
.val{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
@media(min-width:760px){.leaders-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<main class="page">
  <header>
    <h1>MLB Leaders</h1>
    <div class="subtitle">${dateStr}</div>
  </header>
  <nav>
    <a href="index.html">Scores</a>
    <a href="standings.html">Standings</a>
    <a href="leaders.html" class="active">Leaders</a>
  </nav>
  <div class="group-title">Hitting</div>
  <div class="leaders-grid">${hitting}</div>
  <div class="group-title">Pitching</div>
  <div class="leaders-grid">${pitching}</div>
</main>
</body>
</html>`;

  require('fs').writeFileSync('leaders.html', html);
  console.log('Done — wrote leaders.html');
}

main().catch(e => { console.error(e); process.exit(1); });
