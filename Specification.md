# MLB Summaries — Specification

A single, scrollable web page that recaps every MLB game on a given day. For each game: a scoreboard header, a narrative summary highlighting key plays and players, and a full box score. Think of it as a digital version of the newspaper sports page — dense, scannable, no clicking around.

Live at: https://craigrow.github.io/MLB_Summaries/

## Current Architecture

**Build pipeline (Option B — implemented)** with plans for a hybrid approach.

### How It Works Today

1. A **GitHub Action** (`.github/workflows/build.yml`) runs daily at **1 AM PT** and **7 AM PT**, plus on manual trigger.
2. `generate.js` (Node.js) runs in the Action:
   - Fetches yesterday's completed games from the MLB Stats API.
   - For each game, fetches the live feed (play-by-play, boxscore, decisions).
   - Sorts games per ordering rules (Mariners first → AL West → AL → NL).
   - Sends scoring plays + box score context to **OpenAI GPT-4o-mini** to generate narrative summaries.
   - Renders a fully static `index.html` with all game cards.
   - Commits and pushes to `main`, triggering GitHub Pages deployment.
3. The **OpenAI API key** is stored as a GitHub Secret (`OPENAI_API_KEY`).

### Rate Limiting

The OpenAI account is on Tier 1 with a **3 requests per minute** limit for GPT-4o-mini. `generate.js` handles this with:
- A **22-second delay** between LLM calls to stay under the RPM cap.
- **Retry with backoff** (up to 3 attempts, 25s/50s/75s waits) on 429 responses.
- Total generation time for a full 15-game slate: ~6 minutes.

As usage history builds, OpenAI will auto-upgrade the tier and the delay can be reduced.

### File Structure

```
/
  index.html              ← generated static page (output of build pipeline)
  generate.js             ← Node script: fetches MLB data, calls GPT-4o-mini, renders HTML
  .github/
    workflows/
      build.yml           ← GitHub Action: scheduled + manual trigger
  .nojekyll               ← prevents Jekyll processing on GitHub Pages
  Specification.md        ← this file
```

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
   - Use "the" before team names in prose (e.g., "the Mariners rallied").

3. **Compact footer line** — one line:
   ```
   W: Kirby • L: Eovaldi • Key hitters: Raleigh 2-for-4, HR, 2 RBI; Rodríguez 2-for-5, 2 R
   ```
   - Winning pitcher name, losing pitcher name.
   - 1–3 key hitters with "X-for-Y" format (not "X-Y"). Keep it editorial, not a second box score.

4. **Full box score** — collapsible (collapsed by default), containing:
   - **Batting**: both teams. Columns: Player, Pos, AB, R, H, RBI, BB, SO, AVG.
   - **Pitching**: both teams. Columns: Player, IP, H, R, ER, BB, SO, ERA.
   - Innings pitched use baseball fraction notation: `5`, `5 ⅓`, `5 ⅔` (Unicode fractions, not decimals).

### Game Ordering

Games are sorted using this priority map:

```javascript
const SORT_ORDER = {SEA:0,HOU:1,LAA:2,TEX:3,ATH:4,OAK:4,
  BAL:10,BOS:11,NYY:12,TB:13,TOR:14,
  CLE:20,CWS:21,DET:22,KC:23,MIN:24,
  AZ:30,COL:31,LAD:32,SD:33,SF:34,
  ATL:40,MIA:41,NYM:42,PHI:43,WSH:44,
  CHC:50,CIN:51,MIL:52,PIT:53,STL:54};
```

Mariners first, then AL West, AL East, AL Central, NL West, NL East, NL Central.

### Date Selection

- Default: **yesterday** (the morning-coffee use case).
- Only completed (Final) games are shown.

### Page Header

- No explanatory text, notes, or disclaimers at the top.
- Date displayed contextually.

## Data Source

**MLB Stats API** (`statsapi.mlb.com`) — free, public, no auth required.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/schedule?date=YYYY-MM-DD&sportId=1&hydrate=team,linescore,decisions` | Day's games with linescore and W/L/S decisions |
| `GET /api/v1.1/game/{gamePk}/feed/live` | Full live feed: play-by-play, scoring plays, boxscore, linescore, decisions |

Key data shapes:
- **Scoring play**: `allPlays[index].result.description` — natural-language play description with player names.
- **Decisions**: `liveData.decisions.winner.fullName`, `.loser.fullName`, `.save.fullName`
- **Batting stats**: `boxscore.teams.{away|home}.players.ID{playerId}.stats.batting`
- **Pitching stats**: `...stats.pitching` → `inningsPitched` (string like "5.1")
- **Team name (no city)**: `team.teamName` (e.g., "Mets")
- **Team abbreviation**: `team.abbreviation` (e.g., "NYM")
- **Team logos**: `https://a.espncdn.com/i/teamlogos/mlb/500/{fileCode}.png` (hotlinked from ESPN CDN)

### Innings Pitched Formatting

```javascript
function formatIP(ip) {
  const [whole, frac] = String(ip).split('.');
  const f = parseInt(frac || '0', 10);
  if (f === 0) return whole;
  if (f === 1) return `${whole} ⅓`;
  if (f === 2) return `${whole} ⅔`;
  return String(ip);
}
```

## Summary Generation

### LLM Prompt

System prompt sent to GPT-4o-mini:

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

The user message includes: scoring play descriptions, W/L/S decisions, key hitters (top performers by hits+RBI), and the final score.

### Key Hitters Selection

`generate.js` scans **all players** on both teams (not just the batting order) to catch pinch-hit contributions. Selects top performers by hits + RBI.

## Visual Design

- Light background (`#f3f4f6`), white cards with subtle shadow, rounded corners (16px).
- System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).
- Max width 860px, centered. Responsive: 2-column grid on desktop (≥760px), single column on mobile.
- Scoreboard: bordered rounded box, "Final" label in muted gray header, R/H/E column headers, team rows with 30px logos.
- Winner row: bolder weight + subtle background tint.
- Summary: ~1rem font, 1.55 line-height.
- Meta footer: muted gray, separated by top border.
- Box score: compact table, collapsed by default with a toggle control.

## GitHub Infrastructure

- **Repo**: https://github.com/craigrow/MLB_Summaries
- **GitHub Pages**: deployed from `main` branch, site at https://craigrow.github.io/MLB_Summaries/
- **Secret**: `OPENAI_API_KEY` — OpenAI platform API key (Tier 1 account)
- **Workflow schedule**: cron `0 8,14 * * *` (8:00 and 14:00 UTC = 1 AM and 7 AM PT)
- **`.nojekyll`**: present in repo root to prevent Jekyll processing

## Known Issues & Next Steps

### Must Do
1. **Verify LLM summaries end-to-end** — the rate-limit retry + pacing logic was just added. The next workflow run should produce summaries for all games. Trigger manually and check the Actions log for `Summary generated` on every game.
2. **Fallback for LLM failures** — if OpenAI returns an error after retries, `generate.js` currently outputs no summary for that game. Should fall back to algorithmic summaries (the logic exists in the client-side `index.html` prototype and could be ported).
3. **Restore "today" view** — `generate.js` overwrites `index.html` with yesterday's static content, so there's no way to see today's games. Recommended approach: hybrid page with static yesterday section + client-side JS that fetches today's games from MLB API at runtime (with algorithmic summaries, no LLM needed).

### Nice to Have
4. **Reduce inter-request delay** — once OpenAI auto-upgrades the account tier (higher RPM), reduce or remove the 22-second delay between calls.
5. **Self-host team logos** — currently hotlinked from ESPN CDN. Could break. Copy to repo for reliability.
6. **Summary quality iteration** — review generated summaries and tune the prompt, temperature (currently 0.7), or max_tokens (currently 300) as needed.
7. **Today/yesterday toggle UI** — add toggle buttons once the hybrid approach is implemented.

## Development Notes

### Running Locally

```bash
# Test generate.js locally (requires OPENAI_API_KEY env var)
OPENAI_API_KEY=sk-... node generate.js

# Output: writes index.html to current directory
```

### Triggering a Build

Go to https://github.com/craigrow/MLB_Summaries/actions → "Generate MLB Digest" → "Run workflow" → select `main` branch → click "Run workflow".

### Client-Side Prototype

The original `index.html` (before being overwritten by `generate.js`) contained a fully functional client-side version with:
- Runtime fetching from MLB Stats API
- Algorithmic summary generation from scoring plays
- Today/yesterday toggle
- All the same scoreboard, box score, and meta footer rendering

This code is preserved in git history and can be referenced for the hybrid approach or as a fallback engine.
