$cacheDir = "D:\Projects\desktop-dock\icon-cache"
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
$helper = "D:\Projects\desktop-dock\tools\dock-helper2.exe"
$md5 = [System.Security.Cryptography.MD5]::Create()
$paths = Get-Content "D:\Projects\desktop-dock\_paths.txt" -Encoding UTF8 | Where-Object { $_ -ne '' }
$ok = 0; $fail = 0
foreach ($p in $paths) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($p.ToLower())
  $hash = ($md5.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ''
  $out = Join-Path $cacheDir "$hash.png"
  if (Test-Path $out) { $ok++; continue }
  & $helper icon $p $out 2>$null | Out-Null
  if (Test-Path $out) { $ok++ } else { $fail++ }
}
"done ok=$ok fail=$fail" | Out-File -Encoding utf8 "D:\Projects\desktop-dock\_extract_log.txt"
