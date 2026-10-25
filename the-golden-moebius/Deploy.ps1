[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]*$')]
    [string]$SshAlias = 'nyc1',
    [ValidateSet('auto', 'caddy', 'nginx')]
    [string]$Server = 'auto',
    [switch]$InspectOnly
)

$ErrorActionPreference = 'Stop'
$ArchivePath = Join-Path $PSScriptRoot 'site.tar.gz'
$ServerScript = Join-Path $PSScriptRoot 'deploy/deploy-server.py'
$VersionFile = Join-Path $PSScriptRoot 'dist/site-version.json'

foreach ($Executable in @('ssh', 'scp')) {
    if (-not (Get-Command $Executable -ErrorAction SilentlyContinue)) {
        throw "$Executable was not found. Enable the Windows OpenSSH Client first."
    }
}
foreach ($FilePath in @($ArchivePath, $ServerScript, $VersionFile)) {
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "Required package file is missing: $FilePath. Extract the complete archive before deploying."
    }
}

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE. Read the preceding message; deployment has stopped."
    }
}

$RemoteDirectory = '/tmp/golden-moebius-' + [Guid]::NewGuid().ToString('N')
$ArchiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$ExpectedVersion = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
$SshOptions = @('-o', 'ConnectTimeout=15')

Write-Host "Connecting through your SSH alias '$SshAlias'..."
$PrepareCommand = 'command -v python3 >/dev/null && mkdir -m 700 -- {0}' -f $RemoteDirectory
Invoke-Checked -Executable 'ssh' -Arguments ($SshOptions + @($SshAlias, $PrepareCommand))

Write-Host 'Uploading the site, leaderboard service and installer...'
Invoke-Checked -Executable 'scp' -Arguments @('-o', 'ConnectTimeout=15', $ArchivePath, $ServerScript, "${SshAlias}:$RemoteDirectory/")

$ServerArguments = '--server {0} --archive {1}/site.tar.gz --sha256 {2}' -f $Server, $RemoteDirectory, $ArchiveHash
if (-not $InspectOnly) { $ServerArguments += ' --apply' }
$ApplyCommand = 'if [ "$(id -u)" -eq 0 ]; then python3 {0}/deploy-server.py {1}; else sudo python3 {0}/deploy-server.py {1}; fi' -f $RemoteDirectory, $ServerArguments

if ($InspectOnly) {
    Write-Host 'Inspecting Caddy/Nginx and the yt.cafe configuration; site content will not be changed.'
} else {
    Write-Host 'Installing and validating the site and leaderboard. If sudo asks, enter your NYC1 account password.'
}
# Give sudo a remote terminal so it can prompt directly for the account password.
# Passwords stay between the user's terminal, SSH and sudo; never read them here.
Invoke-Checked -Executable 'ssh' -Arguments ($SshOptions + @('-t', $SshAlias, $ApplyCommand))

if ($InspectOnly) {
    Write-Host "Inspection finished. Temporary upload directory: $RemoteDirectory"
    return
}

Write-Host 'Verifying the new release through Cloudflare over HTTPS...'
$Verified = $false
$VerificationError = ''
for ($Attempt = 1; $Attempt -le 6; $Attempt++) {
    try {
        $VersionUrl = 'https://yt.cafe/site-version.json?build={0}&attempt={1}' -f $ExpectedVersion.build, $Attempt
        $ActualVersion = Invoke-RestMethod -Uri $VersionUrl -TimeoutSec 20 -Headers @{ 'Cache-Control' = 'no-cache' }
        if ($ActualVersion.build -ne $ExpectedVersion.build) {
            throw 'The public hostname is still returning another release.'
        }
        $Verified = $true
        break
    } catch {
        $VerificationError = $_.Exception.Message
        if ($Attempt -lt 6) { Start-Sleep -Seconds 3 }
    }
}
if (-not $Verified) {
    throw "The server accepted the deployment, but public HTTPS verification failed: $VerificationError. Check the Cloudflare origin/proxy settings and the backup/rollback path printed above. The installer did not change DNS, TLS settings or firewall rules."
}

foreach ($Route in @('', 'viewer/', 'gold-rush/', 'west-bank/')) {
    $PageUrl = 'https://yt.cafe/{0}?build={1}' -f $Route, $ExpectedVersion.build
    $Response = Invoke-WebRequest -Uri $PageUrl -TimeoutSec 20
    if ($Response.StatusCode -ne 200) {
        throw "Unexpected HTTP status for $PageUrl : $($Response.StatusCode)"
    }
    Write-Host "OK  https://yt.cafe/$Route"
}

$Health = Invoke-RestMethod -Uri ('https://yt.cafe/api/west-bank/health?build=' + $ExpectedVersion.build) -TimeoutSec 20 -Headers @{ 'Cache-Control' = 'no-cache' }
if (-not $Health.ok -or $Health.build -ne $ExpectedVersion.build) {
    throw 'The public leaderboard API is not serving this release. Check the origin service and any Cloudflare cache rules for /api/west-bank/*.'
}
foreach ($Mode in @('easy', 'classic', 'hard')) {
    $Board = Invoke-RestMethod -Uri ('https://yt.cafe/api/west-bank/leaderboard?mode=' + $Mode + '&build=' + $ExpectedVersion.build) -TimeoutSec 20 -Headers @{ 'Cache-Control' = 'no-cache' }
    if ($Board.mode -ne $Mode -or $null -eq $Board.entries) { throw "Leaderboard check failed for $Mode." }
    Write-Host "OK  $Mode public leaderboard"
}

# Only remove the exact task-owned temporary directory created above.
$CleanupCommand = 'rm -rf -- {0}' -f $RemoteDirectory
try {
    Invoke-Checked -Executable 'ssh' -Arguments ($SshOptions + @($SshAlias, $CleanupCommand))
} catch {
    Write-Warning "The site is verified, but its temporary upload directory remains at $RemoteDirectory."
}
Write-Host "The Golden Moebius is live: https://yt.cafe/ (build $($ExpectedVersion.build))"
Start-Process 'https://yt.cafe/'
