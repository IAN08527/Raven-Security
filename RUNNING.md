# Project Raven — Complete Run Guide

## 1. Prerequisites Checklist

Ensure the following tools are installed on the machine:

- Node.js: v18+ or v20+ (https://nodejs.org/)
- Python: 3.10 to 3.14 (https://www.python.org/)
- Git: (https://git-scm.com/)
- (Optional for native desktop app): Rust & Cargo (https://rustup.rs/)
- (Optional for local AI/Graph): Ollama (phi3:mini) & Docker Desktop

## 2. Environment Configuration (.env)

Create or verify the `.env` file in the project root directory. Example contents:

```ini
# Supabase Cloud Database & Storage
SUPABASE_URL=https://nszgciwmpdejpvoywgav.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zemdjaXdtcGRlanB2b3l3Z2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MjIxOTEsImV4cCI6MjEwMzM5ODE5MX0.51S13yDH3yZKjZtIa63S9yvY13hogYCpGfJ8KMS2tlU
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zemdjaXdtcGRlanB2b3l3Z2F2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzgyMjE5MSwiZXhwIjoyMTAzMzk4MTkxfQ.hloR5h8A1M787NQ7B9p-ZDuMm1Le83mxvKJJn-XpPXQ
RAVEN_PG_DSN=postgresql://postgres.nszgciwmpdejpvoywgav:RavenPalantir%401234567890@aws-0-ap-south-1.pooler.supabase.co:6543/postgres
# Optional Configuration
LEDGER_PORT=8801
LEDGER_MODE=mock
RAVEN_NLP_MODE=auto
```

Save this file at the repository root as `.env`.

## 3. One-Time Dependency Installation

Open a terminal in the project root and run the following.

Root (frontend) dependencies:

```bash
npm install
```

Python engine dependencies:

```bash
cd engine
pip install -r requirements.txt
cd ..
```

Ledger gateway dependencies:

```bash
cd ledger/gateway
npm install
cd ../..
```

## 4. Running the Whole System (3 Terminal Tabs)

Open 3 terminal windows/tabs and run the following commands.

Terminal 1 — Ledger REST Gateway (port 8801)

PowerShell:

```powershell
cd ledger/gateway
$env:LEDGER_MODE="mock"
node server.js
# On Linux/macOS: LEDGER_MODE=mock node server.js
```

Expected output: logs containing `[gateway] LEDGER_MODE=mock` and `listening on :8801`.

Terminal 2 — Python Intelligence Engine (port 8756)

PowerShell / Bash:

```bash
cd engine
python -m uvicorn main:app --host 127.0.0.1 --port 8756
```

Expected output: Uvicorn running on http://127.0.0.1:8756

Terminal 3 — Frontend Web Dashboard (vite dev server, port 1420)

PowerShell / Bash:

```bash
npm run dev
```

Expected output: Local: http://127.0.0.1:1420/ (or similar vite output)

## 5. Access the Application

Open your browser and navigate to: http://localhost:1420

Key features to test:

- Interactive Criminal Network Graph: Toggle between Macro Graph and Ego Graph and click nodes (e.g., Rakesh Sawant).
- Evidence Drawer: Click any link/edge to inspect underlying FIR citations and transaction logs.
- Health Board: Click top-right status indicators to monitor backend connectivity.
- Data Seeder (optional): Run the (root) data seeder to populate demo cases:

```bash
python tools/seed_graph_demo.py
```

Files referenced in repository:

- Engine: [engine](engine)
- Ledger gateway: [ledger/gateway](ledger/gateway)
- Frontend: [src](src)
- Seeder script: [tools/seed_graph_demo.py](tools/seed_graph_demo.py)

## 6. Optional: Running as Native Desktop App (Tauri v2)

If you have Rust & required native build tools installed:

```powershell
npm run tauri dev
```

Notes & troubleshooting:

- If ports are already in use, update the corresponding `LEDGER_PORT` or frontend port in `vite.config.ts` and `.env` as needed.
- If Python dependencies fail to install, ensure you are using Python 3.10–3.14 and pip is up to date: `python -m pip install --upgrade pip`.
- For ledger gateway issues, verify `LEDGER_MODE` is set to `mock` in the environment when testing locally.

## 7. Next steps

- Commit `RUNNING.md` to your branch, or ask me to create a PR.
- Want me to run a quick smoke test (start the three services) in this environment? Reply and I will proceed.
