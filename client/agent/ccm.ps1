# Claude Code usage monitor agent (Windows, PowerShell 5.1+).
#
#   ccm statusline   Claude Code status line: shows limits, forwards them to the dashboard
#   ccm hook         SessionStart hook: heartbeat + background self-update
#   ccm doctor       Checks the installation end to end and explains any fix
#   ccm update       Downloads the latest agent now
#   ccm version      Prints the agent version
#   ccm uninstall    Removes the agent and its Claude Code settings (needs Administrator)
#
# The copy under Program Files is a stable launcher: when a newer agent has been downloaded to
# %USERPROFILE%\.ccm\agent, it hands over to that copy.

param([Parameter(Position = 0)][string]$Command = '', [Parameter(ValueFromRemainingArguments = $true)]$Rest)

$CCM_AGENT_VERSION = 1
$MIN_CLAUDE_VERSION = [version]'2.1.200'

# ---------------------------------------------------------------------------------------------
# Launcher: prefer a newer downloaded agent. Keep this block small; it can never update itself.
if (-not $env:CCM_DELEGATED) {
    $env:CCM_INSTALL_DIR = $PSScriptRoot
    $cached = Join-Path $env:USERPROFILE '.ccm\agent\ccm.ps1'
    if (Test-Path -LiteralPath $cached) {
        $m = Select-String -LiteralPath $cached -Pattern '^\$CCM_AGENT_VERSION = (\d+)$' | Select-Object -First 1
        if ($m -and [int]$m.Matches[0].Groups[1].Value -gt $CCM_AGENT_VERSION) {
            $env:CCM_DELEGATED = '1'
            & $cached $Command @Rest
            exit $LASTEXITCODE
        }
    }
}
# ---------------------------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$InstallDir = $env:CCM_INSTALL_DIR
$ConfPath = Join-Path $InstallDir 'config'
$StateDir = Join-Path $env:USERPROFILE '.ccm'
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Dot = [char]0x00B7

$Cfg = @{ CCM_URL = ''; CCM_TOKEN = ''; DEVICE_ID = ''; DEV_NAME = ''; TEAM = ''; SETTINGS_FILE = ''; SETTINGS_VERSION = '0'; AUTO_UPDATE = '1'; CHAIN_STATUSLINE = '' }

function Load-Config {
    if (-not (Test-Path -LiteralPath $ConfPath)) { return $false }
    foreach ($line in [IO.File]::ReadAllLines($ConfPath)) {
        if (-not $line -or $line.StartsWith('#')) { continue }
        $i = $line.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $line.Substring(0, $i); $v = $line.Substring($i + 1)
        if ($k -eq 'CHAIN_STATUSLINE_B64') {
            try { $Cfg.CHAIN_STATUSLINE = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($v)) } catch {}
        } else { $Cfg[$k] = $v }
    }
    $Cfg.CCM_URL = $Cfg.CCM_URL.TrimEnd('/')
    return [bool]($Cfg.CCM_URL -and $Cfg.CCM_TOKEN)
}

function Get-ClaudeJsonPath {
    if ($env:CLAUDE_CONFIG_DIR -and (Test-Path (Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json'))) {
        return (Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json')
    }
    return (Join-Path $env:USERPROFILE '.claude.json')
}

# Signed-in account, read from Claude Code's own state file.
function Get-Account {
    $f = Get-ClaudeJsonPath
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    try {
        # The file can be large and oauthAccount holds nested objects, so read the flat string fields
        # from the text that follows the key instead of parsing the whole document.
        $text = [IO.File]::ReadAllText($f)
        $i = $text.IndexOf('"oauthAccount"')
        if ($i -lt 0) { return $null }
        $chunk = $text.Substring($i, [Math]::Min(6000, $text.Length - $i))
        $field = { param($k) $m = [regex]::Match($chunk, '"' + $k + '"\s*:\s*"([^"]*)"'); if ($m.Success) { $m.Groups[1].Value } else { $null } }
        $email = & $field 'emailAddress'
        if (-not $email) { return $null }
        $tier = & $field 'organizationRateLimitTier'
        if (-not $tier) { $tier = & $field 'userRateLimitTier' }
        return [ordered]@{
            email = $email.ToLower(); account_uuid = (& $field 'accountUuid')
            organization_type = (& $field 'organizationType'); rate_limit_tier = $tier; display_name = (& $field 'displayName')
        }
    } catch { return $null }
}

function Invoke-Api([string]$Method, [string]$Path, $Body, [int]$Timeout = 10) {
    # Returns @{ Status = <int>; Body = <string> }. Never throws.
    $headers = @{ Authorization = "Bearer $($Cfg.CCM_TOKEN)" }
    $params = @{ Uri = "$($Cfg.CCM_URL)$Path"; Method = $Method; Headers = $headers; TimeoutSec = $Timeout; UseBasicParsing = $true }
    if ($null -ne $Body) {
        # OTLP payloads nest ~10 levels deep; ConvertTo-Json silently truncates beyond -Depth.
        $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 32 -Compress }
        $params.Body = $Utf8.GetBytes($json); $params.ContentType = 'application/json'
    }
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

function Get-OsVersion { try { (Get-CimInstance Win32_OperatingSystem).Caption + ' ' + [Environment]::OSVersion.Version.ToString() } catch { [Environment]::OSVersion.VersionString } }

function Update-Agent([switch]$Force) {
    if ($Cfg.AUTO_UPDATE -ne '1' -and -not $Force) { return $null }
    $r = Invoke-Api GET '/api/client/agent?platform=windows' $null 20
    if ($r.Status -ne 200) { return $null }
    $latest = [int]$r.Headers['x-ccm-agent-version']; $sha = [string]$r.Headers['x-ccm-sha256']
    if (-not $latest -or -not $sha) { return $null }
    $bytes = $Utf8.GetBytes($r.Body)
    $actual = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
    if ($actual -ne $sha.ToLower()) { return $null }
    if ($latest -le $CCM_AGENT_VERSION -and -not $Force) { return $null }
    $dir = Join-Path $StateDir 'agent'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $tmp = Join-Path $dir 'ccm.ps1.download'
    [IO.File]::WriteAllBytes($tmp, $bytes)
    Move-Item -LiteralPath $tmp -Destination (Join-Path $dir 'ccm.ps1') -Force
    return $latest
}

function Send-Heartbeat($Check) {
    $body = [ordered]@{
        device_id = $Cfg.DEVICE_ID; dev_name = $Cfg.DEV_NAME; team = $Cfg.TEAM; host_name = $env:COMPUTERNAME
        os_type = 'Windows'; os_version = (Get-OsVersion); agent_version = $CCM_AGENT_VERSION
        settings_version = [int]$Cfg.SETTINGS_VERSION; account = (Get-Account); check = $Check
    }
    $r = Invoke-Api POST '/api/client/heartbeat' $body
    if ($r.Status -ne 200) { return $false }
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    $resp = $r.Body | ConvertFrom-Json
    $noticeFile = Join-Path $StateDir 'notice'
    if ($resp.notice) { [IO.File]::WriteAllText($noticeFile, $resp.notice, $Utf8) } elseif (Test-Path $noticeFile) { Remove-Item $noticeFile -Force }
    if ($resp.latest_agent_version -gt $CCM_AGENT_VERSION) { Update-Agent | Out-Null }
    return $true
}

# ------------------------------------------------------------------------------- statusline
function Send-StatusLine([string]$Raw, [switch]$Sync) {
    $acct = Get-Account
    $email = ''; $tier = ''
    if ($acct) { $email = $acct.email; $tier = $acct.rate_limit_tier }
    $attrs = ('dev.name={0},team={1}' -f $Cfg.DEV_NAME, $Cfg.TEAM) -replace ' ', '%20'
    if ($Sync) {
        $headers = @{ Authorization = "Bearer $($Cfg.CCM_TOKEN)"; 'X-CCM-Device' = $Cfg.DEVICE_ID; 'X-CCM-Host' = $env:COMPUTERNAME
            'X-CCM-OS' = 'Windows'; 'X-CCM-Attrs' = $attrs; 'X-CCM-Email' = $email; 'X-CCM-Tier' = [string]$tier }
        try {
            $r = Invoke-WebRequest -Uri "$($Cfg.CCM_URL)/api/limits" -Method POST -Headers $headers -Body $Utf8.GetBytes($Raw) `
                -ContentType 'application/json' -TimeoutSec 10 -UseBasicParsing
            return [int]$r.StatusCode
        } catch {
            if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
            return 0
        }
    }
    # Fire and forget through curl.exe so the status line renders immediately.
    $payload = Join-Path $StateDir ('payload-' + [guid]::NewGuid().ToString('N') + '.json')
    [IO.File]::WriteAllText($payload, $Raw, $Utf8)
    $curlArgs = @('-s', '-m', '8', '-o', 'NUL', '-X', 'POST', "$($Cfg.CCM_URL)/api/limits",
        '-H', "Authorization: Bearer $($Cfg.CCM_TOKEN)", '-H', 'Content-Type: application/json',
        '-H', "X-CCM-Device: $($Cfg.DEVICE_ID)", '-H', "X-CCM-Host: $env:COMPUTERNAME", '-H', 'X-CCM-OS: Windows',
        '-H', "X-CCM-Attrs: $attrs", '-H', "X-CCM-Email: $email", '-H', "X-CCM-Tier: $tier",
        '--data-binary', "@$payload")
    # Start-Process does not quote array elements, so quote each argument explicitly.
    $argLine = ($curlArgs | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
    Start-Process -FilePath 'curl.exe' -ArgumentList $argLine -WindowStyle Hidden
    # Payload files from earlier sends are removed once they are a few minutes old.
    Get-ChildItem -Path $StateDir -Filter 'payload-*.json' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-5) } | Remove-Item -Force -ErrorAction SilentlyContinue
    return 0
}

function Find-GitBash {
    if ($env:CLAUDE_CODE_GIT_BASH_PATH -and (Test-Path -LiteralPath $env:CLAUDE_CODE_GIT_BASH_PATH)) { return $env:CLAUDE_CODE_GIT_BASH_PATH }
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) {
        $root = Split-Path (Split-Path $git.Source -Parent) -Parent
        $candidate = Join-Path $root 'bin\bash.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Format-Pct($v) {
    if ($null -eq $v) { return $null }
    $n = [int][math]::Round([double]$v)
    $e = [char]27
    if ($n -ge 90) { return "$e[31m$n%$e[0m" }
    if ($n -ge 70) { return "$e[33m$n%$e[0m" }
    return "$n%"
}

function Invoke-StatusLine {
    $ErrorActionPreference = 'SilentlyContinue'
    [Console]::OutputEncoding = $Utf8
    $raw = [Console]::In.ReadToEnd()
    $data = $raw | ConvertFrom-Json
    $null = Load-Config
    $session = [string]$data.session_id
    if ($Cfg.CCM_URL -and $session) {
        $dir = Join-Path $StateDir 'sessions'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $stamp = Join-Path $dir $session
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $last = 0
        if (Test-Path -LiteralPath $stamp) { $last = [int64]([IO.File]::ReadAllText($stamp)) }
        if (($now - $last) -ge 60) {
            [IO.File]::WriteAllText($stamp, [string]$now)
            $null = Send-StatusLine $raw
        }
    }
    if ($Cfg.CHAIN_STATUSLINE) {
        # Run the user's previous status line the way Claude Code would: Git Bash when present, else PowerShell.
        try {
            $bash = Find-GitBash
            if ($bash) { $chained = $raw | & $bash -c $Cfg.CHAIN_STATUSLINE 2>$null }
            else { $chained = $raw | & powershell.exe -NoProfile -Command $Cfg.CHAIN_STATUSLINE 2>$null }
            if ($chained) { Write-Output ($chained -join "`n") }
        } catch {}
    }
    $parts = @()
    if ($data.model.display_name) { $parts += $data.model.display_name } else { $parts += 'Claude' }
    $week = Format-Pct $data.rate_limits.seven_day.used_percentage
    $five = Format-Pct $data.rate_limits.five_hour.used_percentage
    if ($week) { $parts += "week $week" }
    if ($five) { $parts += "5h $five" }
    if ($null -ne $data.context_window.used_percentage) { $parts += ('ctx {0}%' -f [int][math]::Round([double]$data.context_window.used_percentage)) }
    $noticeFile = Join-Path $StateDir 'notice'
    if (Test-Path $noticeFile) { $parts += ([char]27 + '[33m' + [IO.File]::ReadAllText($noticeFile) + [char]27 + '[0m') }
    Write-Output ($parts -join " $Dot ")
}

# ------------------------------------------------------------------------------------- hook
function Invoke-Hook {
    try { $null = [Console]::In.ReadToEnd() } catch {}
    if (-not (Load-Config)) { exit 0 }
    # Detach so the session start is never delayed by the network.
    $self = Join-Path $InstallDir 'ccm.ps1'
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$self`"", 'heartbeat')
    $sessions = Join-Path $StateDir 'sessions'
    Get-ChildItem -Path $sessions -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue
    exit 0
}

# ----------------------------------------------------------------------------------- doctor
$script:Counts = @{ ok = 0; warn = 0; fail = 0 }
$script:Items = New-Object System.Collections.ArrayList

function Report([string]$Status, [string]$Title, [string]$Detail, [string]$Fix = '') {
    $script:Counts[$Status]++
    switch ($Status) {
        'ok' { $icon = [char]0x2713; $color = 'Green' }
        'warn' { $icon = '!'; $color = 'Yellow' }
        default { $icon = [char]0x2717; $color = 'Red' }
    }
    Write-Host '  ' -NoNewline
    Write-Host $icon -ForegroundColor $color -NoNewline
    Write-Host (' {0,-20} {1}' -f $Title, $Detail)
    if ($Fix) { Write-Host "    -> $Fix" -ForegroundColor DarkGray }
    [void]$script:Items.Add([ordered]@{ status = $Status; title = $Title; detail = $Detail; fix = $Fix })
}

function Find-ClaudeInstalls {
    $found = New-Object System.Collections.ArrayList
    $bins = @()
    Get-Command claude.exe -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $bins += $_.Source }
    $bins += (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
    $bins += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\claude.exe')
    foreach ($b in ($bins | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $b)) { continue }
        try {
            $out = & $b --version 2>$null | Select-Object -First 1
            $m = [regex]::Match([string]$out, '\d+\.\d+\.\d+')
            if ($m.Success) { [void]$found.Add(@{ Label = "CLI ($b)"; Version = $m.Value }) }
        } catch {}
    }
    foreach ($ide in @('.vscode', '.vscode-insiders', '.cursor', '.windsurf')) {
        $dir = Join-Path $env:USERPROFILE "$ide\extensions"
        if (-not (Test-Path $dir)) { continue }
        Get-ChildItem -Path $dir -Directory -Filter 'anthropic.claude-code-*' -ErrorAction SilentlyContinue | ForEach-Object {
            $m = [regex]::Match($_.Name, '\d+\.\d+\.\d+')
            if ($m.Success) { [void]$found.Add(@{ Label = ($ide.TrimStart('.') + ' extension'); Version = $m.Value }) }
        }
    }
    # Keep only the newest version per label (old extension folders linger after updates).
    $found | Group-Object { $_.Label } | ForEach-Object { $_.Group | Sort-Object { [version]$_.Version } -Descending | Select-Object -First 1 }
}

function Invoke-Doctor {
    $ErrorActionPreference = 'Continue'
    Write-Host ''
    Write-Host 'Claude Code usage monitor ' -NoNewline -ForegroundColor White
    Write-Host "$Dot doctor  agent v$CCM_AGENT_VERSION" -ForegroundColor DarkGray
    Write-Host ''

    if (Load-Config) {
        $team = if ($Cfg.TEAM) { " ($($Cfg.TEAM))" } else { '' }
        Report ok 'Installation' "$InstallDir $Dot $($Cfg.DEV_NAME)$team $Dot device $($Cfg.DEVICE_ID.Substring(0, [Math]::Min(8, $Cfg.DEVICE_ID.Length)))"
    } else {
        Report fail 'Installation' "config missing or incomplete at $ConfPath" 'Re-run the installer from the dashboard Setup page'
        return 1
    }

    # Settings file
    $sf = $Cfg.SETTINGS_FILE
    if (-not $sf -or -not (Test-Path -LiteralPath $sf)) {
        Report fail 'Claude settings' "settings file not found: $sf" 'Re-run the installer as Administrator'
    } else {
        $text = [IO.File]::ReadAllText($sf)
        $valid = $true; try { $null = $text | ConvertFrom-Json } catch { $valid = $false }
        if (-not $valid) { Report fail 'Claude settings' "$sf is not valid JSON; Claude Code will refuse to start" 'Re-run the installer, or delete the file' }
        elseif ($text -notmatch 'CCM_SETTINGS_VERSION') { Report fail 'Claude settings' "$sf does not contain the monitor settings" 'Re-run the installer as Administrator' }
        elseif ($text -notmatch [regex]::Escape($Cfg.CCM_URL)) { Report warn 'Claude settings' "endpoint in $sf differs from $($Cfg.CCM_URL)" 'Re-run the installer to rewrite the settings' }
        else { Report ok 'Claude settings' "$sf (telemetry on, v$($Cfg.SETTINGS_VERSION))" }
    }
    foreach ($hive in @('HKLM:\SOFTWARE\Policies\ClaudeCode', 'HKCU:\SOFTWARE\Policies\ClaudeCode')) {
        $p = Get-ItemProperty -Path $hive -Name Settings -ErrorAction SilentlyContinue
        if ($p -and $hive.StartsWith('HKLM')) {
            Report warn 'Registry policy' "$hive\Settings exists and takes precedence over settings files" 'Add the monitor env and hooks to that policy, or set managedSourcesBehavior to "merge" in it'
        }
    }
    $policies = Get-ExecutionPolicy -List
    $blocking = $policies | Where-Object { $_.Scope -in @('MachinePolicy', 'UserPolicy') -and $_.ExecutionPolicy -in @('AllSigned', 'Restricted') }
    if ($blocking) {
        Report fail 'PowerShell policy' "Group Policy enforces $($blocking[0].ExecutionPolicy); the status line and hook scripts cannot run" 'Ask IT to allow RemoteSigned, or sign ccm.ps1'
    }

    # Claude Code installs
    $installs = @(Find-ClaudeInstalls)
    if ($installs.Count -eq 0) {
        Report warn 'Claude Code' "no CLI or IDE extension found for $env:USERNAME" 'Install Claude Code, then run: ccm doctor'
    } else {
        $old = @($installs | Where-Object { [version]$_.Version -lt $MIN_CLAUDE_VERSION })
        $summary = ($installs | ForEach-Object { "$($_.Version) $($_.Label)" }) -join ', '
        if ($old.Count -gt 0) {
            $fix = if ($old | Where-Object { $_.Label -match 'WinGet' }) { 'Run: winget upgrade Anthropic.ClaudeCode' }
                   elseif ($old | Where-Object { $_.Label -match 'extension' }) { 'Update the Claude Code extension in your IDE' }
                   else { 'Run: claude update' }
            Report warn 'Claude Code' ('outdated: ' + (($old | ForEach-Object { "$($_.Label) $($_.Version)" }) -join ', ') + " (need $MIN_CLAUDE_VERSION+)") $fix
        } else { Report ok 'Claude Code' $summary }
    }

    $acct = Get-Account
    if ($acct) { Report ok 'Claude account' ("$($acct.email)" + $(if ($acct.rate_limit_tier) { " $Dot $($acct.rate_limit_tier)" } else { '' })) }
    else { Report warn 'Claude account' "no signed-in claude.ai account found in $(Get-ClaudeJsonPath)" 'Open Claude Code and run /login' }

    if (Get-Command curl.exe -ErrorAction SilentlyContinue) { Report ok 'curl' (Get-Command curl.exe).Source }
    else { Report fail 'curl' 'curl.exe not found' 'Windows 10 1803+ includes curl.exe; update Windows or install curl' }

    # Server
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $h = Invoke-Api GET '/api/health' $null
    $sw.Stop()
    if ($h.Status -eq 200) { Report ok 'Dashboard server' ("$($Cfg.CCM_URL) reachable ({0} ms)" -f $sw.ElapsedMilliseconds) }
    elseif ($h.Status -eq 503) { Report fail 'Dashboard server' "$($Cfg.CCM_URL) is up but misconfigured: $($h.Body)" 'Dashboard admin: check environment variables on Vercel' }
    else { Report fail 'Dashboard server' "cannot reach $($Cfg.CCM_URL) (HTTP $($h.Status))" 'Check the network/VPN/proxy, or that the dashboard URL is correct' }

    # Token + pipeline
    $nonce = [guid]::NewGuid().ToString('N')
    $c = Invoke-Api POST '/api/client/check' @{ device_id = $Cfg.DEVICE_ID }
    $check = $null
    if ($c.Status -eq 401) { Report fail 'Access token' 'rejected by the server' 'Token was rotated: re-run the installer from the dashboard Setup page' }
    elseif ($c.Status -eq 200) {
        Report ok 'Access token' 'accepted'
        $ns = [string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + '000000'
        $otlp = @{ resourceLogs = @(@{
            resource = @{ attributes = @(
                @{ key = 'ccm.device'; value = @{ stringValue = $Cfg.DEVICE_ID } },
                @{ key = 'dev.name'; value = @{ stringValue = $Cfg.DEV_NAME } }) }
            scopeLogs = @(@{ logRecords = @(@{ timeUnixNano = $ns; body = @{ stringValue = 'ccm.install_check' }
                attributes = @(@{ key = 'event.name'; value = @{ stringValue = 'ccm.install_check' } },
                               @{ key = 'ccm.nonce'; value = @{ stringValue = $nonce } }) }) }) }) }
        $l = Invoke-Api POST '/v1/logs' $otlp
        if ($l.Status -eq 200) {
            $c2 = Invoke-Api POST '/api/client/check' @{ device_id = $Cfg.DEVICE_ID; nonce = $nonce }
            $check = $c2.Body | ConvertFrom-Json
            if ($check.nonce_found) { Report ok 'Telemetry pipeline' 'test event stored' }
            else { Report fail 'Telemetry pipeline' 'test event accepted but not stored' 'Dashboard admin: check the database (npm run db:setup)' }
        } else { Report fail 'Telemetry pipeline' "ingest endpoint returned HTTP $($l.Status)" 'Dashboard admin: check server logs on Vercel' }
    } else { Report fail 'Access token' "check endpoint returned HTTP $($c.Status)" 'Check the dashboard URL and that the deployment is up' }

    $sl = Send-StatusLine ('{"session_id":"ccm-doctor-' + $nonce + '","version":"doctor","model":{"display_name":"doctor"}}') -Sync
    if ($sl -eq 200) { Report ok 'Status line' 'limit forwarding works' }
    else { Report fail 'Status line' "forwarding returned HTTP $sl" 'Check the access token and server status above' }

    if ($check -and $check.last_event_at) { Report ok 'Recent activity' "last Claude Code event: $($check.last_event_name) at $($check.last_event_at)" }
    else { Report warn 'Recent activity' 'no Claude Code activity from this device yet' 'Restart open Claude Code sessions / VS Code windows, send a message; it appears within ~10s' }

    Write-Host ''
    Write-Host "  $($script:Counts.ok) passed" -ForegroundColor Green -NoNewline
    if ($script:Counts.warn) { Write-Host " $Dot $($script:Counts.warn) warning(s)" -ForegroundColor Yellow -NoNewline }
    if ($script:Counts.fail) { Write-Host " $Dot $($script:Counts.fail) failed" -ForegroundColor Red -NoNewline }
    Write-Host ''
    Write-Host ''
    $null = Send-Heartbeat ([ordered]@{ ran_at = (Get-Date).ToUniversalTime().ToString('o'); ok = $script:Counts.ok; warn = $script:Counts.warn; fail = $script:Counts.fail; items = $script:Items })
    if ($script:Counts.fail -gt 0) { return 1 } else { return 0 }
}

function Invoke-Uninstall {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { Write-Host 'Run from an Administrator PowerShell: ccm uninstall'; exit 1 }
    $null = Load-Config
    if ($Cfg.SETTINGS_FILE -and (Test-Path -LiteralPath $Cfg.SETTINGS_FILE) -and ([IO.File]::ReadAllText($Cfg.SETTINGS_FILE) -match 'CCM_SETTINGS_VERSION')) {
        Remove-Item -LiteralPath $Cfg.SETTINGS_FILE -Force; Write-Host "Removed $($Cfg.SETTINGS_FILE)"
    }
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $parts = $machinePath -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $InstallDir.TrimEnd('\')) }
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'Machine')
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
    Write-Host "Removed $InstallDir. Per-user state in %USERPROFILE%\.ccm can be deleted by each user."
}

switch ($Command) {
    'statusline' { Invoke-StatusLine }
    'hook' { Invoke-Hook }
    'heartbeat' { if (Load-Config) { $null = Send-Heartbeat $null } }
    'doctor' { exit (Invoke-Doctor) }
    'update' {
        if (-not (Load-Config)) { Write-Host "Not installed (config missing at $ConfPath)."; exit 1 }
        $v = Update-Agent -Force
        if ($v) { Write-Host "Agent updated to v$v ($StateDir\agent\ccm.ps1)." } else { Write-Host "Update failed: could not download the agent from $($Cfg.CCM_URL)."; exit 1 }
    }
    'uninstall' { Invoke-Uninstall }
    { $_ -in @('version', '--version', '-v') } { Write-Host "ccm agent v$CCM_AGENT_VERSION" }
    default { Write-Host 'Usage: ccm {doctor|update|version|uninstall}'; exit 2 }
}
