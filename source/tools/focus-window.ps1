param([string]$hwndStr, [string]$procId = "")
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
$ok = $false
try {
  $hwnd = [IntPtr]::new([long]$hwndStr)
  # 1. 还原最小化窗口 (SW_RESTORE = 9)
  [Win32Focus]::ShowWindowAsync($hwnd, 9) | Out-Null
  # 2. AttachThreadInput 绕过前台锁：附到当前前台线程后再设前台
  $fg = [Win32Focus]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero) {
    [uint32]$fgPid = 0
    $fgThread = [Win32Focus]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    $curThread = [Win32Focus]::GetCurrentThreadId()
    if ($fgThread -ne 0 -and $fgThread -ne $curThread) {
      [Win32Focus]::AttachThreadInput($curThread, $fgThread, $true) | Out-Null
      [Win32Focus]::BringWindowToTop($hwnd) | Out-Null
      $ok = [Win32Focus]::SetForegroundWindow($hwnd)
      [Win32Focus]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
    }
  }
  if (-not $ok) {
    [Win32Focus]::BringWindowToTop($hwnd) | Out-Null
    $ok = [Win32Focus]::SetForegroundWindow($hwnd)
  }
} catch { $ok = $false }

# 3. 兜底：AppActivate（内部有按键模拟，可绕部分限制）
if (-not $ok -and $procId -ne "") {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $ok = $ws.AppActivate([int]$procId)
  } catch { $ok = $false }
}
if ($ok) { exit 0 } else { exit 1 }
