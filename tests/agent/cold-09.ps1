param([string]$Scenarios = '1,2,3,4,5')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$privateDir = Join-Path $env:TEMP 'homing-stage09-private'
$backupRoot = [IO.Path]::GetFullPath((Join-Path $privateDir 'cold-fetch-backups'))
$fetchCache = [IO.Path]::GetFullPath((Join-Path $workspace '.next/dev/cache/fetch-cache'))
$expectedCacheRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.next/dev/cache'))
$nextCli = Join-Path $workspace 'node_modules/next/dist/bin/next'
$nodeBinary = (Get-Command node.exe).Source
$tsxPackage = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'npm-cache/_npx') -Directory | ForEach-Object {
  $packageFile = Join-Path $_.FullName 'node_modules/tsx/package.json'
  if (Test-Path -LiteralPath $packageFile) {
    $package = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json
    [PSCustomObject]@{ Version = [Version]$package.version; Loader = Join-Path $_.FullName 'node_modules/tsx/dist/loader.mjs' }
  }
} | Sort-Object Version -Descending | Select-Object -First 1
if (!$tsxPackage) { throw 'Run npx tsx --version once to install the test runner before cold checks.' }
$tsxLoader = ([Uri]$tsxPackage.Loader).AbsoluteUri
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($scenario in $Scenarios.Split(',')) {
  if ($scenario -notmatch '^[1-5]$') { throw 'Only the five stage-09 dialogue IDs are accepted.' }
  $listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    if (!$serverProcess.CommandLine.Contains($workspace) -or !$serverProcess.CommandLine.Contains('next\dist\server\lib\start-server.js')) { throw 'Port 3001 is not this workspace Next server; leaving it untouched.' }
    $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($serverProcess.ParentProcessId)"
    if (!$parentProcess.CommandLine.Contains('next') -or !$parentProcess.CommandLine.Contains('3001')) { throw 'Unrecognized server parent; leaving it untouched.' }
    Stop-Process -Id $parentProcess.ProcessId -ErrorAction SilentlyContinue
    Stop-Process -Id $serverProcess.ProcessId -ErrorAction SilentlyContinue
  }
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if (!(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
  }
  if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { throw 'The previous listener is still running; no additional server was started.' }

  if (Test-Path -LiteralPath $fetchCache) {
    $resolvedCache = (Resolve-Path -LiteralPath $fetchCache).Path
    $backup = [IO.Path]::GetFullPath((Join-Path $backupRoot ("scenario-$scenario-" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))))
    if (!$resolvedCache.StartsWith($expectedCacheRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or !$backup.StartsWith($backupRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cache paths escaped their verified roots.' }
    if ((Get-Item -LiteralPath $fetchCache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to move a linked cache directory.' }
    Move-Item -LiteralPath $resolvedCache -Destination $backup
  }
  $stdout = Join-Path $privateDir "cold-server-$scenario.log"
  $stderr = Join-Path $privateDir "cold-server-$scenario.err.log"
  $started = Start-Process -FilePath $nodeBinary -ArgumentList @('"' + $nextCli + '"', 'dev', '-p', '3001') -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 150; $attempt++) {
    if ($started.HasExited) { throw "Next exited during cold scenario $scenario startup; see $stderr" }
    if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (!$ready) { throw "Server startup did not complete; see $stdout" }
  $env:RUN_LABEL = "followup-cold-$scenario"
  & $nodeBinary --import $tsxLoader (Join-Path $workspace 'tests/agent/http-09.mts') $scenario --follow > (Join-Path $privateDir "followup-cold-$scenario.log") 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Cold dialogue $scenario failed. The server remains running; inspect its saved transcript." }
  Write-Output "Cold dialogue $scenario completed; server launcher PID $($started.Id)."
}
