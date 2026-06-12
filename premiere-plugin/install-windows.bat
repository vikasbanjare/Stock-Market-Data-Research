@echo off
REM CutPilot one-click installer for Windows.
REM Enables CEP debug mode (required for unsigned panels) and copies the
REM plugin into Premiere's extensions folder.

echo.
echo  Installing CutPilot for Premiere Pro...
echo.

for %%v in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

set "DEST=%APPDATA%\Adobe\CEP\extensions\CutPilot"
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%~dp0" "%DEST%\" /e /i /q /y >nul

if exist "%DEST%\index.html" (
  echo  Done!
  echo.
  echo  1. Restart Premiere Pro
  echo  2. Open:  Window ^> Extensions ^> CutPilot
) else (
  echo  Something went wrong - the files did not copy.
  echo  Copy this folder manually to: %DEST%
)
echo.
pause
