# MLB Summaries — Specification

A single, scrollable web page that recaps every MLB game on a given day. For each game: a scoreboard header, a narrative summary highlighting key plays and players, and a full box score. Think of it as a digital version of the newspaper sports page — dense, scannable, no clicking around.

## Functional Requirements

### Per-Game Card

Each game is rendered as a card with these sections in order:

1. **Scoreboard header** — stacked two-row mini scoreboard (away on top, home on bottom) with team logo, team name (no city), and R / H / E columns. A "Final" label sits above the rows. The winning team's row is visually emphasized (bolder weight, subtle background). No separate text title — the scoreboard *is* the title.

2. **Narrative summary** — 2–3 short paragraphs of original, AI-generated prose. Must read like a real newspaper game recap, not a stat dump. Rules:
   - Start with the turning point or decisive moment — do NOT restate the final score.
   - Name the players involved in key hits, pitching moments, and defensive plays.
   - Mention the go-ahead play, biggest inning, late-game tension, and bullpen escape if applicable.
   - No inning-by-inning narration unless needed for flow.
   - No robotic phrasing ("In the top of the 5th, Team X scored 2 runs").
   - No redundancy with the box score.
   - Cap at 1–3 key hitters named per summary.
   - All facts must come from real game data (play-by-play, scoring plays, box score). No fabricated events.

3. **Compact footer line** — one line:
   ```
   W: Kirby • L: Eovaldi • Key hitters: Raleigh 2-4, HR, 2 RBI; Rodríguez 2-5, 2 R
   ```
   - Winning pitcher name, losing pitcher name (no stats unless they add something).
   - 1–3 key hitters with slash line highlights. Keep it editorial, not a second box score.

4. **Full box score** — collapsible (collapsed by default), containing:
   - **Batting**: both teams. Columns: Player, Pos, AB, R, H, RBI, BB, SO, AVG.
   - **Pitching**: both teams. Columns: Player, IP, H, R, ER, BB, SO, ERA.
   - Innings pitched use baseball notation: `5` not `5.0`; `5 1/3` not `5.1`; `5 2/3` not `5.2`.

### Game Ordering

Games are sorted in this priority:
1. Mariners games first (any game where SEA is home or away).
2. Other AL West teams (HOU, LAA, TEX, ATH).
3. Remaining AL teams (East, then Central).
4. NL teams (West, East, Central).

Within each group, order by game start time.

### Date Selection

- The page supports viewing **today** and **yesterday**.
- Default on load: **yesterday** (the common morning-coffee use case).
- Toggle buttons at the top: "Yesterday" / "Today".
- Only completed (Final) games are shown. In-progress or scheduled games are hidden.

### Page Header

- Title: "MLB Yesterday" or "MLB Today" depending on selection.
- Date displayed below the title.
- No explanatory text, notes, or disclaimers.

## Non-Functional Requirements

1. **Hosting**: GitHub Pages (static site, zero hosting cost). Repo: https://github.com/craigrow/MLB_Summaries
2. **Page load**: must render within a few seconds on a mobile device.
3. **Cost**: minimize operational cost. The only acceptable recurring cost is LLM API calls for summary generation.
4. **No copyrighted content**: summaries are original, generated from structured data. No scraped editorial recaps.

## Data Source

**MLB Stats API** (`statsapi.mlb.com`) — free, public, no auth required.

Key endpoints:
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/schedule?date=YYYY-MM-DD&sportId=1&hydrate=linescore,decisions` | Day's games with linescore and W/L/S decisions |
| `GET /api/v1.1/game/{gamePk}/feed/live` | Full live feed: play-by-play (`liveData.plays.allPlays`), scoring plays (`liveData.plays.scoringPlays`), boxscore (`liveData.boxscore`), linescore (`liveData.linescore`), decisions (`liveData.decisions`) |
| `GET /api/v1/game/{gamePk}/boxscore` | Standalone boxscore (alternative to live feed) |
| `GET /api/v1/teams?sportId=1&season=YYYY` | Team metadata: abbreviation, teamName, division, league |

Key data shapes:
- **Scoring play**: `allPlays[index].result.description` contains natural-language play description with player names, e.g. *"Mark Vientos homers (1) on a fly ball to left center field."*
- **Decisions**: `liveData.decisions.winner.fullName`, `.loser.fullName`, `.save.fullName`
- **Batting stats**: `boxscore.teams.{away|home}.players.ID{playerId}.stats.batting` → atBats, hits, runs, rbi, baseOnBalls, strikeOuts, avg
- **Pitching stats**: `...stats.pitching` → inningsPitched, hits, runs, earnedRuns, baseOnBalls, strikeOuts, era
- **Batting order**: `boxscore.teams.{away|home}.battingOrder` (array of player IDs)
- **Pitchers**: `boxscore.teams.{away|home}.pitchers` (array of player IDs, in game order)
- **Team name (no city)**: `team.teamName` (e.g. "Mets") or `team.clubName`
- **Team abbreviation**: `team.abbreviation` (e.g. "NYM")
- **Division**: `team.division.id` — AL West=200, AL East=201, AL Central=202, NL West=203, NL East=204, NL Central=205
- **League**: `team.league.id` — AL=103, NL=104

Team logos: `https://a.espncdn.com/i/teamlogos/mlb/500/{fileCode}.png` where fileCode = team.fileCode (e.g. "nym", "sea", "lad"). These are hotlinked from ESPN's CDN — functional but could break. Consider self-hosting copies as a future improvement.

## Architecture

### Option A: Client-Side Only (Current Prototype Direction)

A single `index.html` with inline CSS and JS. On page load:
1. Fetch schedule for selected date from MLB Stats API.
2. Filter to completed games only.
3. For each game, fetch the live feed to get scoring plays, boxscore, and decisions.
4. Sort games per ordering rules.
5. Render cards with scoreboard, summary, footer, and collapsible box score.

**Summary generation**: This is the hard part. Client-side options:
- **Algorithmic**: Parse scoring plays and build template-driven prose. Fast, free, but limited narrative quality. The prototype's current summaries are generic and don't mention players — this approach tends to produce that.
- **Client-side LLM call**: Call an LLM API (OpenAI, Anthropic, Bedrock) from the browser with scoring plays + box score as context. Produces high-quality recaps but requires an API key exposed in client-side code (security concern) and costs money per page load.

### Option B: Static Site with Build Pipeline (Recommended)

A GitHub Action runs on a schedule (e.g., daily at 7 AM PT and 1 AM PT):
1. Fetches yesterday's completed games from MLB Stats API.
2. For each game, fetches live feed data.
3. Sends scoring plays + box score context to an LLM to generate the narrative summary.
4. Renders a static `index.html` with all game cards pre-built.
5. Commits and pushes to the repo, triggering GitHub Pages deployment.

**Advantages**:
- API key stays in GitHub Secrets (secure).
- LLM called once per game per day (cost-controlled).
- Page loads instantly (no API calls at render time).
- Works offline after initial load.

**Disadvantages**:
- "Today" view requires either a second build or a hybrid approach (static yesterday + client-side today).
- Slight delay between games finishing and page updating.

**Hybrid variant**: Static HTML for yesterday (pre-built), plus client-side JS for today's games that fetches live from MLB API (no LLM summaries for today — just scoreboard + box score, or use algorithmic summaries).

### Decision Needed

The owner should choose between:
- **Pure client-side** (simpler, but summary quality limited or API key exposed)
- **Build pipeline** (better summaries, secure, but more infrastructure)
- **Hybrid** (best of both — recommended)

## Visual Design

Based on the prototype at `index.html` in this repo:

- Light background (`#f3f4f6`), white cards with subtle shadow, rounded corners (16px).
- System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).
- Max width 860px, centered. Responsive: 2-column grid on desktop (≥760px), single column on mobile.
- Scoreboard: bordered rounded box, "Final" label in muted gray header, R/H/E column headers, team rows with 30px logos.
- Winner row: slightly bolder weight + subtle background tint.
- Summary: ~1rem font, 1.55 line-height.
- Meta footer: muted gray, separated by top border.
- Box score (new): compact table, collapsed by default with a toggle control.

## Innings Pitched Formatting

Display innings pitched in baseball notation:
| API value | Display |
|---|---|
| `5.0` | `5` |
| `5.1` | `5 1/3` |
| `5.2` | `5 2/3` |
| `0.1` | `0 1/3` |
| `0.2` | `0 2/3` |

```javascript
function formatIP(ip) {
  const [whole, frac] = String(ip).split('.');
  const f = parseInt(frac || '0', 10);
  if (f === 0) return whole;
  if (f === 1) return `${whole} 1/3`;
  if (f === 2) return `${whole} 2/3`;
  return String(ip);
}
```

## Summary Generation Prompt (for LLM-based approach)

When sending game data to an LLM for summary generation, use this system prompt:

```
Write a short baseball game recap in natural newspaper-style English.

Rules:
- Start with the key turning point or decisive stretch of the game.
- Name the players involved in the big hits or pitching moments.
- Do not restate the final score in the opening sentence.
- Do not narrate inning-by-inning unless needed for flow.
- Avoid robotic phrasing, bullet-style prose, and redundancy.
- Sound like a real game recap, not a box score.
- Keep it to 2 short paragraphs.
- All player names and events must come from the provided data. Do not invent any facts.
```

The user message should include: scoring plays (with descriptions), decisions (W/L/S), key batting lines (top 2-3 hitters by hits+RBI), and the final score for context.

## File Structure

Current:
```
/
  index.html          ← prototype (static, hardcoded March 20 2026 spring training data)
  index-old.html      ← earlier iterations
  index-old2.html
  index-old3.html
  index-old4.html
  Specification.md    ← this file
```

Target (build pipeline approach):
```
/
  index.html          ← generated static page (output of build)
  generate.js         ← Node script: fetches data, calls LLM, renders HTML
  template.html       ← HTML/CSS template (or inline in generate.js)
  .github/
    workflows/
      build.yml       ← GitHub Action: runs generate.js on schedule
  Specification.md
```

Target (client-side approach):
```
/
  index.html          ← single file with inline CSS + JS, fetches MLB API at runtime
  Specification.md
```

## Open Questions

1. **LLM provider**: OpenAI, Anthropic Claude, or Amazon Bedrock? Affects cost and API setup.
2. **"Today" view**: Should today show in-progress games with partial data, or only completed games?
3. **Team logos**: Continue hotlinking ESPN CDN, or self-host copies for reliability?
4. **Build schedule**: If using GitHub Actions, what times should it run? Suggestion: 1 AM PT (after West Coast games) and 7 AM PT (morning refresh).
