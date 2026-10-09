#!/usr/bin/env bash
# 本機排程用（macOS / Linux crontab）
#   crontab -e  →  40 18 * * 1-5 /path/to/tw-chip-rank/scripts/run_daily.sh >> /tmp/chip-rank.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] && source .venv/bin/activate
export TZ=Asia/Taipei
python -m scraper.main
# 若要自動推到 GitHub（讓 Pages 更新），取消下面註解
# git add web/data archive; git diff --cached --quiet || (git commit -m "data: $(date +%F)" && git pull --rebase && git push)
