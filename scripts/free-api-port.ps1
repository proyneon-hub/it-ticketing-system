$port = if ($env:PORT) { [int]$env:PORT } else { 5000 }

# Find any process currently listening on the API port. This is useful when
# nodemon or a previous dev server is still holding port 5000.
$connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if ($connections) {
  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
} else {
  # Fallback for systems where Get-NetTCPConnection is unavailable or returns
  # nothing. netstat output is parsed to find listening TCP processes.
  $processIds = netstat -ano -p tcp |
    Select-String "LISTENING\s+\d+$" |
    ForEach-Object {
      $parts = $_.Line.Trim() -split '\s+'
      $localAddress = $parts[1]

      if ($localAddress -match ":$port$") {
        [int]$parts[-1]
      }
    } |
    Select-Object -Unique
}

if (-not $processIds) {
  Write-Host "Port $port is already free."
  exit 0
}

foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue

  if (-not $process) {
    Write-Host "No running process found for PID $processId."
    continue
  }

  # Stop only processes that are actually bound to the selected API port.
  Write-Host "Stopping PID $processId ($($process.ProcessName)) on port $port..."
  Stop-Process -Id $processId -Force
}

Write-Host "Port $port is free."
