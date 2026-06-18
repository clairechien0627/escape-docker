#!/bin/sh
# Falco entrypoint：讀取 /etc/falco/tier（由 lab-api 寫入）決定規則 tier。
# basic → 使用 falco-basic.yaml（含 lab_rules_basic_override.yaml 停用 tier_full_only）
# full  → 使用 falco.yaml（全部規則）
TIER=$(cat /etc/falco/tier 2>/dev/null | tr -d '[:space:]')
if [ "$TIER" = "basic" ]; then
  exec /usr/bin/falco -c /etc/falco/falco-basic.yaml
else
  exec /usr/bin/falco -c /etc/falco/falco.yaml
fi
