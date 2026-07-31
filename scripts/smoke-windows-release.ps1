[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [ValidateRange(1, 100)]
    [int]$LifecycleCycles = 20,

    [string]$TrayOverflowButtonName = "显示隐藏的图标",

    [ValidateRange(0, 300)]
    [int]$InactiveMeasurementSeconds = 0,

    [switch]$SkipSyntheticDrag,

    [switch]$QuitWhenComplete
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

if (-not ("PhoeboNativeSmoke" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PhoeboNativeSmoke
{
    public delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr window, int index);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);

    public static IntPtr FindMainWindow(uint targetProcessId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, state) =>
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId != targetProcessId)
            {
                return true;
            }

            var text = new StringBuilder(256);
            GetWindowText(window, text, text.Capacity);
            Rect rect;
            GetWindowRect(window, out rect);
            if (
                text.ToString() == "Phoebo" &&
                rect.Right - rect.Left >= 100 &&
                rect.Bottom - rect.Top >= 100
            )
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static uint ForegroundProcessId()
    {
        uint processId;
        GetWindowThreadProcessId(GetForegroundWindow(), out processId);
        return processId;
    }

    public static bool IsNoActivate(IntPtr window)
    {
        const int GWL_EXSTYLE = -20;
        const int WS_EX_NOACTIVATE = 0x08000000;
        return (GetWindowLong(window, GWL_EXSTYLE) & WS_EX_NOACTIVATE) != 0;
    }

    public static bool IsTopMost(IntPtr window)
    {
        const int GWL_EXSTYLE = -20;
        const int WS_EX_TOPMOST = 0x00000008;
        return (GetWindowLong(window, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
    }

    public static uint ProcessIdAtPoint(int x, int y)
    {
        var point = new Point { X = x, Y = y };
        var hitWindow = WindowFromPoint(point);
        // Child WebView HWNDs belong to the same process tree, but resolving to
        // the root gives a stable top-level ownership diagnostic.
        var rootWindow = GetAncestor(hitWindow, 2);
        uint processId;
        GetWindowThreadProcessId(rootWindow, out processId);
        return processId;
    }
}
'@
}

function Assert-SmokeCondition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-UiElement {
    param([System.Windows.Automation.AutomationElement]$Element)

    if ($null -eq $Element) {
        throw "Expected UI Automation element was not found"
    }
    $pattern = $Element.GetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern
    )
    $pattern.Invoke()
    Start-Sleep -Milliseconds 120
}

function Find-DescendantByNameAndClass {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [string]$ClassName
    )

    $condition = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $Name
        )),
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty,
            $ClassName
        ))
    )
    return $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $condition
    )
}

function Open-PhoeboTrayMenu {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $trayButton = Find-DescendantByNameAndClass `
        -Root $root `
        -Name "Phoebo" `
        -ClassName "SystemTray.NormalButton"

    if ($null -eq $trayButton) {
        $overflowCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $TrayOverflowButtonName
        )
        $overflowButton = $root.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $overflowCondition
        )
        Invoke-UiElement $overflowButton
        $trayButtonWatch = [System.Diagnostics.Stopwatch]::StartNew()
        while (
            $null -eq $trayButton -and
            $trayButtonWatch.ElapsedMilliseconds -lt 2000
        ) {
            $trayButton = Find-DescendantByNameAndClass `
                -Root $root `
                -Name "Phoebo" `
                -ClassName "SystemTray.NormalButton"
            if ($null -eq $trayButton) {
                Start-Sleep -Milliseconds 25
            }
        }
    }

    Invoke-UiElement $trayButton
    $menuCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        "#32768"
    )
    $menu = $null
    $menuWatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($null -eq $menu -and $menuWatch.ElapsedMilliseconds -lt 2000) {
        $menu = $root.FindFirst(
            [System.Windows.Automation.TreeScope]::Children,
            $menuCondition
        )
        if ($null -eq $menu) {
            Start-Sleep -Milliseconds 25
        }
    }
    if ($null -eq $menu) {
        throw "Phoebo tray menu did not open"
    }
    return $menu
}

function Invoke-PhoeboMenuItem {
    param([string]$Name)

    $menu = Open-PhoeboTrayMenu
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $Name
    )
    $item = $menu.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $condition
    )
    if ($null -eq $item) {
        throw "Phoebo tray menu item '$Name' was not found"
    }
    Invoke-UiElement $item
}

function Wait-ForWindowVisibility {
    param(
        [bool]$Visible,
        [int]$TimeoutMilliseconds = 3000
    )

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $window = [PhoeboNativeSmoke]::FindMainWindow([uint32]$ProcessId)
        $actual = (
            $window -ne [IntPtr]::Zero -and
            [PhoeboNativeSmoke]::IsWindowVisible($window)
        )
        if ($actual -eq $Visible) {
            return
        }
        Start-Sleep -Milliseconds 25
    }
    throw "Phoebo window visibility did not become $Visible"
}

function Get-ProcessTreeIds {
    $allProcesses = @(Get-CimInstance Win32_Process |
        Select-Object ProcessId, ParentProcessId)
    $knownIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$knownIds.Add($ProcessId)

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

function Measure-NormalizedProcessTreeCpu {
    param([int]$Seconds)

    $processIds = @(Get-ProcessTreeIds)
    $before = @(Get-Process -Id $processIds -ErrorAction SilentlyContinue)
    if ($before.Id -notcontains $ProcessId) {
        throw "Phoebo exited before the CPU sample started"
    }
    $beforeCpuSecondsByProcessId = @{}
    foreach ($processSnapshot in $before) {
        $beforeCpuSecondsByProcessId[[int]$processSnapshot.Id] =
            [double]$processSnapshot.CPU
    }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Start-Sleep -Seconds $Seconds

    # Refresh the tree because WebView2 may replace a utility child while the
    # sample is running. The root process must remain alive throughout.
    $processIds = @(Get-ProcessTreeIds)
    $after = @(Get-Process -Id $processIds -ErrorAction SilentlyContinue)
    if ($after.Id -notcontains $ProcessId) {
        throw "Phoebo exited during the CPU sample"
    }
    $observedCpuSeconds = 0.0
    foreach ($processSnapshot in $after) {
        $snapshotProcessId = [int]$processSnapshot.Id
        $afterCpuSeconds = [double]$processSnapshot.CPU
        if ($beforeCpuSecondsByProcessId.ContainsKey($snapshotProcessId)) {
            $delta = (
                $afterCpuSeconds -
                [double]$beforeCpuSecondsByProcessId[$snapshotProcessId]
            )
            $observedCpuSeconds += [math]::Max(0, $delta)
        } else {
            $observedCpuSeconds += $afterCpuSeconds
        }
    }
    return (
        $observedCpuSeconds /
        $watch.Elapsed.TotalSeconds /
        [Environment]::ProcessorCount
    ) * 100
}

function Get-MainWindowRectangle {
    $window = [PhoeboNativeSmoke]::FindMainWindow([uint32]$ProcessId)
    if ($window -eq [IntPtr]::Zero) {
        throw "Phoebo main window was not found"
    }
    $rectangle = New-Object PhoeboNativeSmoke+Rect
    if (-not [PhoeboNativeSmoke]::GetWindowRect($window, [ref]$rectangle)) {
        throw "Could not read Phoebo's native window rectangle"
    }
    return $rectangle
}

function Test-DragAndFocus {
    # A tiny local WinForms probe avoids touching an existing editor or relying on
    # Windows 11 Notepad's process-redirection behavior.
    $focusProbe = New-Object System.Windows.Forms.Form
    $focusProbe.Text = "Phoebo Focus Probe"
    $focusProbe.Width = 420
    $focusProbe.Height = 180
    $focusProbe.StartPosition = "CenterScreen"
    try {
        $focusProbe.Show()
        [System.Windows.Forms.Application]::DoEvents()
        [void][PhoeboNativeSmoke]::SetForegroundWindow($focusProbe.Handle)
        Start-Sleep -Milliseconds 150

        $before = Get-MainWindowRectangle
        # Derive the hit point from the actual DPI-scaled native rectangle. This
        # remains correct when the reviewed logical pet viewport changes size.
        $startX = $before.Left + [int](($before.Right - $before.Left) / 2)
        $startY = $before.Top + [int](($before.Bottom - $before.Top) / 2)
        $endX = $startX - 180
        $endY = $startY - 120
        [void][PhoeboNativeSmoke]::SetCursorPos($startX, $startY)
        $hitProcessId = [PhoeboNativeSmoke]::ProcessIdAtPoint($startX, $startY)
        Assert-SmokeCondition (
            $hitProcessId -eq [uint32]$ProcessId
        ) "Drag start point belongs to process $hitProcessId instead of Phoebo"
        $mouseButtonDown = $false
        try {
            [PhoeboNativeSmoke]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
            $mouseButtonDown = $true
            # pointerdown reaches the WebView synchronously, but the Tauri
            # startDragging IPC crosses to the native event loop. Give that short
            # handshake time to begin before synthesizing cursor movement.
            Start-Sleep -Milliseconds 120
            foreach ($step in 1..10) {
                $x = [int]($startX + (($endX - $startX) * $step / 10))
                $y = [int]($startY + (($endY - $startY) * $step / 10))
                [void][PhoeboNativeSmoke]::SetCursorPos($x, $y)
                Start-Sleep -Milliseconds 20
            }
        }
        finally {
            if ($mouseButtonDown) {
                # Never leave the user's primary button logically held if window
                # movement or a probe call fails midway through the drag.
                [PhoeboNativeSmoke]::mouse_event(
                    0x0004,
                    0,
                    0,
                    0,
                    [UIntPtr]::Zero
                )
            }
        }
        Start-Sleep -Milliseconds 250

        $after = Get-MainWindowRectangle
        Assert-SmokeCondition (
            [math]::Abs($after.Left - $before.Left) -ge 100 -and
            [math]::Abs($after.Top - $before.Top) -ge 60
        ) (
            "Phoebo did not move during native dragging: " +
            "before=$($before.Left),$($before.Top); " +
            "after=$($after.Left),$($after.Top)"
        )
        Assert-SmokeCondition (
            [PhoeboNativeSmoke]::ForegroundProcessId() -eq [uint32]$PID
        ) "Dragging Phoebo stole keyboard focus from the focus probe"

        return [PSCustomObject]@{
            Before = "$($before.Left),$($before.Top)"
            After = "$($after.Left),$($after.Top)"
            ForegroundProcessId = [PhoeboNativeSmoke]::ForegroundProcessId()
        }
    }
    finally {
        $focusProbe.Close()
        $focusProbe.Dispose()
    }
}

$process = Get-Process -Id $ProcessId
$mainWindow = [PhoeboNativeSmoke]::FindMainWindow([uint32]$ProcessId)
Assert-SmokeCondition ($mainWindow -ne [IntPtr]::Zero) "Phoebo window was not found"
Assert-SmokeCondition (
    [PhoeboNativeSmoke]::IsNoActivate($mainWindow)
) "Phoebo window is missing WS_EX_NOACTIVATE"
Assert-SmokeCondition (
    [PhoeboNativeSmoke]::IsTopMost($mainWindow)
) "Phoebo did not start always-on-top"

$dragResult = if ($SkipSyntheticDrag) {
    $stationaryRectangle = Get-MainWindowRectangle
    [PSCustomObject]@{
        Before = "$($stationaryRectangle.Left),$($stationaryRectangle.Top)"
        After = "<synthetic drag skipped>"
        ForegroundProcessId = $null
    }
} else {
    Test-DragAndFocus
}

for ($cycle = 1; $cycle -le $LifecycleCycles; $cycle += 1) {
    Invoke-PhoeboMenuItem "Hide"
    Wait-ForWindowVisibility $false
    Invoke-PhoeboMenuItem "Show"
    Wait-ForWindowVisibility $true

    Invoke-PhoeboMenuItem "Pause Actions"
    Invoke-PhoeboMenuItem "Resume Actions"
}

Invoke-PhoeboMenuItem "Reset Position"
Start-Sleep -Milliseconds 250
$resetRectangle = Get-MainWindowRectangle
$workArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$resetWidth = $resetRectangle.Right - $resetRectangle.Left
$resetHeight = $resetRectangle.Bottom - $resetRectangle.Top
# The configured 120×130 size is logical. GetWindowRect reports the real size in
# this probe's coordinate space, which grows at 125%/150%/175% display scaling.
$expectedResetX = $workArea.Left + [int](($workArea.Width - $resetWidth) / 2)
$expectedResetY = $workArea.Top + [int](($workArea.Height - $resetHeight) / 2)
Assert-SmokeCondition (
    [math]::Abs($resetRectangle.Left - $expectedResetX) -le 2 -and
    [math]::Abs($resetRectangle.Top - $expectedResetY) -le 2
) "Reset Position did not center Phoebo in the primary work area"

Invoke-PhoeboMenuItem "Always on Top: On"
Start-Sleep -Milliseconds 150
Assert-SmokeCondition (
    -not [PhoeboNativeSmoke]::IsTopMost($mainWindow)
) "Always-on-top did not turn off"
Invoke-PhoeboMenuItem "Always on Top: Off"
Start-Sleep -Milliseconds 150
Assert-SmokeCondition (
    [PhoeboNativeSmoke]::IsTopMost($mainWindow)
) "Always-on-top did not turn back on"

$visibleCpuPercent = $null
$pausedCpuPercent = $null
$hiddenCpuPercent = $null
if ($InactiveMeasurementSeconds -gt 0) {
    # These are whole-process-tree measurements. Unit tests separately prove
    # that Phoebo owns no animation RAF or behavior timer while inactive; the
    # native sample records the remaining WebView2/OS baseline in each state.
    $visibleCpuPercent = Measure-NormalizedProcessTreeCpu `
        -Seconds $InactiveMeasurementSeconds

    Invoke-PhoeboMenuItem "Pause Actions"
    $pausedCpuPercent = Measure-NormalizedProcessTreeCpu `
        -Seconds $InactiveMeasurementSeconds
    Invoke-PhoeboMenuItem "Resume Actions"

    Invoke-PhoeboMenuItem "Hide"
    Wait-ForWindowVisibility $false
    $hiddenCpuPercent = Measure-NormalizedProcessTreeCpu `
        -Seconds $InactiveMeasurementSeconds
    Invoke-PhoeboMenuItem "Show"
    Wait-ForWindowVisibility $true
}

$result = [PSCustomObject]@{
    ProcessId = $ProcessId
    LifecycleCycles = $LifecycleCycles
    NoActivate = [PhoeboNativeSmoke]::IsNoActivate($mainWindow)
    SyntheticDragVerified = -not $SkipSyntheticDrag
    DragBefore = $dragResult.Before
    DragAfter = $dragResult.After
    FocusStayedWithProcessId = $dragResult.ForegroundProcessId
    ResetPosition = "$($resetRectangle.Left),$($resetRectangle.Top)"
    AlwaysOnTopRestored = [PhoeboNativeSmoke]::IsTopMost($mainWindow)
    InactiveMeasurementSeconds = $InactiveMeasurementSeconds
    VisibleNormalizedCpuPercent = $visibleCpuPercent
    PausedNormalizedCpuPercent = $pausedCpuPercent
    HiddenNormalizedCpuPercent = $hiddenCpuPercent
    QuitVerified = $false
}

if ($QuitWhenComplete) {
    Invoke-PhoeboMenuItem "Quit"
    if (-not $process.WaitForExit(5000)) {
        throw "Phoebo did not exit within five seconds"
    }
    $result.QuitVerified = $true
}

$result
