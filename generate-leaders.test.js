// generate-leaders.test.js — Tests for MLB Leaders generator

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { renderCard, esc, HITTING_CATS, PITCHING_CATS, STARTER_CATS, ESPN_LOGO_CODE, MAX_ROWS, MIN_GS, MIN_IP } = require('./generate-leaders.js');

// ── Helpers ──────────────────────────────────────────────

const makeLeader = (rank, name, value, abbr = 'SEA') => ({
  rank, value, person: { fullName: name },
  team: { abbreviation: abbr, fileCode: abbr.toLowerCase() }
});

// ── Category Definitions ─────────────────────────────────

describe('category definitions', () => {
  it('hitting categories have required fields', () => {
    for (const c of HITTING_CATS) {
      assert.ok(c.key, `missing key`);
      assert.ok(c.label, `missing label for ${c.key}`);
    }
  });

  it('pitching categories have required fields', () => {
    for (const c of PITCHING_CATS) {
      assert.ok(c.key, `missing key`);
      assert.ok(c.label, `missing label for ${c.key}`);
    }
  });

  it('ERA and WHIP are marked lower-is-better', () => {
    const era = PITCHING_CATS.find(c => c.key === 'earnedRunAverage');
    const whip = PITCHING_CATS.find(c => c.key === 'walksAndHitsPerInningPitched');
    assert.ok(era.lower);
    assert.ok(whip.lower);
  });

  it('no hitting categories are marked lower-is-better', () => {
    for (const c of HITTING_CATS) {
      assert.ok(!c.lower, `${c.key} should not be lower-is-better`);
    }
  });
});

describe('starter categories', () => {
  it('has ERA, WHIP, and K/9', () => {
    const stats = STARTER_CATS.map(c => c.stat);
    assert.ok(stats.includes('earnedRunAverage'));
    assert.ok(stats.includes('walksAndHitsPerInningPitched'));
    assert.ok(stats.includes('strikeoutsPer9Inn'));
  });

  it('ERA and WHIP are lower-is-better', () => {
    assert.ok(STARTER_CATS.find(c => c.stat === 'earnedRunAverage').lower);
    assert.ok(STARTER_CATS.find(c => c.stat === 'walksAndHitsPerInningPitched').lower);
  });

  it('has reasonable IP and GS minimums', () => {
    assert.ok(MIN_GS >= 2);
    assert.ok(MIN_IP >= 10);
  });
});

// ── ESPN Logo Code ───────────────────────────────────────

describe('ESPN_LOGO_CODE', () => {
  it('maps AZ to ari', () => {
    assert.equal(ESPN_LOGO_CODE['AZ'], 'ari');
  });
});

// ── renderCard ───────────────────────────────────────────

describe('renderCard', () => {
  it('renders a card with leaders', () => {
    const leaders = [makeLeader(1, 'Julio Rodriguez', '.350', 'SEA')];
    const html = renderCard({ key: 'battingAverage', label: 'Batting Average' }, leaders);
    assert.ok(html.includes('Batting Average'));
    assert.ok(html.includes('Julio Rodriguez'));
    assert.ok(html.includes('.350'));
    assert.ok(html.includes('sea.png'));
    assert.ok(html.includes('SEA'));
  });

  it('shows "No data available" for empty leaders', () => {
    const html = renderCard({ key: 'test', label: 'Test' }, []);
    assert.ok(html.includes('No data available'));
  });

  it('caps rows at MAX_ROWS', () => {
    const leaders = Array.from({ length: 20 }, (_, i) => makeLeader(i + 1, `Player ${i}`, i));
    const html = renderCard({ key: 'test', label: 'Test' }, leaders);
    const rows = html.match(/<tr>/g) || [];
    assert.equal(rows.length, MAX_ROWS);
  });

  it('shows lower-is-better note when cat.lower is true', () => {
    const html = renderCard({ key: 'era', label: 'ERA', lower: true }, [makeLeader(1, 'Ace', '1.50')]);
    assert.ok(html.includes('lower is better'));
  });

  it('does not show lower-is-better note when cat.lower is falsy', () => {
    const html = renderCard({ key: 'hr', label: 'Home Runs' }, [makeLeader(1, 'Slugger', '15')]);
    assert.ok(!html.includes('lower is better'));
  });

  it('uses ESPN_LOGO_CODE override for AZ', () => {
    const html = renderCard({ key: 'test', label: 'Test' }, [makeLeader(1, 'Player', '5', 'AZ')]);
    assert.ok(html.includes('ari.png'));
  });

  it('handles missing team abbreviation gracefully', () => {
    const leader = { rank: 1, value: '10', person: { fullName: 'Test' }, team: {} };
    const html = renderCard({ key: 'test', label: 'Test' }, [leader]);
    assert.ok(html.includes('Test'));
    // Should not crash
  });

  it('escapes HTML in player names', () => {
    const html = renderCard({ key: 'test', label: 'Test' }, [makeLeader(1, 'O\'Brien <script>', '5')]);
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});
