param(
    [string]$HostName = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$SkipInstall,
    [switch]$SkipBuildUi,
    [switch]$SkipMigrate,
    [switch]$SkipRun
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$ActivateScript = Join-Path $Root ".venv\Scripts\Activate.ps1"
$EnvFile = Join-Path $Root ".env"
$EnvExample = Join-Path $Root ".env.example"

Set-Location $Root

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-ProjectPython {
    param([string[]]$Arguments)
    & $VenvPython @Arguments
}

Write-Step "Preparing virtual environment"
if (-not (Test-Path $VenvPython)) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        py -3 -m venv .venv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        python -m venv .venv
    } else {
        throw "Python was not found. Install Python 3.13 or add it to PATH."
    }
}

if (-not (Test-Path $ActivateScript)) {
    throw "Virtual environment was not created correctly: $ActivateScript is missing."
}

Write-Step "Using project Python"
Invoke-ProjectPython -Arguments @("--version")

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host ".env was created from .env.example." -ForegroundColor Yellow
    }
    throw "Fill DB_NAME, DB_USER, DB_PASSWORD, DB_HOST and DB_PORT in .env, then run this script again."
}

if (-not $SkipInstall) {
    Write-Step "Checking Python dependencies"
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Invoke-ProjectPython -Arguments @("-c", "import django, django_rq, redis, rq, rest_framework, psycopg") 2>$null
    $DependencyCheckExitCode = $LASTEXITCODE
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($DependencyCheckExitCode -ne 0) {
        Write-Step "Installing Python dependencies"
        Invoke-ProjectPython -Arguments @("-m", "pip", "install", "--upgrade", "pip")
        Invoke-ProjectPython -Arguments @("-m", "pip", "install", "-r", "requirements\local.txt")
    }

    if (-not (Test-Path (Join-Path $Root "node_modules"))) {
        Write-Step "Installing frontend dependencies"
        npm install
    }
}

if (-not $SkipBuildUi) {
    Write-Step "Building React UI"
    npm run build:ui
}

Write-Step "Checking Django configuration"
Invoke-ProjectPython -Arguments @("manage.py", "check")

Write-Step "Checking database connection"
Invoke-ProjectPython -Arguments @("scripts\check_db.py")

if (-not $SkipMigrate) {
    Write-Step "Applying migrations"
    Invoke-ProjectPython -Arguments @("manage.py", "migrate")
}

Write-Step "Starting development server"
Write-Host "Open http://${HostName}:$Port/" -ForegroundColor Green
if ($SkipRun) {
    Write-Host "SkipRun is enabled; server was not started." -ForegroundColor Yellow
} else {
    Invoke-ProjectPython -Arguments @("manage.py", "runserver", "${HostName}:$Port")
}
