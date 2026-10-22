@echo off
rem Starts the Document Vault Companion in this window. Close the window or press Ctrl+C to stop it.
title Document Vault Companion
cd /d "%~dp0"
node --disable-warning=ExperimentalWarning bin\companion.js %*
if errorlevel 1 pause
