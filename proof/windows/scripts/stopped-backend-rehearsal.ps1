$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
Set-Location -LiteralPath $workspace
$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
$backend = $null
if ($listener) {
  $backend = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $listener[0].OwningProcess)
  if ($backend.Name -ne 'node.exe' -or $backend.CommandLine -notmatch 'server/index\.ts') {
    throw 'Refusing to stop an unrecognized service on the development backend port.'
  }
}
$previousFlag = $env:LOCKBOX_PROOF_REQUIRE_BACKEND_STOPPED
$result = 1
try {
  if ($backend) { Stop-Process -Id $backend.ProcessId }
  $env:LOCKBOX_PROOF_REQUIRE_BACKEND_STOPPED = '1'
  npm.cmd --prefix proof/windows run test:packaged
  $result = $LASTEXITCODE
} finally {
  $env:LOCKBOX_PROOF_REQUIRE_BACKEND_STOPPED = $previousFlag
  if ($backend) {
    $tag = [Guid]::NewGuid().ToString()
    $logRoot = Join-Path $workspace 'server/.data'
    Start-Process -FilePath $backend.ExecutablePath -ArgumentList @('--env-file-if-exists=server/.env', '--experimental-strip-types', 'server/index.ts') -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot ('native-proof-restart-' + $tag + '.log')) -RedirectStandardError (Join-Path $logRoot ('native-proof-restart-' + $tag + '.err')) | Out-Null
    $restored = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
      try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/healthz' -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $restored = $true; break }
      } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $restored) { throw 'The development backend did not become healthy after restoration.' }
    Write-Output 'Original development backend restored and healthy; no data initialization or migration command was run.'
  }
}
exit $result
