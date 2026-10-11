$log = "D:\Projects\desktop-dock\_compile_log.txt"
try {
  $code = Get-Content "D:\Projects\desktop-dock\tools\dock-helper.cs" -Raw
  $out = "D:\Projects\desktop-dock\tools\dock-helper2.exe"
  Add-Type -TypeDefinition $code -OutputAssembly $out -OutputType ConsoleApplication -ReferencedAssemblies System.Drawing -ErrorAction Stop
  if (Test-Path $out) { "compiled ok: $out" | Out-File -Encoding utf8 $log; exit 0 }
  "compile failed: no output" | Out-File -Encoding utf8 $log
  exit 1
} catch {
  ("compile error: " + $_.Exception.Message) | Out-File -Encoding utf8 $log
  exit 1
}
