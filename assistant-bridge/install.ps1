# Prepares the assistant service's folder on the server. Safe to run again: it never overwrites your edited
# INSTRUCTIONS.md, the saved secret, or the Claude sign-in. Run it from a normal PowerShell (no admin needed):
#   powershell -ExecutionPolicy Bypass -File assistant-bridge\install.ps1
param(
  [string]$Root = 'C:\Users\Host\Desktop\main\tools\assistant',
  [switch]$UpdateCli
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($d in @($Root, "$Root\workspace", "$Root\claude-home", "$Root\claude", "$Root\logs")) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

# the service's code is replaced on every run; the rulebook is only created once, so edits to it survive
foreach ($f in 'server.mjs', 'bridge-core.mjs', 'mcp-afro.mjs') { Copy-Item -LiteralPath "$here\$f" -Destination "$Root\$f" -Force }
if (-not (Test-Path -LiteralPath "$Root\INSTRUCTIONS.md")) { Copy-Item -LiteralPath "$here\INSTRUCTIONS.md" -Destination "$Root\INSTRUCTIONS.md" }

# a fixed copy of the Claude CLI: the one bundled with the desktop app sits in a folder named after its version,
# which changes whenever the app updates
$cli = "$Root\claude\claude.exe"
if ($UpdateCli -or -not (Test-Path -LiteralPath $cli)) {
  $found = Get-ChildItem "$env:APPDATA\Claude\claude-code" -Recurse -Filter claude.exe -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $found) { throw 'Claude CLI not found under %APPDATA%\Claude\claude-code. Install Claude Code first.' }
  Copy-Item -LiteralPath $found.FullName -Destination $cli -Force
}

# the secret shared between the app and this service
$envFile = "$Root\assistant.env"
if (-not (Test-Path -LiteralPath $envFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Set-Content -LiteralPath $envFile -Value "ASSISTANT_BRIDGE_SECRET=$secret" -Encoding ASCII
}

Write-Host ''
Write-Host "Ready in $Root"
Write-Host '  Claude CLI : ' (& $cli --version)
Write-Host ''
Write-Host 'Next, in order (see assistant-bridge\README.md):'
Write-Host "  1. Sign in Claude for the assistant:"
Write-Host "       `$env:CLAUDE_CONFIG_DIR = '$Root\claude-home'; & '$cli'      (then type /login)"
Write-Host "  2. Install the service (PowerShell as Administrator):"
Write-Host "       powershell -ExecutionPolicy Bypass -File '$here\install-service.ps1'"
Write-Host "  3. Put the secret in the app's settings: add this line to tools\secrets\afro-egypt.env, then restart AfroEgyptApp:"
Write-Host "       $(Get-Content -LiteralPath $envFile)"
