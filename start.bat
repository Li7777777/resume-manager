@echo off
REM Resume Manager one-click startup script
REM Double-click to start server and open browser in one step

setlocal

set "NODE_EXE=D:\nodejs\node.exe"
set "APP_DIR=E:\code\resume-manager"
set "LOG_DIR=C:\Users\Tech7\.resume-manager"

echo ==========================================
echo   Resume Manager
echo ==========================================

REM Check if port 8787 is already listening
netstat -ano 2>nul | findstr /C:"127.0.0.1:8787" | findstr /C:"LISTENING" >nul 2>&1
if %errorlevel%==0 goto already_running

echo Starting server...

REM Start server in background (detached process via PowerShell)
cd /d "%APP_DIR%"
powershell -NoProfile -Command "$env:NODE_ENV='production'; $env:PORT='8787'; Start-Process -FilePath '%NODE_EXE%' -ArgumentList 'server/index.js' -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%LOG_DIR%\server.log' -RedirectStandardError '%LOG_DIR%\server.err.log'"

REM Wait for server to be ready (max 20 seconds)
set /a count=0
:wait_loop
ping -n 2 127.0.0.1 >nul 2>&1
netstat -ano 2>nul | findstr /C:"127.0.0.1:8787" | findstr /C:"LISTENING" >nul 2>&1
if %errorlevel%==0 goto ready
set /a count+=1
if %count% geq 20 goto timeout
goto wait_loop

:ready
echo.
echo [OK] Server started successfully!
echo URL: http://127.0.0.1:8787
start http://127.0.0.1:8787
goto end

:already_running
echo.
echo [OK] Server is already running.
echo URL: http://127.0.0.1:8787
start http://127.0.0.1:8787
goto end

:timeout
echo.
echo [ERROR] Server failed to start within 20 seconds.
echo Please check logs:
echo   %LOG_DIR%\server.err.log
echo   %LOG_DIR%\server.log
echo.
echo You can also try starting manually:
echo   cd /d %APP_DIR%
echo   powershell -Command "Start-Process node -ArgumentList 'server/index.js'"

:end
echo.
echo Press any key to close this window...
pause >nul
endlocal
