@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Run the 0_ bat file first.
  pause
  exit /b 1
)
node "%~dp0collect.js" "%~dp0.." --no-pause
if errorlevel 1 (
  pause
  exit /b 1
)
node "%~dp0upload.js" "%~dp0.." --auto
