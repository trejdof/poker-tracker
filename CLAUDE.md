# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development server
source venv/bin/activate
python run.py

# Production server (use threading mode for SSE — no_chips mode requires persistent connections)
gunicorn -w 1 --threads 20 -b 0.0.0.0:5000 run:app

# Database migration (adds missing columns + creates tables, safe to re-run)
python migrate.py

# Manual backup (automated via cron daily at 3am)
# backup.sh keeps last 15 backups in backups/
```

No test suite or linting is configured.

## Architecture

Flask SPA — the entire frontend is a single `index.html` assembled from Jinja2 `include` directives at startup. Client-side JS handles routing via `history.pushState`; all URLs (`/game/:id`, `/settlement/:id`, `/player/:name`) are caught by a catch-all Flask route that re-serves `index.html`.

**Auth:** Single-password gate (`APP_PASSWORD` in `.env`). Set via `POST /login`, cleared via `GET /logout`.

**Database:** SQLite at `instance/poker.db`, accessed via Flask-SQLAlchemy. No Flask-Migrate — schema changes go through `migrate.py`.

**API blueprint** mounted at `/api` — four route files: `players`, `sessions`, `transactions`, `qr`.

## Data Model

```
Player ──< SessionPlayer ──< Buyin
Session ──< SessionPlayer
Session ──< Transaction (settlement records)
Transaction → from_player_id, to_player_id (both FK → Player)
```

**Session lifecycle:** `waiting` → `open` (via `/start`) → `closed` (via `/finalize`). Closed sessions can be reopened with `/unfinalize` if no transactions are confirmed yet. Soft-delete is available (`deleted` flag).

**Buyin types:** `buyin`, `rebuy`, `cashout`, `transfer_in`, `transfer_out`. Net chip position per player is the sum of all their Buyins for a session.

**Settlement:** `app/utils/settlement.py` runs a greedy debt-minimisation algorithm over the closed session's chip positions to produce the minimum number of `Transaction` records. Confirming a transaction updates `Player.total_balance` on both sides.

### No-Chips mode

Session type `no_chips` uses a separate data model and real-time SSE. Players start at stack 0; blinds auto-deduct, bets go negative, wins go positive.

```
Session (type=no_chips) ──< Hand ──< HandBet
```

**Hand lifecycle:** `open` (button holder starts) → `closed` (button holder ends + picks winner). Button rotates each hand. Remainder from split carries over to next hand's pot.

**HandBet types:** `blind_sb`, `blind_bb`, `bet`, `win`. Player stack = sum of all their HandBets across all hands.

**SSE stream:** `GET /api/sessions/<id>/stream` — server polls DB every 0.5s and pushes state JSON on change. Requires Gunicorn threading mode (`--threads 20`) for concurrent connections.

**Routes prefix:** `/api/sessions/<id>/` — `no-chips-state`, `start-no-chips`, `hands`, `hands/<id>/bet`, `hands/<id>/revert`, `hands/<id>/end`, `stream`.

**Frontend:** `no_chips.js` + `no_chips.css`. Player identity stored in `localStorage` keyed by session id. Join screen lets any logged-in user claim a seat (no account needed, multiple users can claim same seat).

## Frontend

Vanilla JS modules in `app/static/js/` — no build step, no bundler. Each page has a corresponding JS file (`session.js`, `settlement.js`, etc.) plus shared helpers in `utils.js` (e.g. `stepAmount`, `showToast`, `balanceClass`).

CSS is custom dark-theme (`#0f1117` background, `#c9a84c` gold accents), no framework. Modals are toggled via visibility classes, not a library.

QR codes (`qrcode[pil]`) are generated server-side for NBS bank transfer payloads and served as PNG from `/api/players/<id>/qr/<amount>`.
