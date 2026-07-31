[CmdletBinding()]
param(
    [string]$ExecutablePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$distDirectory = Join-Path $projectRoot "dist"
$canonicalExecutablePath = Join-Path `
    $projectRoot `
    "src-tauri\target\release\phoebo-desktop-pet.exe"
if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
    $ExecutablePath = $canonicalExecutablePath
}
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedCanonicalExecutable = (
    Resolve-Path -LiteralPath $canonicalExecutablePath
).Path

function Assert-ReleaseCondition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-GzipLength {
    param([string]$Path)

    $sourceBytes = [System.IO.File]::ReadAllBytes($Path)
    $memoryStream = [System.IO.MemoryStream]::new()
    try {
        $gzipStream = [System.IO.Compression.GZipStream]::new(
            $memoryStream,
            [System.IO.Compression.CompressionLevel]::Optimal,
            $true
        )
        try {
            $gzipStream.Write($sourceBytes, 0, $sourceBytes.Length)
        }
        finally {
            $gzipStream.Dispose()
        }
        return $memoryStream.Length
    }
    finally {
        $memoryStream.Dispose()
    }
}

$distFiles = @(Get-ChildItem -LiteralPath $distDirectory -Recurse -File)
$webpFiles = @($distFiles | Where-Object Extension -eq ".webp")
$pngFiles = @($distFiles | Where-Object Extension -eq ".png")
$sourceMaps = @($distFiles | Where-Object Extension -eq ".map")
$frontendCode = @(
    $distFiles | Where-Object { $_.Extension -in @(".html", ".js", ".css") }
)

Assert-ReleaseCondition ($webpFiles.Count -eq 1) "Release must contain exactly one WebP atlas"
Assert-ReleaseCondition ($pngFiles.Count -eq 0) "Release must not contain generated PNG assets"
Assert-ReleaseCondition ($sourceMaps.Count -eq 0) "Release must not contain source maps"

$frontendGzipBytes = 0
foreach ($file in $frontendCode) {
    $frontendGzipBytes += Get-GzipLength -Path $file.FullName
}
Assert-ReleaseCondition (
    $frontendGzipBytes -lt 250KB
) "Compressed frontend code exceeds the 250 KiB budget"

$javascript = ($distFiles | Where-Object Extension -eq ".js" |
    ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
Assert-ReleaseCondition (
    $javascript -notmatch '\bfetch\s*\('
) "Release JavaScript unexpectedly contains fetch()"
Assert-ReleaseCondition (
    $javascript -notmatch 'MutationObserver'
) "Release JavaScript still contains the modulepreload MutationObserver polyfill"

$executable = Get-Item -LiteralPath $resolvedExecutable
Assert-ReleaseCondition (
    $executable.Length -lt 20MB
) "Release executable exceeds the 20 MiB budget"
$executableHash = (
    Get-FileHash -LiteralPath $resolvedExecutable -Algorithm SHA256
).Hash
$canonicalExecutableHash = (
    Get-FileHash -LiteralPath $resolvedCanonicalExecutable -Algorithm SHA256
).Hash
Assert-ReleaseCondition (
    $executableHash -eq $canonicalExecutableHash
) "Executable differs from the current reviewed release target"

$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") |
    ConvertFrom-Json
$runtimeDependencyNames = @($package.dependencies.PSObject.Properties.Name)
Assert-ReleaseCondition (
    ($runtimeDependencyNames -join ",") -eq "@tauri-apps/api"
) "Unexpected frontend runtime dependency set: $($runtimeDependencyNames -join ', ')"

$capability = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "src-tauri\capabilities\main-window.json"
) | ConvertFrom-Json
$actualPermissions = @($capability.permissions | Sort-Object)
$expectedPermissions = @(
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:window:allow-start-dragging"
) | Sort-Object
Assert-ReleaseCondition (
    @(Compare-Object $actualPermissions $expectedPermissions).Count -eq 0
) "Tauri capability differs from the reviewed allowlist"

$tauriConfig = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "src-tauri\tauri.conf.json"
) | ConvertFrom-Json
$windowsConfig = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "src-tauri\tauri.windows.conf.json"
) | ConvertFrom-Json
Assert-ReleaseCondition (
    $tauriConfig.bundle.active -eq $false
) "Installer bundling must remain disabled"
Assert-ReleaseCondition (
    @($tauriConfig.app.windows).Count -eq 1 -and
    $tauriConfig.app.windows[0].label -eq "main"
) "Release must contain exactly the reviewed main window"
$mainWindow = $tauriConfig.app.windows[0]
$viewportConfig = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "src\config\pet-viewport.json"
) | ConvertFrom-Json
$behaviorConfig = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "src\config\behaviors\default.behavior.json"
) | ConvertFrom-Json
$desktopSource = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "src-tauri\src\desktop.rs"
)
$indexSource = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "index.html"
)
$petCanvasMatchesReviewedSize = $indexSource -match (
    '(?s)<canvas\s+[^>]*id="pet-canvas"[^>]*' +
    'width="120"[^>]*height="130"[^>]*>'
)
# Tao otherwise inherits Windows' default minimum tracking width, which is wider
# than 120 px on the reference machine. Exact min/max constraints make the native
# client area and Canvas agree instead of leaving a transparent side strip.
Assert-ReleaseCondition (
    $mainWindow.width -eq 120 -and
    $mainWindow.height -eq 130 -and
    $mainWindow.minWidth -eq 120 -and
    $mainWindow.minHeight -eq 130 -and
    $mainWindow.maxWidth -eq 120 -and
    $mainWindow.maxHeight -eq 130 -and
    $viewportConfig.width -eq $mainWindow.width -and
    $viewportConfig.height -eq $mainWindow.height -and
    $desktopSource -match (
        'const MAIN_WINDOW_LOGICAL_WIDTH: f64 = 120\.0;'
    ) -and
    $desktopSource -match (
        'const MAIN_WINDOW_LOGICAL_HEIGHT: f64 = 130\.0;'
    ) -and
    $petCanvasMatchesReviewedSize -and
    $mainWindow.transparent -eq $true -and
    $mainWindow.visible -eq $false -and
    $mainWindow.focus -eq $false -and
    $mainWindow.focusable -eq $false -and
    $mainWindow.alwaysOnTop -eq $true -and
    $mainWindow.skipTaskbar -eq $true
) "Main window or Canvas no longer matches the reviewed 120 x 130 no-activate policy"
Assert-ReleaseCondition (
    $behaviorConfig.idleDelayMs.minimum -eq 60000 -and
    $behaviorConfig.idleDelayMs.maximum -eq 120000
) "Default random-action delay must stay within the reviewed 60–120 second range"

# Supplying additional browser arguments replaces Wry's own default string.
# Verify both Phoebo's no-background-network policy and every Wry default that
# we must carry forward explicitly.
$browserArguments = [string]$mainWindow.additionalBrowserArgs
$browserTokens = @(
    $browserArguments.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
)
$actualBrowserSwitches = @(
    $browserTokens |
        Where-Object { $_ -notlike "--disable-features=*" } |
        Sort-Object
)
$expectedBrowserSwitches = @(
    "--disable-background-networking"
    "--disable-component-update"
) | Sort-Object
Assert-ReleaseCondition (
    $actualBrowserSwitches.Count -eq $expectedBrowserSwitches.Count -and
    @(Compare-Object $actualBrowserSwitches $expectedBrowserSwitches).Count -eq 0
) "WebView2 browser switches differ from the reviewed no-network allowlist"
$expectedDisabledFeatures = @(
    "msWebOOUI",
    "msPdfOOUI",
    "msSmartScreenProtection"
) | Sort-Object
$disabledFeaturesArgument = @(
    $browserTokens |
        Where-Object { $_ -like "--disable-features=*" }
)
Assert-ReleaseCondition (
    $disabledFeaturesArgument.Count -eq 1
) "Release must define exactly one merged --disable-features argument"
$disabledFeatures = @(
    $disabledFeaturesArgument[0].Substring("--disable-features=".Length).Split(",") |
        Sort-Object
)
Assert-ReleaseCondition (
    $disabledFeatures.Count -eq $expectedDisabledFeatures.Count -and
    @(Compare-Object $disabledFeatures $expectedDisabledFeatures).Count -eq 0
) "Disabled WebView2 features differ from the reviewed Wry-default allowlist"
Assert-ReleaseCondition (
    $windowsConfig.bundle.windows.webviewInstallMode.type -eq "skip"
) "Windows build must use the installed system WebView2 runtime"

$assetHash = (Get-FileHash -LiteralPath $webpFiles[0].FullName -Algorithm SHA256).Hash
Assert-ReleaseCondition (
    $assetHash -eq "231C5BE5FB9ED9C1E1F027742FD1500AEEE6018F6ED9C9EAB360ABF34FAAAA70"
) "Bundled Phoebo atlas hash differs from the verified source"

[PSCustomObject]@{
    Executable = $resolvedExecutable
    ExecutableBytes = $executable.Length
    ExecutableSha256 = $executableHash
    FrontendGzipBytes = $frontendGzipBytes
    WebpCount = $webpFiles.Count
    WebpBytes = $webpFiles[0].Length
    SourceMapCount = $sourceMaps.Count
    PngCount = $pngFiles.Count
    RuntimeDependencies = $runtimeDependencyNames -join ","
    CapabilityPermissions = $actualPermissions -join ","
    WebViewBackgroundNetworking = "disabled"
    WebViewInstallMode = $windowsConfig.bundle.windows.webviewInstallMode.type
}
