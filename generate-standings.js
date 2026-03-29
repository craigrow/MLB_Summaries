#!/usr/bin/env node
// generate-standings.js — Fetches MLB standings, outputs standings.html

const API = 'https://statsapi.mlb.com';

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Division display order: AL West first, then rest of AL, then NL
const DIV_ORDER = [
  'American League West', 'American League East', 'American League Central',
  'National League West', 'National League East', 'National League Central'
];

function shortDiv(name) {
  return name.replace('American League ', 'AL ').replace('National League ', 'NL ');
}

async function main() {
  const now = new Date();
  const season = now.getFullYear();
  const data = await fetchJSON(`${API}/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team,division`);

  const divMap = {};
  for (const rec of data.records || []) {
    const divName = rec.division?.name || 'Unknown';
    divMap[divName] = rec.teamRecords.map(t => ({
      name: t.team?.teamName || '?',
      abbr: t.team?.abbreviation || '?',
      logo: `https://a.espncdn.com/i/teamlogos/mlb/500/${(t.team?.fileCode || t.team?.abbreviation || '').toLowerCase()}.png`,
      w: t.wins, l: t.losses,
      pct: t.winningPercentage || '.000',
      gb: t.gamesBack === '-' ? '—' : t.gamesBack,
      wcgb: t.wildCardGamesBack === '-' ? '—' : (t.wildCardGamesBack || '—'),
      streak: t.streak?.streakCode || '',
      last10: `${t.records?.splitRecords?.find(r => r.type === 'lastTen')?.wins || '?'}-${t.records?.splitRecords?.find(r => r.type === 'lastTen')?.losses || '?'}`,
      rank: parseInt(t.divisionRank) || 99
    }));
    divMap[divName].sort((a, b) => a.rank - b.rank);
  }

  let sections = '';
  for (const div of DIV_ORDER) {
    const teams = divMap[div];
    if (!teams) continue;
    let rows = '';
    for (const t of teams) {
      rows += `<tr>
        <td class="team-cell"><img src="${t.logo}" alt="${esc(t.abbr)}" class="logo"/>${esc(t.name)}</td>
        <td>${t.w}</td><td>${t.l}</td><td>${t.pct}</td><td>${t.gb}</td>
        <td>${t.streak}</td>
      </tr>`;
    }
    sections += `<div class="division">
      <h2>${shortDiv(div)}</h2>
      <table><thead><tr><th class="team-cell">Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>STRK</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }

  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MLB Standings</title>
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
.division{background:var(--card);border-radius:16px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:14px}
.division h2{font-size:1.1rem;margin-bottom:10px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:8px 6px;text-align:center;border-bottom:1px solid #e5e7eb}
th{font-weight:700;color:var(--muted);font-size:.78rem}
.team-cell{text-align:left;white-space:nowrap}
.logo{width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:8px}
</style>
</head>
<body>
<main class="page">
  <header>
    <h1>MLB Standings</h1>
    <div class="subtitle">${dateStr}</div>
  </header>
  <nav>
    <a href="index.html">Scores</a>
    <a href="standings.html" class="active">Standings</a>
    <a href="leaders.html">Leaders</a>
  </nav>
  ${sections}
</main>
</body>
</html>`;

  require('fs').writeFileSync('standings.html', html);
  console.log('Done — wrote standings.html');
}

main().catch(e => { console.error(e); process.exit(1); });
