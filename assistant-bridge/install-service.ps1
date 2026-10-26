# Installs the assistant service as a Windows service ("AfroEgyptAssistant") that starts with the machine and
# restarts if it stops. Run it from a PowerShell opened as Administrator, after install.ps1 and after the Claude
# sign-in. It asks for the Windows account the service runs as: it has to be the same account that signed in
# Claude, because the sign-in is stored in that account's files. The password is typed into a hidden prompt.
#   powershell -ExecutionPolicy Bypass -File assistant-bridge\install-service.ps1
param(
  [string]$Root = 'C:\Users\Host\Desktop\main\tools\assistant',
  [string]$Nssm = 'C:\Users\Host\Desktop\main\tools\nssm\nssm.exe',
  [string]$Node = 'C:\Users\Host\Desktop\main\tools\node-v20.18.1-win-x64\node.exe',
  [string]$Name = 'AfroEgyptAssistant'
)
$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  throw 'Open PowerShell as Administrator and run this again.'
}
foreach ($p in @($Nssm, $Node, "$Root\server.mjs", "$Root\claude\claude.exe", "$Root\assistant.env")) {
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing: $p (run install.ps1 first)" }
}
$secret = ((Get-Content -LiteralPath "$Root\assistant.env") -match '^ASSISTANT_BRIDGE_SECRET=(.+)$' | ForEach-Object { $Matches[1] } | Select-Object -First 1)
if (-not $secret) { throw "No ASSISTANT_BRIDGE_SECRET in $Root\assistant.env" }

$cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'The Windows account the assistant service runs as (the one that signed in Claude)'
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($cred.Password))

if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
  & $Nssm stop $Name | Out-Null
  & $Nssm remove $Name confirm | Out-Null
}

& $Nssm install $Name $Node "$Root\server.mjs" | Out-Null
& $Nssm set $Name AppDirectory $Root | Out-Null
& $Nssm set $Name DisplayName 'Afro Egypt smart assistant' | Out-Null
& $Nssm set $Name Description 'Runs the Claude CLI for the in-app assistant (admin only). See assistant-bridge\README.md.' | Out-Null
& $Nssm set $Name AppEnvironmentExtra "ASSISTANT_BRIDGE_SECRET=$secret" "ASSISTANT_CLI=$Root\claude\claude.exe" "ASSISTANT_CLAUDE_CONFIG_DIR=$Root\claude-home" "ASSISTANT_WORKDIR=$Root\workspace" "ASSISTANT_INSTRUCTIONS=$Root\INSTRUCTIONS.md" | Out-Null
& $Nssm set $Name ObjectName $cred.UserName $plain | Out-Null
& $Nssm set $Name Start SERVICE_AUTO_START | Out-Null
& $Nssm set $Name AppExit Default Restart | Out-Null
& $Nssm set $Name AppRestartDelay 3000 | Out-Null
& $Nssm set $Name AppStdout "$Root\logs\assistant-out.log" | Out-Null
& $Nssm set $Name AppStderr "$Root\logs\assistant-err.log" | Out-Null
& $Nssm set $Name AppRotateFiles 1 | Out-Null
& $Nssm set $Name AppRotateBytes 5242880 | Out-Null
$plain = $null

Start-Service -Name $Name
Start-Sleep -Seconds 3
Get-Service -Name $Name | Format-Table Name, Status, StartType -AutoSize
try { Write-Host ('health: ' + (Invoke-RestMethod -Uri 'http://127.0.0.1:4100/health' -TimeoutSec 10 | ConvertTo-Json -Compress)) } catch { Write-Host "health check failed: $($_.Exception.Message) (see $Root\logs\assistant-err.log)" }
