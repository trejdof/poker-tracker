# Pokerica

A self-hosted poker session tracker built for Raspberry Pi. Manage players, run live cash game or tournament sessions, track buy-ins and cash-outs, and automatically calculate the minimum number of payments needed to settle up after each game.

---

## Features

- **Player management** — register players with names and bank account numbers for easy transfers
- **Session types** — supports Cash Game and Tournament sessions
- **Live game screen** — real-time session timer, system clock, chip count mismatch detection, per-player buy-in and net tracking
- **In-session actions** — rebuy, transfer chips between players, cash out, remove player
- **Smart settlement** — automatically computes the fewest possible transactions to settle all debts after a game ends
- **QR code payments** — generates QR codes for bank transfers so players can pay directly from their phones
- **Settlement confirmation** — mark individual transactions as paid/unpaid; balances update accordingly
- **Player profiles** — per-player stats with cumulative P&L chart (7D / 30D / 3M / 6M / All time) and full game history
- **Password protection** — simple single-password login gate for the whole app
- **Database backup** — download the SQLite database directly from the browser; automated daily backups kept on server (last 15 retained)
- **Client-side routing** — deep-linkable URLs (`/game/:id`, `/settlement/:id`, `/player/:name`)
- **Responsive** — works on desktop and mobile

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3, Flask, Flask-SQLAlchemy |
| Database | SQLite |
| Frontend | Vanilla JS, HTML, CSS (no framework) |
| Server | Gunicorn |
| Platform | Raspberry Pi (DietPi) |

---

## Project Structure

```
pokerica/
├── app/
│   ├── __init__.py          # App factory, auth, routes
│   ├── database.py
│   ├── models/              # SQLAlchemy models
│   │   ├── player.py
│   │   ├── session.py
│   │   ├── session_player.py
│   │   ├── buyin.py
│   │   └── transaction.py
│   ├── routes/              # API blueprints
│   │   ├── players.py
│   │   ├── sessions.py
│   │   ├── transactions.py
│   │   └── qr.py
│   ├── utils/
│   │   └── settlement.py    # Debt minimization algorithm
│   ├── static/
│   │   ├── css/             # Per-page stylesheets + global
│   │   └── js/              # Per-page JS modules
│   └── templates/
│       ├── index.html
│       ├── login.html
│       ├── pages/           # Page fragments (Jinja2 includes)
│       └── modals/          # Modal fragments
├── instance/
│   └── poker.db             # SQLite database (auto-created)
├── backups/                 # Automated daily backups
├── backup.sh                # Backup script (run via cron)
├── requirements.txt
└── run.py
```

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd pokerica
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
SECRET_KEY=your-secret-key
APP_PASSWORD=your-login-password
```

### 3. Run (development)

```bash
python run.py
```

### 4. Run (production with Gunicorn)

```bash
gunicorn -w 2 -b 0.0.0.0:5000 run:app
```

---

## Automated Backups

The `backup.sh` script copies the database to `backups/` with a timestamp and retains the last 15 backups. To schedule it daily via cron:

```bash
crontab -e
```

Add:

```
0 3 * * * /home/dietpi/poker-tracker/backup.sh
```

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/players` | List all players |
| POST | `/api/players` | Create player |
| PUT | `/api/players/:id` | Update player |
| DELETE | `/api/players/:id` | Delete player |
| GET | `/api/players/:name/profile` | Player profile + game history |
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/:id` | Get session detail |
| POST | `/api/sessions/:id/end` | End session (triggers settlement) |
| DELETE | `/api/sessions/:id` | Soft-delete session |
| POST | `/api/sessions/:id/restore` | Restore deleted session |
| POST | `/api/transactions/:id/confirm` | Mark transaction as paid |
| POST | `/api/transactions/:id/unconfirm` | Mark transaction as unpaid |
| GET | `/api/qr/:player_id/:amount` | Generate payment QR code |
| GET | `/backup` | Download database file |
