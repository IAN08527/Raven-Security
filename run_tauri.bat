@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul 2>&1
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d D:\sanyu\Raven-Security
npm run tauri dev > D:\sanyu\Raven-Security\tauri_dev.log 2>&1
