@echo off
where node >nul 2>nul
if not errorlevel 1 (
  echo Node.js is already installed:
  node --version
  pause
  exit /b 0
)
echo Installing Node.js LTS with winget...
winget install -e --id OpenJS.NodeJS.LTS
if errorlevel 1 (
  echo Installation failed. Install Node.js LTS from https://nodejs.org/ by hand.
  pause
  exit /b 1
)
echo Done. Close this window and run the 1_ bat file. If node is still not found, restart the PC.
pause
