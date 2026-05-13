$ErrorActionPreference = "Stop"

$port = if ($env:PORT) { $env:PORT } else { "5010" }
$baseUrl = "http://127.0.0.1:$port"

if (-not (Test-Path "dist/index.cjs")) {
  throw "Built server not found. Run npm.cmd run build before npm.cmd run test:mvp."
}

Write-Host "Starting Donnit on $baseUrl..."
$server = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
  "-NoProfile",
  "-Command",
  "`$env:PORT='$port'; `$env:NODE_ENV='production'; node dist/index.cjs"
)

try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    throw "Donnit did not start at $baseUrl."
  }

  $env:PLAYWRIGHT_BASE_URL = $baseUrl
  Write-Host "Running MVP browser smoke tests..."
  & .\node_modules\.bin\playwright.cmd test --config=playwright.config.ts --reporter=line
  $testExit = $LASTEXITCODE
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}

exit $testExit
