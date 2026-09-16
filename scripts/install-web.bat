@echo off
setlocal EnableExtensions

set "PACKAGE_SPEC=@maoleijin/dsh-mattpocock-skills"
if not "%~1"=="" set "PACKAGE_SPEC=%~1"

where node >nul 2>&1 || (
  echo ERROR: Node.js is not available in PATH. 1>&2
  exit /b 1
)

where pnpm >nul 2>&1 || (
  echo ERROR: pnpm is not available in PATH. 1>&2
  exit /b 1
)

echo Installing %PACKAGE_SPEC% into the DSH web profile...
call npx --yes @deepseek-ai/dsh plugin --profile web add "%PACKAGE_SPEC%"
if errorlevel 1 exit /b 1

echo.
echo Verifying provider registration...
call npx --yes @deepseek-ai/dsh --profile web --dump-config | findstr /i "mattpocock"
if errorlevel 1 (
  echo ERROR: The web profile did not expose the mattpocock provider. 1>&2
  exit /b 1
)

echo.
echo Installation complete. Restart dsh web and create a new session.
echo For Desktop, the package must first be listed in the configured plugin market.
exit /b 0
