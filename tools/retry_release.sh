#!/bin/bash
# 网络对 GitHub 间歇性阻断时，反复尝试补传 Release 附件，直到三个都到位。
TOKEN="$1"
[ -z "$TOKEN" ] && { echo "用法: retry_release.sh <token>"; exit 1; }
cd "$(dirname "$0")/.." || exit 1

for i in $(seq 1 20); do
  echo "===== 第 $i 次尝试 $(date '+%H:%M:%S') ====="
  out=$(GITHUB_TOKEN="$TOKEN" python tools/gh_release.py 2>&1)
  echo "$out"

  if echo "$out" | grep -q "附件 3 个"; then
    echo "ALL_UPLOADED"
    exit 0
  fi

  # 只差最后一个小文件时多试几次，别因为一次抖动放弃
  sleep 45
done

echo "GAVE_UP"
exit 2
