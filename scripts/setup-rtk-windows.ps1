# RTK (CLI 토큰 절감 프록시) Windows 설치 스크립트
# 사용법: Windows PowerShell에서 실행
#   powershell -ExecutionPolicy Bypass -File scripts/setup-rtk-windows.ps1
#
# 1) rtk-ai/rtk 최신 릴리스에서 Windows(x86_64-pc-windows-msvc) 빌드를 내려받아 압축 해제
# 2) 사용자 PATH에 설치 경로 등록
# 3) `rtk init -g` 로 Claude Code PreToolUse 훅 설치
# 4) `rtk init --show` 로 설치 상태 확인

$ErrorActionPreference = "Stop"

$Repo = "rtk-ai/rtk"
$InstallDir = Join-Path $env:LOCALAPPDATA "rtk"

Write-Host "==> $Repo 최신 릴리스 조회 중..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "*pc-windows-msvc.zip" } | Select-Object -First 1
if (-not $asset) {
    throw "최신 릴리스($($release.tag_name))에서 Windows(msvc) 빌드를 찾지 못했습니다."
}
Write-Host "    버전: $($release.tag_name) / 파일: $($asset.name)"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$zipPath = Join-Path $env:TEMP $asset.name

Write-Host "==> 다운로드 중: $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath

Write-Host "==> 압축 해제: $InstallDir"
Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
Remove-Item $zipPath

$exe = Get-ChildItem -Path $InstallDir -Filter "rtk.exe" -Recurse | Select-Object -First 1
if (-not $exe) {
    throw "압축 해제 후 rtk.exe를 찾지 못했습니다."
}
if ($exe.DirectoryName -ne $InstallDir) {
    Copy-Item $exe.FullName -Destination $InstallDir -Force
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
    Write-Host "==> 사용자 PATH에 등록: $InstallDir"
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
} else {
    Write-Host "==> 이미 PATH에 등록되어 있음: $InstallDir"
}
$env:Path = "$env:Path;$InstallDir"

Write-Host "==> rtk init -g (Claude Code 훅 설치)"
& "$InstallDir\rtk.exe" init -g

Write-Host "==> rtk init --show (설치 확인)"
& "$InstallDir\rtk.exe" init --show

Write-Host ""
Write-Host "완료. 열려 있는 터미널/Claude Code를 재시작해야 PATH와 훅 변경사항이 적용됩니다."
