[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [ValidateRange(1, 1440)]
    [int]$DurationMinutes = 30,

    [ValidateRange(1, 60)]
    [int]$SampleSeconds = 10,

    [string]$OutputDirectory,

    [switch]$StopWhenComplete
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("PhoeboWindowProbe" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PhoeboWindowProbe
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    public static bool HasVisibleWindow(uint targetProcessId)
    {
        bool found = false;
        EnumWindows((window, state) =>
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != targetProcessId || !IsWindowVisible(window))
            {
                return true;
            }

            var title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            Rect rect;
            GetWindowRect(window, out rect);
            if (
                title.ToString() == "Phoebo" &&
                rect.Right - rect.Left >= 100 &&
                rect.Bottom - rect.Top >= 100
            )
            {
                found = true;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
}

function Get-ProcessTreeIds {
    param([int]$RootProcessId)

    $allProcesses = @(Get-CimInstance Win32_Process |
        Select-Object ProcessId, ParentProcessId)
    $knownIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$knownIds.Add($RootProcessId)

    do {
        $added = $false
        foreach ($candidate in $allProcesses) {
            if (
                $knownIds.Contains([int]$candidate.ParentProcessId) -and
                $knownIds.Add([int]$candidate.ProcessId)
            ) {
                $added = $true
            }
        }
    } while ($added)

    return @($knownIds)
}

function Test-IsExternalAddress {
    param([string]$Address)

    $parsedAddress = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsedAddress)) {
        # An unfamiliar address is safer to flag for review than to silently
        # classify as local.
        return $true
    }

    return (
        -not [System.Net.IPAddress]::IsLoopback($parsedAddress) -and
        -not $parsedAddress.Equals([System.Net.IPAddress]::Any) -and
        -not $parsedAddress.Equals([System.Net.IPAddress]::IPv6Any)
    )
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputDirectory = Join-Path $projectRoot "artifacts\measurements\$timestamp"
}
if (Test-Path -LiteralPath $OutputDirectory) {
    $existingOutput = @(Get-ChildItem -LiteralPath $OutputDirectory -Force)
    if ($existingOutput.Count -gt 0) {
        throw "Measurement output directory must be empty: $OutputDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}

$startedAt = Get-Date
$launchWatch = [System.Diagnostics.Stopwatch]::StartNew()
$rootProcess = Start-Process -FilePath $resolvedExecutable -PassThru
$firstVisibleFrameMs = $null

try {
    # The native window is configured hidden and is shown only after the atlas has
    # decoded and the first neutral frame is painted. Its first visible top-level
    # window is therefore a practical upper bound for first-visible-frame latency.
    while ($launchWatch.Elapsed.TotalSeconds -lt 30) {
        $rootProcess.Refresh()
        if ($rootProcess.HasExited) {
            throw "Phoebo exited before its first window became visible"
        }
        if ([PhoeboWindowProbe]::HasVisibleWindow([uint32]$rootProcess.Id)) {
            $firstVisibleFrameMs = [math]::Round($launchWatch.Elapsed.TotalMilliseconds, 1)
            break
        }
        Start-Sleep -Milliseconds 20
    }
    if ($null -eq $firstVisibleFrameMs) {
        throw "Phoebo did not expose a visible window within 30 seconds"
    }

    $measurementWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $durationSeconds = $DurationMinutes * 60
    $samples = [System.Collections.Generic.List[object]]::new()
    $tcpObservations = [System.Collections.Generic.List[object]]::new()
    $tcpMeasurementUnavailableSampleCount = 0
    $previousCpuSecondsByProcessId = @{}
    $observedCumulativeCpuSeconds = 0.0

    while ($true) {
        $elapsedSeconds = $measurementWatch.Elapsed.TotalSeconds
        $rootProcess.Refresh()
        if ($rootProcess.HasExited) {
            throw "Phoebo's root process exited during measurement"
        }
        $processIds = @(Get-ProcessTreeIds -RootProcessId $rootProcess.Id)
        $processes = @(Get-Process -Id $processIds -ErrorAction SilentlyContinue)
        if ($processes.Count -eq 0) {
            throw "Phoebo's process tree exited during measurement"
        }

        $cpuSeconds = ($processes | Measure-Object -Property CPU -Sum).Sum
        $currentProcessIds = [System.Collections.Generic.HashSet[int]]::new()
        foreach ($process in $processes) {
            $processId = [int]$process.Id
            [void]$currentProcessIds.Add($processId)
            $currentCpuSeconds = [double]$process.CPU
            if ($previousCpuSecondsByProcessId.ContainsKey($processId)) {
                $cpuDelta = (
                    $currentCpuSeconds -
                    [double]$previousCpuSecondsByProcessId[$processId]
                )
                if ($cpuDelta -ge 0) {
                    $observedCumulativeCpuSeconds += $cpuDelta
                } else {
                    # A reused PID has a lower lifetime counter. Treat it as a new
                    # process whose observed CPU all belongs to this interval.
                    $observedCumulativeCpuSeconds += $currentCpuSeconds
                }
            } elseif ($samples.Count -gt 0) {
                # A child created after the first baseline accumulated all of its
                # lifetime CPU during the measured interval.
                $observedCumulativeCpuSeconds += $currentCpuSeconds
            }
            $previousCpuSecondsByProcessId[$processId] = $currentCpuSeconds
        }
        foreach ($knownProcessId in @($previousCpuSecondsByProcessId.Keys)) {
            if (-not $currentProcessIds.Contains([int]$knownProcessId)) {
                [void]$previousCpuSecondsByProcessId.Remove($knownProcessId)
            }
        }
        $workingSetBytes = ($processes | Measure-Object -Property WorkingSet64 -Sum).Sum
        $privateBytes = ($processes | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
        try {
            $tcpConnections = @(
                Get-NetTCPConnection -ErrorAction Stop |
                    Where-Object { $processIds -contains $_.OwningProcess }
            )
            $tcpConnectionCount = $tcpConnections.Count
            foreach ($connection in $tcpConnections) {
                $ownerProcess = $processes |
                    Where-Object Id -eq $connection.OwningProcess |
                    Select-Object -First 1
                $tcpObservations.Add([PSCustomObject]@{
                    ElapsedSeconds = [math]::Round($elapsedSeconds, 3)
                    OwningProcess = $connection.OwningProcess
                    ProcessName = if ($null -ne $ownerProcess) {
                        $ownerProcess.ProcessName
                    } else {
                        "<exited>"
                    }
                    State = [string]$connection.State
                    LocalAddress = $connection.LocalAddress
                    LocalPort = $connection.LocalPort
                    RemoteAddress = $connection.RemoteAddress
                    RemotePort = $connection.RemotePort
                })
            }
        }
        catch {
            # -1 distinguishes "measurement unavailable" from a verified zero.
            $tcpConnectionCount = -1
            $tcpMeasurementUnavailableSampleCount += 1
        }

        $samples.Add([PSCustomObject]@{
            ElapsedSeconds = [math]::Round($elapsedSeconds, 3)
            ProcessCount = $processes.Count
            CpuSeconds = [math]::Round([double]$cpuSeconds, 6)
            ObservedCumulativeCpuSeconds =
                [math]::Round($observedCumulativeCpuSeconds, 6)
            WorkingSetBytes = [int64]$workingSetBytes
            PrivateBytes = [int64]$privateBytes
            TcpConnectionCount = $tcpConnectionCount
        })

        if ($elapsedSeconds -ge $durationSeconds) {
            break
        }
        Start-Sleep -Seconds $SampleSeconds
    }

    $csvPath = Join-Path $OutputDirectory "samples.csv"
    $samples | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding utf8
    if ($tcpObservations.Count -gt 0) {
        $tcpObservations |
            Export-Csv `
                -LiteralPath (Join-Path $OutputDirectory "tcp-connections.csv") `
                -NoTypeInformation `
                -Encoding utf8
    }

    $minuteFiveWindow = @(
        $samples | Where-Object {
            $_.ElapsedSeconds -ge 270 -and $_.ElapsedSeconds -le 330
        }
    )
    $lastMinuteStart = [math]::Max(0, $durationSeconds - 60)
    $finalWindow = @(
        $samples | Where-Object { $_.ElapsedSeconds -ge $lastMinuteStart }
    )
    $minuteFiveWorkingSet = if ($minuteFiveWindow.Count -gt 0) {
        ($minuteFiveWindow | Measure-Object -Property WorkingSetBytes -Average).Average
    } else {
        $null
    }
    $minuteFivePrivateBytes = if ($minuteFiveWindow.Count -gt 0) {
        ($minuteFiveWindow | Measure-Object -Property PrivateBytes -Average).Average
    } else {
        $null
    }
    $finalWorkingSet = ($finalWindow |
        Measure-Object -Property WorkingSetBytes -Average).Average
    $finalPrivateBytes = ($finalWindow |
        Measure-Object -Property PrivateBytes -Average).Average
    $memoryGrowthPercent = if (
        $null -ne $minuteFiveWorkingSet -and
        $minuteFiveWorkingSet -gt 0
    ) {
        (($finalWorkingSet - $minuteFiveWorkingSet) / $minuteFiveWorkingSet) * 100
    } else {
        $null
    }
    $privateMemoryGrowthPercent = if (
        $null -ne $minuteFivePrivateBytes -and
        $minuteFivePrivateBytes -gt 0
    ) {
        (
            ($finalPrivateBytes - $minuteFivePrivateBytes) /
            $minuteFivePrivateBytes
        ) * 100
    } else {
        $null
    }
    $lastSample = $samples[$samples.Count - 1]
    $measuredSeconds = $lastSample.ElapsedSeconds - $samples[0].ElapsedSeconds
    $averageNormalizedCpuPercent = if ($measuredSeconds -gt 0) {
        (
            $lastSample.ObservedCumulativeCpuSeconds /
            $measuredSeconds /
            [Environment]::ProcessorCount
        ) * 100
    } else {
        $null
    }
    $externalConnections = @(
        $tcpObservations | Where-Object {
            Test-IsExternalAddress -Address $_.RemoteAddress
        }
    )
    $uniqueExternalConnections = @(
        $externalConnections |
            Group-Object {
                "$($_.OwningProcess)|$($_.LocalAddress)|$($_.LocalPort)|" +
                    "$($_.RemoteAddress)|$($_.RemotePort)"
            }
    )

    $summary = [PSCustomObject]@{
        Executable = $resolvedExecutable
        StartedAt = $startedAt.ToString("o")
        DurationMinutes = $DurationMinutes
        SampleSeconds = $SampleSeconds
        FirstVisibleFrameMs = $firstVisibleFrameMs
        SampleCount = $samples.Count
        PeakProcessCount = ($samples | Measure-Object -Property ProcessCount -Maximum).Maximum
        PeakWorkingSetBytes = ($samples |
            Measure-Object -Property WorkingSetBytes -Maximum).Maximum
        PeakPrivateBytes = ($samples |
            Measure-Object -Property PrivateBytes -Maximum).Maximum
        MinuteFiveWorkingSetBytes = $minuteFiveWorkingSet
        FinalMinuteWorkingSetBytes = $finalWorkingSet
        MemoryGrowthPercent = $memoryGrowthPercent
        MinuteFivePrivateBytes = $minuteFivePrivateBytes
        FinalMinutePrivateBytes = $finalPrivateBytes
        PrivateMemoryGrowthPercent = $privateMemoryGrowthPercent
        AverageNormalizedCpuPercent = $averageNormalizedCpuPercent
        MaximumTcpConnectionCount = ($samples |
            Measure-Object -Property TcpConnectionCount -Maximum).Maximum
        TcpMeasurementUnavailableSampleCount =
            $tcpMeasurementUnavailableSampleCount
        ExternalConnectionObservationCount = $externalConnections.Count
        UniqueExternalConnectionCount = $uniqueExternalConnections.Count
        LogicalProcessorCount = [Environment]::ProcessorCount
    }
    $summaryPath = Join-Path $OutputDirectory "summary.json"
    $summary | ConvertTo-Json | Set-Content -LiteralPath $summaryPath -Encoding utf8
    $summary
    if ($tcpMeasurementUnavailableSampleCount -gt 0) {
        throw (
            "TCP measurement was unavailable for " +
            "$tcpMeasurementUnavailableSampleCount sample(s)"
        )
    }
    if ($externalConnections.Count -gt 0) {
        throw (
            "Observed $($externalConnections.Count) external TCP connection " +
            "sample(s); inspect tcp-connections.csv"
        )
    }
}
finally {
    if ($StopWhenComplete) {
        $rootProcess.Refresh()
        if (-not $rootProcess.HasExited) {
            # Stop only the process launched by this measurement invocation. Its
            # WebView2 children are owned by the app and terminate with the parent.
            Stop-Process -Id $rootProcess.Id
            $rootProcess.WaitForExit(5000) | Out-Null
        }
    }
}
