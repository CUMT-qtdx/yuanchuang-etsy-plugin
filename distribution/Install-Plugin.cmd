@echo off
chcp 65001 >nul
echo 元创生图插件安装
echo 请先将压缩包全部解压，并通过“应用 - 退出”完全退出 DSH。
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-plugin.ps1" %*
if errorlevel 1 (
  echo.
  echo 安装未完成，请查看上面的提示，处理后重新双击本文件。
  pause
  exit /b 1
)
echo.
pause
