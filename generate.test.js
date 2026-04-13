// generate.test.js — Tests for MLB Summaries generator
// Uses Node.js built-in test runner (no dependencies)

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const {
  yesterday, fmtDate, formatIP, sortKey, ordinal, shortDiv, esc,
  getKeyHitters, buildMeta, buildGameContext, renderBoxScore,
  getExistingGamePks, mergeCards, getAttendance,
  SORT_ORDER, VENUE_CAPACITY
} = require('./generate.js');

// ── Helpers ──────────────────────────────────────────────

describe('yesterday', () => {
  it('returns a YYYY-MM-DD string', () => {
    assert.match(yesterday(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('fmtDate', () => {
  it('formats ISO date to readable string', () => {
    const result = fmtDate('2026-04-12');
    assert.ok(result.includes('April'));
    assert.ok(result.includes('12'));
    assert.ok(result.includes('2026'));
  });
});

describe('formatIP', () => {
  it('returns whole innings as-is', () => {
    assert.equal(formatIP('6.0'), '6');
    assert.equal(formatIP('0.0'), '0');
  });
  it('formats .1 as ⅓', () => {
    assert.equal(formatIP('5.1'), '5 ⅓');
  });
  it('formats .2 as ⅔', () => {
    assert.equal(formatIP('7.2'), '7 ⅔');
  });
  it('handles string without decimal', () => {
    assert.equal(formatIP('3'), '3');
  });
});

describe('ordinal', () => {
  it('handles 1st, 2nd, 3rd', () => {
    assert.equal(ordinal(1), '1st');
    assert.equal(ordinal(2), '2nd');
    assert.equal(ordinal(3), '3rd');
  });
  it('handles teens', () => {
    assert.equal(ordinal(11), '11th');
    assert.equal(ordinal(12), '12th');
    assert.equal(ordinal(13), '13th');
  });
  it('handles regular th', () => {
    assert.equal(ordinal(4), '4th');
    assert.equal(ordinal(9), '9th');
  });
  it('handles 21st, 22nd, 23rd', () => {
    assert.equal(ordinal(21), '21st');
    assert.equal(ordinal(22), '22nd');
    assert.equal(ordinal(23), '23rd');
  });
});

describe('shortDiv', () => {
  it('shortens American League', () => {
    assert.equal(shortDiv('American League West'), 'AL West');
  });
  it('shortens National League', () => {
    assert.equal(shortDiv('National League Central'), 'NL Central');
  });
});

describe('esc', () => {
  it('escapes HTML entities', () => {
    assert.equal(esc('<b>"test"&</b>'), '&lt;b&gt;&quot;test&quot;&amp;&lt;/b&gt;');
  });
  it('handles plain strings', () => {
    assert.equal(esc('Mariners'), 'Mariners');
  });
});

// ── Sort Order ───────────────────────────────────────────

describe('sortKey', () => {
  it('puts SEA games first', () => {
    const game = { teams: { away: { team: { abbreviation: 'SEA' } }, home: { team: { abbreviation: 'NYY' } } } };
    assert.equal(sortKey(game), 0);
  });
  it('uses minimum of both teams', () => {
    const game = { teams: { away: { team: { abbreviation: 'NYM' } }, home: { team: { abbreviation: 'HOU' } } } };
    assert.equal(sortKey(game), SORT_ORDER['HOU']);
  });
  it('defaults unknown teams to 99', () => {
    const game = { teams: { away: { team: { abbreviation: 'XXX' } }, home: { team: { abbreviation: 'YYY' } } } };
    assert.equal(sortKey(game), 99);
  });
});

// ── Key Hitters ──────────────────────────────────────────

describe('getKeyHitters', () => {
  const makePlayer = (id, name, stats) => ({
    [`ID${id}`]: { person: { id, fullName: name }, stats: { batting: stats }, position: { abbreviation: 'RF' } }
  });

  it('returns top 3 hitters sorted by value', () => {
    const boxAway = { players: {
      ...makePlayer(1, 'Player A', { atBats: 4, hits: 3, rbi: 2, homeRuns: 1 }), // val=3+2+2=7
      ...makePlayer(2, 'Player B', { atBats: 4, hits: 2, rbi: 1, homeRuns: 0 }), // val=2+1=3
      ...makePlayer(3, 'Player C', { atBats: 3, hits: 1, rbi: 0, homeRuns: 0 }), // val=1 (below threshold)
    }};
    const boxHome = { players: {
      ...makePlayer(4, 'Player D', { atBats: 5, hits: 2, rbi: 3, homeRuns: 1 }), // val=2+3+2=7
    }};
    const result = getKeyHitters(boxAway, boxHome);
    assert.equal(result.length, 3);
    assert.ok(result[0].val >= result[1].val);
  });

  it('skips players with no at-bats', () => {
    const box = { players: makePlayer(1, 'Pitcher', { atBats: 0, hits: 0, rbi: 0, homeRuns: 0 }) };
    assert.equal(getKeyHitters(box, { players: {} }).length, 0);
  });

  it('caps at 3 hitters', () => {
    const players = {};
    for (let i = 1; i <= 6; i++) Object.assign(players, makePlayer(i, `P${i}`, { atBats: 4, hits: 2, rbi: 1, homeRuns: 0 }));
    assert.equal(getKeyHitters({ players }, { players: {} }).length, 3);
  });
});

// ── Build Meta ───────────────────────────────────────────

describe('buildMeta', () => {
  it('includes W/L/S decisions', () => {
    const decisions = {
      winner: { fullName: 'John Doe' },
      loser: { fullName: 'Jane Smith' },
      save: { fullName: 'Bob Jones' }
    };
    const box = { players: {} };
    const result = buildMeta(decisions, box, box);
    assert.ok(result.includes('W: John Doe'));
    assert.ok(result.includes('L: Jane Smith'));
    assert.ok(result.includes('S: Bob Jones'));
  });

  it('omits save when absent', () => {
    const decisions = { winner: { fullName: 'A' }, loser: { fullName: 'B' } };
    const result = buildMeta(decisions, { players: {} }, { players: {} });
    assert.ok(!result.includes('S:'));
  });
});

// ── Build Game Context ───────────────────────────────────

describe('buildGameContext', () => {
  const makeGame = (away, home, opts = {}) => ({
    gameType: opts.gameType || 'R',
    teams: {
      away: { team: { id: 1, abbreviation: away, teamName: away } },
      home: { team: { id: 2, abbreviation: home, teamName: home } }
    },
    seriesGameNumber: opts.seriesGameNumber || 1,
    gamesInSeries: opts.gamesInSeries || 3,
  });

  it('includes game type', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: null, capacity: null });
    assert.ok(ctx.includes('Regular Season'));
  });

  it('includes spring training note', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS', { gameType: 'S' }), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: null, capacity: null });
    assert.ok(ctx.includes('Spring Training'));
  });

  it('adds Mariners fan note for SEA games', () => {
    const ctx = buildGameContext(makeGame('SEA', 'HOU'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: null, capacity: null });
    assert.ok(ctx.includes('Mariners fan'));
  });

  it('no Mariners note for non-SEA games', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: null, capacity: null });
    assert.ok(!ctx.includes('Mariners fan'));
  });

  it('includes standings when available', () => {
    const standings = { NYY: { w: 50, l: 30, divRank: '1', div: 'American League East', gb: '0', streak: 'W3' } };
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), standings, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: null, capacity: null });
    assert.ok(ctx.includes('50-30'));
    assert.ok(ctx.includes('leading division'));
    assert.ok(ctx.includes('W3'));
  });

  it('includes series opener label', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: null, capacity: null });
    assert.ok(ctx.includes('Series opener'));
  });

  it('includes rubber match for game 3 tied 1-1', () => {
    const series = { gameNum: 3, seriesLen: 3, priorResults: [
      { awayId: 1, homeId: 2, awayWon: true, homeWon: false },
      { awayId: 1, homeId: 2, awayWon: false, homeWon: true },
    ]};
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, series, { attendance: null, capacity: null });
    assert.ok(ctx.includes('rubber match'));
  });

  it('includes sweep attempt', () => {
    const series = { gameNum: 3, seriesLen: 3, priorResults: [
      { awayId: 1, homeId: 2, awayWon: true, homeWon: false },
      { awayId: 1, homeId: 2, awayWon: true, homeWon: false },
    ]};
    const game = makeGame('NYY', 'BOS');
    const ctx = buildGameContext(game, {}, series, { attendance: null, capacity: null });
    assert.ok(ctx.includes('sweep attempt'));
  });

  it('includes near-sellout attendance', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: 40000, capacity: 41000 });
    assert.ok(ctx.includes('near sellout'));
  });

  it('includes sparse crowd attendance', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: 12000, capacity: 41000 });
    assert.ok(ctx.includes('sparse crowd'));
  });

  it('skips attendance in middle range', () => {
    const ctx = buildGameContext(makeGame('NYY', 'BOS'), {}, { gameNum: 1, seriesLen: 3, priorResults: [] }, { attendance: 30000, capacity: 41000 });
    assert.ok(!ctx.includes('Attendance'));
  });
});

// ── Attendance ───────────────────────────────────────────

describe('getAttendance', () => {
  it('extracts attendance from boxscore info', () => {
    const liveData = { boxscore: { info: [{ label: 'Att', value: '35,421' }] } };
    const result = getAttendance(liveData, 1);
    assert.equal(result.attendance, 35421);
    assert.equal(result.capacity, VENUE_CAPACITY[1]);
  });

  it('returns null when no attendance data', () => {
    const result = getAttendance({}, 1);
    assert.equal(result.attendance, null);
  });

  it('returns null capacity for unknown venue', () => {
    const result = getAttendance({}, 99999);
    assert.equal(result.capacity, null);
  });
});

// ── Render Box Score ─────────────────────────────────────

describe('renderBoxScore', () => {
  const makeBox = (players, battingOrder, pitchers) => ({
    players, battingOrder: battingOrder || [], pitchers: pitchers || []
  });

  it('renders batting and pitching tables', () => {
    const players = {
      ID1: {
        person: { id: 1, fullName: 'Test Player' },
        position: { abbreviation: 'SS' },
        stats: { batting: { atBats: 4, runs: 1, hits: 2, rbi: 1, baseOnBalls: 0, strikeOuts: 1, avg: '.300' } }
      },
      ID2: {
        person: { id: 2, fullName: 'Test Pitcher' },
        position: { abbreviation: 'P' },
        stats: { pitching: { inningsPitched: '6.0', hits: 5, runs: 2, earnedRuns: 2, baseOnBalls: 1, strikeOuts: 7, era: '3.00' } }
      }
    };
    const box = makeBox(players, [1], [2]);
    const html = renderBoxScore(box, makeBox({}, [], []), 'Away', 'Home');
    assert.ok(html.includes('Test Player'));
    assert.ok(html.includes('Test Pitcher'));
    assert.ok(html.includes('Away Batting'));
    assert.ok(html.includes('Home Batting'));
    assert.ok(html.includes('Totals'));
  });
});

// ── Incremental Mode: getExistingGamePks ─────────────────

describe('getExistingGamePks', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  let tmpDir, origCwd, origEnv;

  beforeEach(() => {
    origEnv = process.env.INCREMENTAL;
    origCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlb-test-'));
    process.chdir(tmpDir);
  });
  afterEach(() => {
    process.chdir(origCwd);
    process.env.INCREMENTAL = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty set when not incremental', () => {
    delete process.env.INCREMENTAL;
    assert.equal(getExistingGamePks().size, 0);
  });

  it('extracts final game PKs from HTML', () => {
    process.env.INCREMENTAL = 'true';
    fs.writeFileSync(path.join(tmpDir, 'index.html'), `
      <article class="game-card"><div id="box-111111"></div></article>
      <article class="game-card"><div id="box-222222"></div></article>
    `);
    const pks = getExistingGamePks();
    assert.equal(pks.size, 2);
    assert.ok(pks.has(111111));
    assert.ok(pks.has(222222));
  });

  it('excludes live game cards', () => {
    process.env.INCREMENTAL = 'true';
    fs.writeFileSync(path.join(tmpDir, 'index.html'), `
      <article class="game-card"><div id="box-111111"></div></article>
      <article class="game-card" data-live="true"><div id="box-333333"></div></article>
    `);
    const pks = getExistingGamePks();
    assert.equal(pks.size, 1);
    assert.ok(pks.has(111111));
    assert.ok(!pks.has(333333));
  });

  it('returns empty set when no index.html exists', () => {
    process.env.INCREMENTAL = 'true';
    assert.equal(getExistingGamePks().size, 0);
  });
});

// ── Incremental Mode: mergeCards ─────────────────────────

describe('mergeCards', () => {
  it('appends new cards to existing', () => {
    const existing = `<article class="game-card"><div id="box-111"></div></article>`;
    const newCards = ['<article class="game-card"><div id="box-222"></div></article>'];
    const result = mergeCards(existing, newCards);
    assert.equal(result.length, 2);
  });

  it('replaces live card with final version', () => {
    const existing = `<article class="game-card" data-live="true"><div id="box-111"></div></article>
<article class="game-card"><div id="box-222"></div></article>`;
    const newCards = ['<article class="game-card"><div id="box-111">FINAL VERSION</div></article>'];
    const result = mergeCards(existing, newCards);
    assert.equal(result.length, 2);
    assert.ok(result.some(c => c.includes('FINAL VERSION')));
    // The old live card should be gone
    assert.ok(!result.some(c => c.includes('data-live')));
  });

  it('handles empty existing HTML', () => {
    const result = mergeCards('', ['<article class="game-card"><div id="box-111"></div></article>']);
    assert.equal(result.length, 1);
  });
});
