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

// --- Venue capacities (approximate) ---
const VENUE_CAPACITY = {
  1:41168,2:37755,3:45609,4:36742,5:42445,7:37305,10:41922,12:40615,
  14:40963,15:41339,17:46537,19:41915,22:40300,31:41268,32:36107,
  680:40209,681:41546,2394:42319,2395:41503,2602:40094,2680:47929,
  2889:36025,3289:42271,3309:40615,3312:41168,3313:43651,4169:40000,
  5325:35000,2392:40720,2393:36973,15:41339
};

// --- Standings lookup ---
async function fetchStandings(date) {
  const map = {};
  try {
    const data = await fetchJSON(`${API}/api/v1/standings?leagueId=103,104&date=${date}&hydrate=team`);
    for (const rec of data.records || []) {
      const div = rec.division?.name || '';
      for (const tr of rec.teamRecords || []) {
        const abbr = tr.team?.abbreviation;
        if (!abbr) continue;
        map[abbr] = {
          w: tr.wins, l: tr.losses,
          pct: tr.winningPercentage || '',
          gb: tr.gamesBack === '-' ? '0' : tr.gamesBack,
          streak: tr.streak?.streakCode || '',
          div,
          divRank: tr.divisionRank || ''
        };
      }
    }
  } catch (e) { console.error(`  Standings fetch failed: ${e.message}`); }
  return map;
}

// --- Series context ---
async function fetchSeriesContext(game, date) {
  const awayId = game.teams.away.team.id;
  const homeId = game.teams.home.team.id;
  const seriesNum = game.seriesGameNumber || 1;
  const seriesLen = game.gamesInSeries || 3;
  const ctx = { gameNum: seriesNum, seriesLen, priorResults: [] };

  if (seriesNum <= 1) return ctx;

  try {
    // Look back up to 5 days for prior series games
    const start = new Date(date + 'T12:00:00');
    start.setDate(start.getDate() - 5);
    const startStr = start.toISOString().slice(0, 10);
    const url = `${API}/api/v1/schedule?startDate=${startStr}&endDate=${date}&sportId=1&teamId=${homeId}&hydrate=team,linescore`;
    const sched = await fetchJSON(url);
    for (const d of sched.dates || []) {
      for (const g of d.games || []) {
        if (g.gamePk === game.gamePk) continue;
        if (g.status?.abstractGameState !== 'Final') continue;
        const ga = g.teams.away.team.id, gh = g.teams.home.team.id;
        if (!((ga === awayId && gh === homeId) || (ga === homeId && gh === awayId))) continue;
        const aR = g.teams.away.score ?? 0, hR = g.teams.home.score ?? 0;
        ctx.priorResults.push({
          awayScore: aR, homeScore: hR,
          awayWon: aR > hR, homeWon: hR > aR,
          awayId: ga, homeId: gh
        });
      }
    }
  } catch (e) { console.error(`    Series context fetch failed: ${e.message}`); }
  return ctx;
}

// --- Attendance ---
function getAttendance(liveData, venueId) {
  let attendance = null;
  const info = liveData?.boxscore?.info || [];
  for (const item of info) {
    if (item.label === 'Att' || item.label === 'Attendance') {
      attendance = parseInt(String(item.value).replace(/,/g, ''), 10) || null;
      break;
    }
  }
  const capacity = VENUE_CAPACITY[venueId] || null;
  return { attendance, capacity };
}

// --- Build context string for LLM ---
function buildGameContext(game, standings, series, attendance) {
  const lines = [];
  const gameType = game.gameType;
  if (gameType === 'S') lines.push('Game type: Spring Training');
  else if (gameType === 'R') lines.push('Game type: Regular Season');
  else if (gameType === 'P' || gameType === 'F' || gameType === 'D' || gameType === 'L' || gameType === 'W') lines.push('Game type: Postseason');

  const aa = game.teams.away.team.abbreviation;
  const ha = game.teams.home.team.abbreviation;
  const as = standings[aa], hs = standings[ha];
  if (as) lines.push(`${aa}: ${as.w}-${as.l}${as.divRank ? ', ' + ordinal(as.divRank) + ' in ' + shortDiv(as.div) : ''}${as.gb !== '0' ? ', ' + as.gb + ' GB' : as.divRank === '1' ? ', leading division' : ''}${as.streak ? ', streak: ' + as.streak : ''}`);
  if (hs) lines.push(`${ha}: ${hs.w}-${hs.l}${hs.divRank ? ', ' + ordinal(hs.divRank) + ' in ' + shortDiv(hs.div) : ''}${hs.gb !== '0' ? ', ' + hs.gb + ' GB' : hs.divRank === '1' ? ', leading division' : ''}${hs.streak ? ', streak: ' + hs.streak : ''}`);

  // Series
  const { gameNum, seriesLen, priorResults } = series;
  if (seriesLen !== 3) lines.push(`Unusual series length: ${seriesLen}-game series`);
  if (gameNum === 1) {
    lines.push(`Series opener (${seriesLen}-game series)`);
  } else {
    const awayId = game.teams.away.team.id;
    let awayWins = 0, homeWins = 0;
    for (const r of priorResults) {
      if ((r.awayId === awayId && r.awayWon) || (r.homeId === awayId && r.homeWon)) awayWins++;
      else homeWins++;
    }
    const an = game.teams.away.team.teamName, hn = game.teams.home.team.teamName;
    let seriesLine = `Game ${gameNum} of ${seriesLen}: `;
    if (awayWins === homeWins) seriesLine += `Series tied ${awayWins}-${homeWins}`;
    else if (awayWins > homeWins) seriesLine += `${an} lead series ${awayWins}-${homeWins}`;
    else seriesLine += `${hn} lead series ${homeWins}-${awayWins}`;
    if (gameNum === seriesLen) {
      if (awayWins === homeWins) seriesLine += ' (rubber match)';
      else if (awayWins === 0 || homeWins === 0) seriesLine += ' (sweep attempt)';
      else seriesLine += ' (series finale)';
    }
    lines.push(seriesLine);
  }

  // Attendance
  if (attendance.attendance) {
    let attLine = `Attendance: ${attendance.attendance.toLocaleString()}`;
    if (attendance.capacity) {
      const pct = Math.round(attendance.attendance / attendance.capacity * 100);
      if (pct >= 95) attLine += ` (near sellout, capacity ${attendance.capacity.toLocaleString()})`;
      else if (pct <= 40) attLine += ` (sparse crowd, capacity ${attendance.capacity.toLocaleString()})`;
    }
    lines.push(attLine);
  }

  return lines.join('\n');
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = parseInt(n) % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

function shortDiv(d) {
  return d.replace('American League ', 'AL ').replace('National League ', 'NL ');
}

// --- LLM Summary ---
async function generateSummary(scoringPlays, allPlays, decisions, awayName, homeName, awayR, homeR, keyHitters, gameContext) {
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
${gameContext ? '\nContext:\n' + gameContext : ''}

Scoring plays:
${playDescs}

Key hitters:
${hitterLines}`;

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `You are a veteran baseball beat writer. Write a 2-3 paragraph game recap that sounds like it belongs in a morning newspaper sports section. Use 2 paragraphs for straightforward games, 3 for extras, walk-offs, or complex finishes.

Voice and style:
- Write with personality. Vary your sentence structure and openings across games.
- Never start with "The turning point" or "The decisive moment" — find a more natural way in.
- Use active, punchy verbs. No hedging ("managed to," "contributed with," "bolstered by").
- Trust the reader — don't overexplain what a home run or a save means.
- Use "the" before team names in prose.

Content rules:
- Start with whatever makes this game interesting — could be a big swing, a pitching duel, a collapse, a streak.
- Weave in context naturally when provided: standings race, series situation, attendance, streaks. Don't force it — mention it only when it adds meaning.
- If it's a series game beyond the opener, note the series score. If it's a sweep or rubber match, that's the story.
- If it's spring training, keep the tone lighter — don't write like it's October.
- Name 1-3 key players. Don't just list stats — connect them to the story.
- The final score can appear in the lede when it tells the story (blowouts, upsets), but don't lead with JUST the score.
- Do NOT narrate inning-by-inning.
- Do NOT repeat information that's in the box score footer (W/L/key hitters line).
- All facts must come from the provided data. Invent nothing.` },
      { role: 'user', content: `Game: Cubs 10, Nationals 2
Winning pitcher: Cade Horton
Losing pitcher: Trevor Williams

Context:
Game type: Regular Season
CHC: 1-1, 3rd in NL Central
WSH: 1-1, 4th in NL East
Game 2 of 3: Series tied 1-1 after Nationals won 10-4 on opening day

Scoring plays:
Top 1: Nico Hoerner singles, scoring Happ (1-0)
Top 3: Miguel Amaya homers to left (2-0)
Top 5: Matt Shaw singles, scoring Crow-Armstrong (3-0)
Top 6: Ian Happ homers to right-center, scoring Hoerner and Shaw (6-0)
Top 6: Carson Kelly singles, scoring Amaya (7-0)
Bottom 7: CJ Abrams doubles, scoring Garcia (7-1)
Top 8: Crow-Armstrong singles, scoring Hoerner (8-1)
Top 9: Amaya doubles, scoring Shaw (9-1)
Top 9: Suzuki singles, scoring Amaya (10-1)
Bottom 9: Abrams singles, scoring Ruiz (10-2)

Key hitters:
Ian Happ: 2-for-5, 1 HR, 3 RBI
Miguel Amaya: 2-for-5, 1 HR, 2 RBI
Pete Crow-Armstrong: 2-for-5, 1 RBI` },
      { role: 'assistant', content: `Cade Horton threw four-hit ball into the seventh inning, Ian Happ broke the game open with a three-run homer in the sixth and the Cubs routed the Nationals 10-2 on Saturday.

Miguel Amaya homered and finished with two hits and two RBIs, and Pete Crow-Armstrong added two hits. Nico Hoerner, Matt Shaw and Carson Kelly drove in runs as the Cubs avenged Thursday's 10-4 opening day loss.` },
      { role: 'user', content: `Game: Cardinals 6, Rays 5 (10 innings)
Winning pitcher: JoJo Romero
Losing pitcher: Griffin Jax

Context:
Game type: Regular Season
STL: 1-1, 3rd in NL Central
TB: 0-2, 5th in AL East
Game 2 of 3: Series tied 1-1

Scoring plays:
Bottom 1: Masyn Winn singles, scoring Contreras (1-0)
Top 3: Yandy Diaz homers to left (1-1)
Bottom 5: Nolan Arenado singles, scoring Goldschmidt (2-1)
Top 7: Amed Rosario doubles, scoring Diaz (2-2)
Top 8: Junior Caminero homers to center, scoring Rosario and Diaz (2-5)
Bottom 8: Contreras singles, scoring Winn (3-5)
Bottom 8: Goldschmidt singles, scoring Burleson (4-5)
Bottom 9: Arenado sacrifice fly, scoring Contreras (5-5)
Bottom 10: Wetherholt singles to right, scoring Church and Walker (6-5)

Key hitters:
JJ Wetherholt: 1-for-3, 2 RBI
Nolan Arenado: 1-for-4, 2 RBI
Junior Caminero: 1-for-4, 1 HR, 3 RBI` },
      { role: 'assistant', content: `St. Louis rookie JJ Wetherholt lined a two-run, 10th-inning single after Michael McGreevy tossed six hitless innings to help the Cardinals beat the Rays 6-5 on Saturday.

Wetherholt, the seventh pick of the 2024 MLB amateur draft, lined a single to right field off Griffin Jax in his second career game.

Jax walked Jordan Walker on four pitches to start the bottom of the 10th, and Victor Scott II laid down a sacrifice bunt to advance Walker and automatic runner Nathan Church into scoring position.` },
      { role: 'user', content: `Game: Marlins 2, Rockies 1
Winning pitcher: Sandy Alcantara
Losing pitcher: Kyle Freeland
Save: Tanner Scott

Context:
Game type: Regular Season
MIA: 1-0, 5th in NL East
COL: 0-1, 5th in NL West
Series opener (3-game series)

Scoring plays:
Bottom 3: Sanoja singles, scoring Chisholm (1-0)
Top 5: Toglia homers to right (1-1)
Bottom 7: Burger singles, scoring Sanoja (2-1)

Key hitters:
Javier Sanoja: 3-for-4, 1 RBI
Sandy Alcantara: 7 IP, 4 H, 1 R, 5 K
Jake Burger: 1-for-3, 1 RBI` },
      { role: 'assistant', content: `Javier Sanoja had three hits, Sandy Alcantara allowed one run over seven innings and the Marlins opened the season with a 2-1 win over the Rockies on Friday night.

Alcantara made his franchise-leading sixth start on opening day and struck out five, allowed four hits and walked two. It was a promising beginning to the season for the 2022 NL Cy Young award winner after a rollercoaster 2025 during which he went 11-13 with a 5.36 ERA while facing trade rumors.` },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.7,
    max_tokens: 400
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify(body)
    });
    if (r.ok) {
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content?.trim() || null;
      if (text) console.log(`    Summary generated (${text.length} chars)`);
      else console.error('    OpenAI returned empty response');
      return text;
    }
    const err = await r.text();
    if (r.status === 429) {
      const wait = 25 * (attempt + 1);
      console.log(`    Rate limited, waiting ${wait}s...`);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    console.error(`  OpenAI error ${r.status}: ${err}`);
    return null;
  }
  console.error('    Failed after 3 retries');
  return null;
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

  // Fetch standings once for all games
  const standings = await fetchStandings(date);
  console.log(`  Standings loaded for ${Object.keys(standings).length} teams`);

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

    // Fetch enrichment context
    const series = await fetchSeriesContext(game, date);
    const venueId = game.venue?.id;
    const att = getAttendance(liveData, venueId);
    const gameContext = buildGameContext(game, standings, series, att);

    // Generate LLM summary
    let summaryHtml = '';
    if (plays) {
      const keyHitters = box ? getKeyHitters(box.teams.away, box.teams.home) : [];
      const summary = await generateSummary(plays.scoringPlays || [], plays.allPlays || [], decisions, at.teamName, ht.teamName, aR, hR, keyHitters, gameContext);
      if (summary) {
        summaryHtml = summary.split('\n').filter(l => l.trim()).map(l => `<p>${esc(l)}</p>`).join('');
      }
      // Pace requests to stay under rate limit
      await new Promise(res => setTimeout(res, 22000));
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
