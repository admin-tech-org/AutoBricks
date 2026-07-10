@echo off
rem ===================================================================
rem  Launch a real Chrome with remote-debugging-port 9222 so the
rem  Playwright MCP can take it over via CDP. Just run this once.
rem  A real Chrome profile = no automation fingerprint, so pages that
rem  block headless scrapers render normally. If a target site needs a
rem  login, log in once in this window; the session is kept in the
rem  sibling .chrome_cdp profile (gitignored), so you only log in once.
rem  -- This is a template: setup copies it into the USER project's .browser/.
rem  (ASCII-only on purpose: avoids garbled output on non-UTF-8 consoles.)
rem ===================================================================
setlocal
set "PROFILE=%~dp0.chrome_cdp"
set "OUT=%~dp0out"
if not exist "%OUT%" mkdir "%OUT%"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [x] chrome.exe not found. Edit this .bat and set CHROME to your Chrome path.
  pause
  exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%"
echo [ok] Chrome launched with CDP debug port 9222
echo      profile: %PROFILE%
echo.
echo  Next: keep this Chrome open. Claude Code's Playwright MCP attaches
echo        to port 9222 on demand (no restart needed).
rem  Use ping instead of timeout: timeout fails when stdin is redirected
rem  (e.g. launched non-interactively via cmd //c).
ping -n 5 127.0.0.1 >nul
