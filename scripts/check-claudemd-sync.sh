#!/usr/bin/env bash
# CLAUDE.md 与代码同步校验脚本
# 从代码自动提取真相（schema 版本 / MCP 工具数 / IM 渠道 / DB 表数等）→ 对比 CLAUDE.md 文本 → 不一致就 exit 1
#
# 用法：bash scripts/check-claudemd-sync.sh
# 接入：make typecheck（强校验）或 make docs（参考刷新）
#
# 第一版宽松：unknown 项目 warn 不 fail；明确不一致项 fail。
# 可通过 CLAUDE_MD_SYNC_STRICT=1 强制 fail-all。

set -o pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDEMD="$ROOT/CLAUDE.md"

if [ ! -f "$CLAUDEMD" ]; then
  echo "ERROR: $CLAUDEMD 不存在" >&2
  exit 2
fi

STRICT="${CLAUDE_MD_SYNC_STRICT:-0}"
FAIL=0
WARN=0

ok()    { printf "  \033[32m✓\033[0m %s\n" "$*"; }
fail()  { printf "  \033[31m✗\033[0m %s\n" "$*"; FAIL=$((FAIL+1)); }
warn()  { printf "  \033[33m⚠\033[0m %s\n" "$*"; WARN=$((WARN+1)); }

echo "═══ CLAUDE.md 同步校验 ═══"
echo

# ── 1. Schema 版本 ──
echo "[1/8] Schema 版本"
SCHEMA_VERSION=$(grep -oE "SCHEMA_VERSION = '[0-9]+'" "$ROOT/src/db.ts" | grep -oE "[0-9]+" | head -1)
if [ -z "$SCHEMA_VERSION" ]; then
  warn "无法从 src/db.ts 提取 SCHEMA_VERSION"
else
  if grep -qE "v1→v${SCHEMA_VERSION}|SCHEMA_VERSION.*v${SCHEMA_VERSION}|演进 v1→v${SCHEMA_VERSION}|至 v${SCHEMA_VERSION}|到 v${SCHEMA_VERSION}|演进到 v${SCHEMA_VERSION}" "$CLAUDEMD"; then
    ok "Schema v${SCHEMA_VERSION} 已记录"
  else
    fail "Schema 当前 v${SCHEMA_VERSION}，但 CLAUDE.md 未提及。建议搜 '演进 v1→' 段更新"
  fi
fi

# ── 2. MCP 工具数 ──
echo "[2/8] MCP 工具数"
MCP_COUNT=$(grep -cE "^[[:space:]]+tool\([[:space:]]*$" "$ROOT/container/agent-runner/src/mcp-tools.ts" 2>/dev/null || echo 0)
if [ "$MCP_COUNT" -gt 0 ]; then
  if grep -qE "${MCP_COUNT}[[:space:]]*(个)?[[:space:]]*MCP[[:space:]]*(工具|tool)|MCP[[:space:]]*(工具|tool)[^数]*${MCP_COUNT}[[:space:]]*个" "$CLAUDEMD"; then
    ok "MCP 工具 ${MCP_COUNT} 个 已记录"
  else
    fail "MCP 工具实际 ${MCP_COUNT} 个，CLAUDE.md 未对齐。建议搜 'MCP 工具' / 'MCP Server' 段更新"
  fi
fi

# ── 3. IM 渠道清单 ──
echo "[3/8] IM 渠道清单"
CHANNELS=$(grep -oE "^[[:space:]]*[a-z]+:[[:space:]]*['\"][a-z]+:['\"]" "$ROOT/src/channel-prefixes.ts" | grep -oE "^[[:space:]]*[a-z]+" | tr -d ' ' | sort -u)
CHANNEL_COUNT=$(echo "$CHANNELS" | wc -l | tr -d ' ')
MISSING_CHANNELS=""
for ch in $CHANNELS; do
  if ! grep -qiE "\\b${ch}\\b" "$CLAUDEMD"; then
    MISSING_CHANNELS="$MISSING_CHANNELS $ch"
  fi
done
if [ -z "$MISSING_CHANNELS" ]; then
  ok "$CHANNEL_COUNT 个 IM 渠道全部在 CLAUDE.md 中提及（$(echo $CHANNELS | tr '\n' ' '))"
else
  fail "CLAUDE.md 漏列 IM 渠道:$MISSING_CHANNELS（实际共 $CHANNEL_COUNT 个）"
fi

# ── 4. 数据库表数 ──
echo "[4/8] 数据库表数"
TABLES=$(grep -oE "CREATE TABLE (IF NOT EXISTS )?\"?[a-z_]+\"?" "$ROOT/src/db.ts" | grep -oE "[a-z_]+$" | grep -vE "_new$" | sort -u)
TABLE_COUNT=$(echo "$TABLES" | wc -l | tr -d ' ')
if grep -qE "${TABLE_COUNT}[[:space:]]*(张|个)?[[:space:]]*表|${TABLE_COUNT}[[:space:]]*tables?|数据库表[^数]*${TABLE_COUNT}" "$CLAUDEMD"; then
  ok "数据库 $TABLE_COUNT 张表 已记录"
else
  fail "数据库实际 $TABLE_COUNT 张表，CLAUDE.md 未对齐"
fi

# ── 5. StreamEvent 类型数 ──
echo "[5/8] StreamEvent 类型数"
STREAM_COUNT=$(grep -oE "['\"]([a-z_]+_(delta|start|end|progress|started|response|update|notification))['\"]" "$ROOT/shared/stream-event.ts" | sort -u | wc -l | tr -d ' ')
# 也加上 status / init / usage 等单独词
STREAM_COUNT_FULL=$(awk '/StreamEventType =/,/;/' "$ROOT/shared/stream-event.ts" | grep -oE "'[a-z_]+'" | sort -u | wc -l | tr -d ' ')
if [ "$STREAM_COUNT_FULL" -gt 0 ]; then
  if grep -qE "${STREAM_COUNT_FULL}[[:space:]]*(种|类|个)?[[:space:]]*(StreamEvent|流式事件)" "$CLAUDEMD"; then
    ok "StreamEvent $STREAM_COUNT_FULL 类 已记录"
  else
    warn "StreamEvent 实际 $STREAM_COUNT_FULL 类，CLAUDE.md 数字不对齐"
  fi
fi

# ── 6. WsMessageOut 类型数 ──
echo "[6/8] WsMessageOut 类型数"
WS_COUNT=$(awk '/type WsMessageOut =/,/^[a-z]/' "$ROOT/src/types.ts" | grep -oE "type:[[:space:]]*'[a-z_]+'" | sort -u | wc -l | tr -d ' ')
if [ "$WS_COUNT" -gt 0 ]; then
  if grep -qE "${WS_COUNT}[[:space:]]*(种|类|个)?[[:space:]]*WS|${WS_COUNT}[[:space:]]*类型[[:space:]]*[（(].*Ws" "$CLAUDEMD"; then
    ok "WS 出向 $WS_COUNT 种 已记录"
  else
    warn "WsMessageOut 实际 $WS_COUNT 种，CLAUDE.md 数字不对齐"
  fi
fi

# ── 7. src/ TypeScript 文件数 ──
echo "[7/8] src/ TS 文件数"
SRC_COUNT=$(find "$ROOT/src" -maxdepth 1 -name "*.ts" -not -name "*.test.ts" | wc -l | tr -d ' ')
ROUTES_COUNT=$(find "$ROOT/src/routes" -maxdepth 1 -name "*.ts" -not -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')
RUNNER_COUNT=$(find "$ROOT/container/agent-runner/src" -maxdepth 1 -name "*.ts" -not -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')
if grep -qE "${SRC_COUNT}[[:space:]]*个|${SRC_COUNT}[[:space:]]*ts|src/[^/]*${SRC_COUNT}|${SRC_COUNT}[[:space:]]*文件" "$CLAUDEMD"; then
  ok "src/ $SRC_COUNT 个 .ts 已记录"
else
  warn "src/ 实际 $SRC_COUNT 个 .ts，CLAUDE.md 数字不对齐"
fi
if grep -qE "${ROUTES_COUNT}[[:space:]]*(个)?[[:space:]]*路由|routes/[^/]*${ROUTES_COUNT}" "$CLAUDEMD"; then
  ok "routes/ $ROUTES_COUNT 个 已记录"
else
  warn "routes/ 实际 $ROUTES_COUNT 个，CLAUDE.md 数字不对齐"
fi
if grep -qE "agent-runner[^.]*${RUNNER_COUNT}[[:space:]]*(个)?" "$CLAUDEMD"; then
  ok "agent-runner/src/ $RUNNER_COUNT 个 已记录"
else
  warn "agent-runner/src/ 实际 $RUNNER_COUNT 个，CLAUDE.md 数字不对齐"
fi

# ── 8. 关键模块存在性（CLAUDE.md 必须提及）──
echo "[8/8] 关键模块提及检查"
KEY_MODULES=(
  "billing.ts" "wechat.ts" "discord.ts" "feishu-mention-gate.ts"
  "im-context-isolation.ts" "agent-capabilities.ts" "plugin-catalog.ts"
  "plugin-materializer.ts" "provider-pool.ts" "feishu-streaming-card.ts"
  "dingtalk-streaming-card.ts" "qq-streaming-card.ts" "discord-streaming-edit.ts"
)
MISSING_MODULES=""
for mod in "${KEY_MODULES[@]}"; do
  if [ -f "$ROOT/src/$mod" ] && ! grep -qF "$mod" "$CLAUDEMD"; then
    MISSING_MODULES="$MISSING_MODULES $mod"
  fi
done
if [ -z "$MISSING_MODULES" ]; then
  ok "所有关键模块均在 CLAUDE.md 中提及"
else
  warn "CLAUDE.md 漏列关键模块:$MISSING_MODULES"
fi

# ── 总结 ──
echo
echo "═══ 总结 ═══"
echo "  FAIL: $FAIL    WARN: $WARN"
if [ "$STRICT" = "1" ] && [ $((FAIL+WARN)) -gt 0 ]; then
  echo "STRICT 模式：FAIL + WARN > 0，退出 1"
  exit 1
fi
if [ "$FAIL" -gt 0 ]; then
  echo "存在 $FAIL 项必须修复的不一致。请更新 CLAUDE.md 或代码后重跑。"
  exit 1
fi
echo "通过（${WARN} 项警告可忽略）"
exit 0
