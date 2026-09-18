@echo off
rem Copy this script and launch-chrome-cdp.mjs into the project's .browser/.
rem Node 22+ reads cdp.env beside the scripts; optional first argument overrides the port.
node "%~dp0launch-chrome-cdp.mjs" %*
exit /b %errorlevel%
