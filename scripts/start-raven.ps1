# One-click launcher: brings up every dependency Raven needs, then opens
# the desktop app. Safe to run repeatedly -- each step is a no-op if that
# piece is already up. Local-machine only; never exposes anything beyond
# localhost (CLAUDE.md rule 6: on-premises, no third-party network calls).
#
# Native-command note: never redirect a native exe's stderr in this script
# (2>&1, 2>$null, *>$null all wrap it as a PowerShell ErrorRecord in 5.1 and
# make success look like failure). Check $LASTEXITCODE instead.

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Step($message) {
    Write-Host ">> $message" -ForegroundColor Cyan
}

function Test-PortOpen($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", $port)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Test-DockerUp {
    docker info 2>$null 1>$null
    return ($LASTEXITCODE -eq 0)
}

# 1. Docker Desktop (needed by both `supabase start` and the compose stack).
Write-Step "Checking Docker Desktop..."
if (-not (Test-DockerUp)) {
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Write-Step "Starting Docker Desktop (first launch can take a minute)..."
        Start-Process -FilePath $dockerExe
        $waited = 0
        while (-not (Test-DockerUp) -and $waited -lt 120) {
            Start-Sleep -Seconds 3
            $waited += 3
        }
    }
    if (-not (Test-DockerUp)) {
        Write-Host "Docker did not come up in time. Start Docker Desktop manually and re-run this script." -ForegroundColor Red
        exit 1
    }
}

# 2. Supabase local stack (Postgres+RLS, GoTrue auth, Studio).
Write-Step "Starting Supabase local stack..."
Push-Location $root
supabase start 1>$null
Pop-Location

# 3. Project infra (Neo4j, mock ledger, basemap tiles).
Write-Step "Starting Neo4j / ledger / basemap containers..."
docker compose -f "$root\infra\compose\all-in-one.yml" up -d 1>$null

# 4. Raven server (release build), only if not already listening.
if (Test-PortOpen 8443) {
    Write-Step "Server already running on :8443."
} else {
    Write-Step "Starting Raven server..."
    Get-Content "$root\server\.env" | Where-Object { $_ -notmatch '^\s*#' -and $_ -match '=' } |
        ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v }
    Start-Process -FilePath "$root\target\release\raven-server.exe" `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$logDir\server_stdout.log" `
        -RedirectStandardError "$logDir\server_stderr.log"

    $waited = 0
    while (-not (Test-PortOpen 8443) -and $waited -lt 30) {
        Start-Sleep -Seconds 1
        $waited += 1
    }
    if (-not (Test-PortOpen 8443)) {
        Write-Host "Server did not come up -- check logs\server_stderr.log" -ForegroundColor Red
        exit 1
    }
}

# 5. Desktop app.
$desktopExe = "$root\target\release\raven-desktop.exe"
$running = Get-Process -Name raven-desktop -ErrorAction SilentlyContinue
if ($running) {
    Write-Step "Raven desktop window is already open."
} else {
    Write-Step "Launching Raven..."
    Start-Process -FilePath $desktopExe -WorkingDirectory $root
}

Start-Sleep -Seconds 1
