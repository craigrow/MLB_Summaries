#!/usr/bin/env node
// generate-leaders.js — Fetches MLB stat leaders, outputs leaders.html

const API = 'https://statsapi.mlb.com';
const ESPN_LOGO_CODE = { AZ: 'ari' };
const MAX_ROWS = 10;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const HITTING_CATS = [
  { key: 'battingAverage', label: 'Batting Average' },
  { key: 'homeRuns', label: 'Home Runs' },
  { key: 'runsBattedIn', label: 'RBI' },
  { key: 'hits', label: 'Hits' },
  { key: 'stolenBases', label: 'Stolen Bases' },
  { key: 'onBasePercentage', label: 'On-Base Pct' },
  { key: 'sluggingPercentage', label: 'Slugging' },
  { key: 'onBasePlusSlugging', label: 'OPS' },
];

const PITCHING_CATS = [
  { key: 'earnedRunAverage', label: 'ERA', lower: true },
  { key: 'wins', label: 'Wins' },
  { key: 'strikeouts', label: 'Strikeouts' },
  { key: 'saves', label: 'Saves' },
  { key: 'walksAndHitsPerInningPitched', label: 'WHIP', lower: true },
  { key: 'strikeoutsPer9Inn', label: 'K/9' },
  { key: 'inningsPitched', label: 'Innings Pitched' },
];

async function fetchLeaders(categories, statGroup) {
  const keys = categories.map(c => c.key).join(',');
  const data = await fetchJSON(`${API}/api/v1/stats/leaders?leaderCategories=${keys}&season=${new Date().getFullYear()}&limit=10&sportId=1&statGroup=${statGroup}&hydrate=team`);
  const map = {};
  for (const cat of data.leagueLeaders || []) {
    if (cat.statGroup === statGroup) map[cat.leaderCategory] = cat.leaders || [];
  }
  return map;
}

const STARTER_CATS = [
  { stat: 'earnedRunAverage', label: 'Starter ERA', lower: true, order: 'asc', fmt: s => s.era },
  { stat: 'walksAndHitsPerInningPitched', label: 'Starter WHIP', lower: true, order: 'asc', fmt: s => s.whip },
  { stat: 'strikeoutsPer9Inn', label: 'Starter K/9', order: 'desc', fmt: s => s.strikeoutsPer9Inn },
];

const MIN_GS = 2;
const MIN_IP = 15;

async function fetchStarterLeaders() {
  const results = {};
  for (const cat of STARTER_CATS) {
    const data = await fetchJSON(`${API}/api/v1/stats?stats=season&group=pitching&season=${new Date().getFullYear()}&sportId=1&sortStat=${cat.stat}&order=${cat.order}&limit=50&hydrate=team`);
    const leaders = [];
    let rank = 0, lastVal = null;
    for (const split of (data.stats?.[0]?.splits || [])) {
      const s = split.stat || {};
      if ((s.gamesStarted || 0) < MIN_GS || parseFloat(s.inningsPitched || '0') < MIN_IP) continue;
      const val = cat.fmt(s);
      if (val !== lastVal) { rank = leaders.length + 1; lastVal = val; }
      leaders.push({
        rank, value: val,
        person: split.player,
        team: split.team
      });
      if (leaders.length >= MAX_ROWS) break;
    }
    results[cat.stat] = { cat, leaders };
  }
  return results;
}

function renderCard(cat, leaders) {
  const note = cat.lower ? ' <span class="note">(lower is better)</span>' : '';
  let rows = '';
  for (const l of leaders.slice(0, MAX_ROWS)) {
    const name = l.person?.fullName || '?';
    const abbr = l.team?.abbreviation || '';
    const logo = `https://a.espncdn.com/i/teamlogos/mlb/500/${ESPN_LOGO_CODE[abbr] || abbr.toLowerCase() || '?'}.png`;
    rows += `<tr><td class="rank">${l.rank}</td><td class="player"><img src="${logo}" alt="${esc(abbr)}" class="logo"/>${esc(name)}</td><td class="team-abbr">${esc(abbr)}</td><td class="val">${l.value}</td></tr>`;
  }
  return `<div class="leader-card">
      <h3>${esc(cat.label)}${note}</h3>
      <table><tbody>${rows || '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:12px">No data available</td></tr>'}</tbody></table>
    </div>`;
}

async function main() {
  const [hittingMap, pitchingMap, starterMap] = await Promise.all([
    fetchLeaders(HITTING_CATS, 'hitting'),
    fetchLeaders(PITCHING_CATS, 'pitching'),
    fetchStarterLeaders(),
  ]);

  const hitting = HITTING_CATS.map(c => renderCard(c, hittingMap[c.key] || [])).join('');
  const pitching = PITCHING_CATS.map(c => renderCard(c, pitchingMap[c.key] || [])).join('');
  const starters = STARTER_CATS.map(c => {
    const entry = starterMap[c.stat];
    return entry ? renderCard(entry.cat, entry.leaders) : '';
  }).join('');

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

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
.group-note{font-weight:400;color:var(--muted);font-size:.85rem}
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
.team-abbr{color:var(--muted);font-size:.8rem;text-align:center}
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
  <div class="group-title">Starting Pitching <span class="group-note">(${MIN_GS}+ GS, ${MIN_IP}+ IP)</span></div>
  <div class="leaders-grid">${starters}</div>
</main>
</body>
</html>`;

  require('fs').writeFileSync('leaders.html', html);
  console.log('Done — wrote leaders.html');
}

const _isTest = process.env.NODE_ENV === 'test';

if (!_isTest) main().catch(e => { console.error(e); process.exit(1); });

if (typeof module !== 'undefined') {
  module.exports = { renderCard, esc, HITTING_CATS, PITCHING_CATS, STARTER_CATS, ESPN_LOGO_CODE, MAX_ROWS, MIN_GS, MIN_IP };
}
