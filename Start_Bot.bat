@echo off
:: This line ensures the terminal looks inside the current folder
cd /d "%~dp0"

:: This runs your index.js using the node.exe in this same folder
.\node.exe src\index.js

:: This keeps the window open so you can see errors if it crashes
pause