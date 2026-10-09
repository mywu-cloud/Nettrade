@echo off
REM Windows 工作排程器用：動作 = 啟動程式 → 此 .bat，觸發 = 每週一到五 18:40
cd /d "%~dp0\.."
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
if not exist archive mkdir archive
python -m scraper.main >> archive\run.log 2>&1
REM git add web/data archive && git commit -m "data update" && git push
