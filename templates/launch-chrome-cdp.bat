@echo off
rem ===================================================================
rem  Launch a real Chrome with a CDP remote-debugging port so the
rem  Playwright MCP can take it over. A real Chrome profile = no
rem  automation fingerprint. Log in once if a site needs it; the
rem  session is kept in the profile dir (gitignored).
rem
rem  Config (both optional, arg wins over file):
rem    1) cdp.env file next to this script, KEY=VALUE lines:
rem         CDP_PORT=9333
rem         PROFILE_DIR=.chrome_cdp-myplugin   (relative to this folder)
rem         CHROME_PATH=C:\path\to\chrome.exe
rem    2) first argument = port:  launch-chrome-cdp.bat 9333
rem  Different port => different profile dir automatically (a Chrome
rem  profile can only run ONE instance; sharing one profile across
rem  ports silently ignores the new port).
rem  -- This is a template: setup copies it into the USER project's .browser/.
rem  (ASCII-only on purpose: avoids garbled output on non-UTF-8 consoles.)
rem ===================================================================
setlocal
set "PORT=9222"
set "PROFILE_DIR="
set "CHROME_PATH="

if exist "%~dp0cdp.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0cdp.env") do (
    if /i "%%A"=="CDP_PORT" set "PORT=%%B"
    if /i "%%A"=="PROFILE_DIR" set "PROFILE_DIR=%%B"
    if /i "%%A"=="CHROME_PATH" set "CHROME_PATH=%%B"
  )
)
if not "%~1"=="" set "PORT=%~1"

if "%PROFILE_DIR%"=="" (
  if "%PORT%"=="9222" ( set "PROFILE_DIR=.chrome_cdp" ) else ( set "PROFILE_DIR=.chrome_cdp-%PORT%" )
)
rem absolute path (has drive colon) is used as-is, else relative to this folder
if "%PROFILE_DIR:~1,1%"==":" ( set "PROFILE=%PROFILE_DIR%" ) else ( set "PROFILE=%~dp0%PROFILE_DIR%" )

set "OUT=%~dp0out"
if not exist "%OUT%" mkdir "%OUT%"

set "CHROME=%CHROME_PATH%"
if not exist "%CHROME%" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [x] chrome.exe not found. Set CHROME_PATH in cdp.env or edit this .bat.
  pause
  exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%"
echo [ok] Chrome launched with CDP debug port %PORT%
echo      profile: %PROFILE%
echo.
echo  Next: keep this Chrome open. The Playwright MCP attaches to
echo        port %PORT% on demand (no restart needed). If the port is
echo        not 9222, point the client at it (AutoBricks: set
echo        PLAYWRIGHT_CDP_URL=http://127.0.0.1:%PORT%).
rem  Use ping instead of timeout: timeout fails when stdin is redirected
rem  (e.g. launched non-interactively via cmd //c).
ping -n 5 127.0.0.1 >nul
