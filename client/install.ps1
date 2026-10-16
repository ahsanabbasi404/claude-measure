# Claude Code usage monitor installer for Windows (PowerShell 5.1+).
#
#   powershell -ExecutionPolicy Bypass -c "& ([scriptblock]::Create((irm '__CCM_URL__/install.ps1'))) -Token <TOKEN>"
#
# Safe to re-run: keeps the device id, name and team of an existing install unless overridden.
param(
    [string]$Token = '',
    [string]$Name = '',
    [string]$Team = '',
    [string]$Url = '__CCM_URL__',
    [switch]$Yes,
    [switch]$PauseAtEnd,
    [string]$TestRoot = ''   # test hook: redirects Program Files under this directory
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Url = $Url.TrimEnd('/')
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Dot = [char]0x00B7

function Step([string]$m) { Write-Host '> ' -ForegroundColor DarkGray -NoNewline; Write-Host $m }
function Ok([string]$m) { Write-Host ('  ' + [char]0x2713 + ' ') -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn([string]$m) { Write-Host '  ! ' -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Finish([int]$code) {
    if ($PauseAtEnd) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
    exit $code
}
function Die([string]$m, [string]$fix = '') {
    Write-Host ''
    Write-Host ('  ' + [char]0x2717 + " $m") -ForegroundColor Red
    if ($fix) { Write-Host "    -> $fix" -ForegroundColor DarkGray }
    Write-Host ''
    Finish 1
}

Write-Host ''
Write-Host "Claude Code usage monitor $Dot installer" -ForegroundColor White
Write-Host $Url -ForegroundColor DarkGray
Write-Host ''

# ---------------------------------------------------------------- elevation
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $TestRoot) {
    Step 'Administrator rights are required; asking Windows for permission...'
    $self = Join-Path $env:TEMP 'ccm-install.ps1'
    [IO.File]::WriteAllText($self, $MyInvocation.MyCommand.ScriptBlock.ToString(), (New-Object System.Text.UTF8Encoding $true))
    $q = { param($v) '"' + ($v -replace '"', '\"') + '"' }
    $argList = "-NoProfile -ExecutionPolicy Bypass -File $(& $q $self) -Url $(& $q $Url) -PauseAtEnd"
    if ($Token) { $argList += " -Token $(& $q $Token)" }
    if ($Name) { $argList += " -Name $(& $q $Name)" }
    if ($Team) { $argList += " -Team $(& $q $Team)" }
    if ($Yes) { $argList += ' -Yes' }
    try {
        $p = Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait -PassThru
        exit $p.ExitCode
    } catch {
        Die 'Administrator permission was declined.' 'Re-run and accept the Windows prompt, or run the command from an Administrator PowerShell.'
    }
}

# ---------------------------------------------------------------- paths
$root = if ($TestRoot) { $TestRoot } else { $env:ProgramFiles }
$SettingsDir = Join-Path $root 'ClaudeCode'
$InstallDir = Join-Path $SettingsDir 'ccm'
$ConfPath = Join-Path $InstallDir 'config'

# ---------------------------------------------------------------- previous install
$prev = @{}
if (Test-Path -LiteralPath $ConfPath) {
    foreach ($line in [IO.File]::ReadAllLines($ConfPath)) {
        $i = $line.IndexOf('='); if ($i -gt 0 -and -not $line.StartsWith('#')) { $prev[$line.Substring(0, $i)] = $line.Substring($i + 1) }
    }
    Step "Existing install found for $($prev.DEV_NAME); updating it."
}

function Ask([string]$prompt, [string]$default = '') {
    if ($Yes) { return $default }
    $label = if ($default) { "  $prompt [$default]" } else { "  $prompt" }
    $reply = Read-Host $label
    if ([string]::IsNullOrWhiteSpace($reply)) { return $default }
    return $reply.Trim()
}

if (-not $Token) { $Token = [string]$prev.CCM_TOKEN }
if (-not $Token) { $Token = Ask 'Access token (from the dashboard Setup page)' }
if (-not $Token) { Die 'No access token given.' 'Pass -Token <TOKEN> (copy the command from the dashboard Setup page).' }
if (-not $Name) { $Name = Ask 'Your name, as shown on the dashboard' ([string]$prev.DEV_NAME) }
$Name = ($Name -replace '[\r\n]', '').Trim()
if (-not $Name) { Die 'A name is required.' 'Pass -Name "Full Name".' }
if (-not $Team) { $Team = Ask 'Team (optional)' ([string]$prev.TEAM) }
$Team = ($Team -replace '[\r\n]', '').Trim()
$DeviceId = if ($prev.DEVICE_ID) { $prev.DEVICE_ID } else { [guid]::NewGuid().ToString() }
Write-Host ''

function Call([string]$Method, [string]$Path, $Body = $null) {
    $params = @{ Uri = "$Url$Path"; Method = $Method; Headers = @{ Authorization = "Bearer $Token" }; TimeoutSec = 30; UseBasicParsing = $true }
    if ($null -ne $Body) { $params.Body = $Utf8.GetBytes($Body); $params.ContentType = 'application/json' }
    try {
        $r = Invoke-WebRequest @params
        return @{ Status = [int]$r.StatusCode; Body = [string]$r.Content; Headers = $r.Headers }
    } catch {
        $status = 0; $text = $_.Exception.Message
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            try { $text = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
        }
        return @{ Status = $status; Body = $text; Headers = @{} }
    }
}

# ---------------------------------------------------------------- server + token
Step 'Checking the dashboard server'
$h = Call GET '/api/health'
if ($h.Status -eq 503) { Die "The dashboard server is misconfigured: $($h.Body)" 'Dashboard admin: set the missing environment variables on Vercel.' }
if ($h.Status -ne 200) { Die "Cannot reach $Url (HTTP $($h.Status))." 'Check the URL, network, VPN or proxy settings.' }
Ok 'Server reachable'
$c = Call POST '/api/client/check' '{}'
if ($c.Status -ne 200) { Die "The access token was rejected (HTTP $($c.Status))." 'Copy the current install command from the dashboard Setup page.' }
Ok 'Access token accepted'

# ---------------------------------------------------------------- agent
Step 'Installing the agent'
$a = Call GET '/api/client/agent?platform=windows'
if ($a.Status -ne 200) { Die "Could not download the agent (HTTP $($a.Status))." 'Check the network and re-run.' }
$agentBytes = $Utf8.GetBytes($a.Body)
$sha = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($agentBytes) | ForEach-Object { $_.ToString('x2') })
if ($sha -ne ([string]$a.Headers['X-CCM-SHA256']).ToLower()) { Die 'Agent download failed verification.' 'Re-run the installer; if it persists, check for a proxy rewriting downloads.' }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
[IO.File]::WriteAllBytes((Join-Path $InstallDir 'ccm.ps1'), $agentBytes)
[IO.File]::WriteAllText((Join-Path $InstallDir 'ccm.cmd'), "@powershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0ccm.ps1`" %*`r`n", [Text.Encoding]::ASCII)
if (-not $TestRoot) {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if (($machinePath -split ';') -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable('Path', ($machinePath.TrimEnd(';') + ';' + $InstallDir), 'Machine')
    }
}
Ok "Agent v$($a.Headers['X-CCM-Agent-Version']) -> $InstallDir (command: ccm)"

# ---------------------------------------------------------------- existing status line
$chainB64 = [string]$prev.CHAIN_STATUSLINE_B64
$userSettings = Join-Path $env:USERPROFILE '.claude\settings.json'
if (-not $chainB64 -and (Test-Path -LiteralPath $userSettings)) {
    try {
        $us = [IO.File]::ReadAllText($userSettings) | ConvertFrom-Json
        $cmd = [string]$us.statusLine.command
        if ($cmd -and $cmd -notmatch 'ccm\.ps1') {
            $chainB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cmd))
            Ok 'Your existing status line is kept and shown above the usage line'
        }
    } catch { Warn "Could not read $userSettings; an existing custom status line will be replaced" }
}

# ---------------------------------------------------------------- Claude Code settings
Step 'Writing Claude Code managed settings'
$main = Join-Path $SettingsDir 'managed-settings.json'
$isOurs = { param($p) (Test-Path -LiteralPath $p) -and ([IO.File]::ReadAllText($p) -match 'CCM_SETTINGS_VERSION') }
if ($prev.SETTINGS_FILE -and (& $isOurs $prev.SETTINGS_FILE)) { $SettingsFile = $prev.SETTINGS_FILE }
elseif (-not (Test-Path -LiteralPath $main) -or (& $isOurs $main)) { $SettingsFile = $main }
else {
    # The organization already has a managed-settings.json: add a drop-in instead of touching it.
    $SettingsFile = Join-Path $SettingsDir 'managed-settings.d\50-usage-monitor.json'
}
New-Item -ItemType Directory -Force -Path (Split-Path $SettingsFile -Parent) | Out-Null
$qs = @(
    'platform=windows', ('install_dir=' + [uri]::EscapeDataString($InstallDir)), ('device_id=' + [uri]::EscapeDataString($DeviceId)),
    ('dev_name=' + [uri]::EscapeDataString($Name)), ('team=' + [uri]::EscapeDataString($Team)), ('host_name=' + [uri]::EscapeDataString($env:COMPUTERNAME))
) -join '&'
$s = Call GET "/api/client/settings?$qs"
if ($s.Status -ne 200) { Die "Could not generate settings (HTTP $($s.Status)): $($s.Body)" 'Re-run the installer.' }
try { $null = $s.Body | ConvertFrom-Json } catch { Die 'Generated settings are not valid JSON.' 'Re-run the installer.' }
# Claude Code parses settings with JSON.parse, which rejects a byte-order mark: write UTF-8 without BOM.
[IO.File]::WriteAllText($SettingsFile, $s.Body, $Utf8)
$settingsVersion = [string]$s.Headers['X-CCM-Settings-Version']
if (-not $settingsVersion) { $settingsVersion = '1' }
Ok $SettingsFile

$config = @(
    '# Claude Code usage monitor. Re-run the installer to change these values.',
    "CCM_URL=$Url", "CCM_TOKEN=$Token", "DEVICE_ID=$DeviceId", "DEV_NAME=$Name", "TEAM=$Team",
    "SETTINGS_FILE=$SettingsFile", "SETTINGS_VERSION=$settingsVersion", 'AUTO_UPDATE=1',
    "CHAIN_STATUSLINE_B64=$chainB64", ('INSTALLED_AT=' + (Get-Date).ToUniversalTime().ToString('o'))
)
[IO.File]::WriteAllLines($ConfPath, $config, $Utf8)
$teamLabel = if ($Team) { " ($Team)" } else { '' }
Ok "Device $DeviceId registered to $Name$teamLabel"

# ---------------------------------------------------------------- verify
Write-Host ''
Step 'Running checks'
$env:CCM_DELEGATED = $null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'ccm.ps1') doctor | Out-Host
$status = $LASTEXITCODE

if ($status -eq 0) {
    Write-Host 'Installed. ' -ForegroundColor Green -NoNewline
    Write-Host 'Restart Claude Code to apply: exit running claude sessions and reload VS Code / Cursor windows.'
} else {
    Write-Host 'Installed with problems. ' -ForegroundColor Red -NoNewline
    Write-Host 'Fix the items marked above, then run: ccm doctor'
}
Write-Host 'Re-check any time with: ccm doctor (new terminal)' -ForegroundColor DarkGray
Write-Host ''
Finish $status
