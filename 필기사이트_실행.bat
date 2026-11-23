@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python313\python.exe"
set "PYTHON_ARGS="

if not exist "%PYTHON_EXE%" (
    py -3.13 --version >nul 2>&1
    if errorlevel 1 (
        echo Python 3.13 was not found.
        echo Check the Python installation and try again.
        pause
        exit /b 1
    )
    set "PYTHON_EXE=py"
    set "PYTHON_ARGS=-3.13"
)

"%PYTHON_EXE%" %PYTHON_ARGS% notes-site\manage.py migrate --noinput
if errorlevel 1 (
    echo Failed to prepare the database.
    pause
    exit /b 1
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000'"
"%PYTHON_EXE%" %PYTHON_ARGS% notes-site\manage.py runserver 127.0.0.1:8000
pause
