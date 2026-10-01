<#
.SYNOPSIS
  Diagnostic socket and JVM load sampler for test harness and emulator runs.
.DESCRIPTION
  Samples Get-NetTCPConnection once per second, filtering to emulator, Vite,
  and harness leased port ranges. Records peak Established, peak TimeWait,
  JVM (Java) process count, and listener count.
.PARAMETER Command
  Optional command line to run and monitor until completion.
.PARAMETER OutputFile
  Optional path to write JSON sample data to.
.PARAMETER IntervalSeconds
  Sampling interval in seconds (default 1).
#>
param(
    [string]$Command,
    [string]$OutputFile,
    [double]$IntervalSeconds = 1.0
)

function Test-PortMatch([int]$Port) {
    return (
        ($Port -ge 8080 -and $Port -le 8200) -or
        ($Port -eq 9099) -or
        ($Port -ge 9150 -and $Port -le 9170) -or
        ($Port -ge 4173 -and $Port -le 4174) -or
        ($Port -ge 4400 -and $Port -le 4430) -or
        ($Port -ge 4500 -and $Port -le 4530) -or
        ($Port -ge 20000 -and $Port -le 39999)
    )
}

$samples = [System.Collections.Generic.List[PSCustomObject]]::new()
$peakEstablished = 0
$peakTimeWait = 0
$peakListeners = 0
$peakJvmCount = 0

$proc = $null
if ($Command) {
    Write-Host "[socket-sample] Launching command: $Command" -ForegroundColor Cyan
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = "pwsh"
    $pinfo.Arguments = "-NoProfile -Command $Command"
    $pinfo.UseShellExecute = $false
    $pinfo.RedirectStandardOutput = $false
    $pinfo.RedirectStandardError = $false
    $proc = [System.Diagnostics.Process]::Start($pinfo)
}

$portPeakTimeWait = @{}

try {
    while ($true) {
        $timestamp = (Get-Date).ToString("o")
        $conns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
            (Test-PortMatch $_.LocalPort) -or (Test-PortMatch $_.RemotePort)
        }

        $established = @($conns | Where-Object { $_.State -eq 'Established' }).Count
        $timeWait = @($conns | Where-Object { $_.State -eq 'TimeWait' }).Count
        $listeners = @($conns | Where-Object { $_.State -eq 'Listen' }).Count
        $jvmCount = @(Get-Process -Name java -ErrorAction SilentlyContinue).Count

        $currentPortTW = @{}
        $conns | Where-Object { $_.State -eq 'TimeWait' } | ForEach-Object {
            $p = if (Test-PortMatch $_.LocalPort) { $_.LocalPort } else { $_.RemotePort }
            if ($currentPortTW.ContainsKey($p)) {
                $currentPortTW[$p]++
            } else {
                $currentPortTW[$p] = 1
            }
        }
        foreach ($p in $currentPortTW.Keys) {
            if (-not $portPeakTimeWait.ContainsKey($p) -or $currentPortTW[$p] -gt $portPeakTimeWait[$p]) {
                $portPeakTimeWait[$p] = $currentPortTW[$p]
            }
        }

        if ($established -gt $peakEstablished) { $peakEstablished = $established }
        if ($timeWait -gt $peakTimeWait) { $peakTimeWait = $timeWait }
        if ($listeners -gt $peakListeners) { $peakListeners = $listeners }
        if ($jvmCount -gt $peakJvmCount) { $peakJvmCount = $jvmCount }

        $sample = [PSCustomObject]@{
            Timestamp    = $timestamp
            Established  = $established
            TimeWait     = $timeWait
            Listeners    = $listeners
            JvmCount     = $jvmCount
        }
        $samples.Add($sample)

        if ($proc -ne $null -and $proc.HasExited) {
            break
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
}
finally {
    if ($proc -ne $null -and -not $proc.HasExited) {
        $proc.WaitForExit()
    }
}

Write-Host "`n=== Socket & Process Load Summary ===" -ForegroundColor Green
Write-Host "Total Samples     : $($samples.Count)"
Write-Host "Peak Established  : $peakEstablished"
Write-Host "Peak TimeWait     : $peakTimeWait"
Write-Host "Peak Listeners    : $peakListeners"
Write-Host "Peak JVM (java)   : $peakJvmCount"
Write-Host "Peak TimeWait By Port:"
$portPeakTimeWait.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    Write-Host "  Port $($_.Key): $($_.Value)"
}

$summary = [PSCustomObject]@{
    TotalSamples     = $samples.Count
    PeakEstablished  = $peakEstablished
    PeakTimeWait     = $peakTimeWait
    PeakListeners    = $peakListeners
    PeakJvmCount     = $peakJvmCount
    PortPeakTimeWait = $portPeakTimeWait
    Samples          = $samples
}

if ($OutputFile) {
    $parentDir = Split-Path -Parent $OutputFile
    if ($parentDir -and -not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }
    $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $OutputFile -Encoding utf8
    Write-Host "Saved sample trace to $OutputFile" -ForegroundColor Gray
}

if ($proc -ne $null) {
    exit $proc.ExitCode
}
