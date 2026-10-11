# Toggle Windows taskbar auto-hide
# Usage: toggle-taskbar.ps1 hide | show
param([string]$mode = 'hide')

$path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3'
try {
    $settings = (Get-ItemProperty -Path $path -Name Settings -ErrorAction Stop).Settings
} catch {
    Write-Output "err: cannot read StuckRects3 - $($_.Exception.Message)"
    exit 1
}

# byte index 8: 0 = always show, 3 = auto-hide
$target = if ($mode -eq 'show') { 0 } else { 3 }

if ($settings[8] -eq $target) {
    Write-Output "already-$mode"
    exit 0
}

$settings[8] = $target
Set-ItemProperty -Path $path -Name Settings -Value $settings -Type Binary

# restart explorer so the change takes effect immediately
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue

Write-Output "set-$mode"
exit 0
