#!/usr/bin/env bash
# Cases for guard-bash.sh: `bash .claude/hooks/guard-bash.test.sh` prints FAIL lines and exits 1 on any.
cd "$(dirname "$0")" || exit 2
fails=0
check() {
  local want=$1 c=$2 rc
  printf '%s' "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":$(jq -Rn --arg c "$c" '$c')}}" | ./guard-bash.sh >/dev/null 2>&1
  rc=$?
  if [ "$rc" != "$want" ]; then fails=$((fails+1)); echo "FAIL want $want got $rc :: $(printf '%s' "$c" | tr '\n' ' ' | head -c 90)"; fi
}

# blocked: the real claude CLI, run by hand or by a test
check 2 'claude'
check 2 'claude -p "hello"'
check 2 'cd app && claude --print hi'
check 2 'echo hi | claude -p'
check 2 'npx claude -p hi'
check 2 'npx @anthropic-ai/claude-code -p hi'
check 2 'claude auth status'
check 2 'PINO_AGENT_CMD=claude pnpm test:e2e'
check 2 'export PINO_AGENT_CMD=/usr/local/bin/claude'

# blocked: broad kills (the person's pino, torno, Electron, node and python run on this desktop)
check 2 'killall electron'
check 2 'killall -9 node'
check 2 'pkill electron'
check 2 'pkill -f electron'
check 2 'pkill -9 -f "python"'
check 2 "pkill -f 'torno'"
check 2 'git status && pkill node'
check 2 'pkill pino'
check 2 'pkill torno'
check 2 'pkill -f pino-app'
check 2 'pkill -u "$USER"'
check 2 'kill -9 -1'
check 2 'sudo pkill claude'

# allowed
check 0 'echo "never run killall node here"'
check 0 'git commit -m "Say why claude -p is refused" -- CLAUDE.md'
check 0 $'cat > notes.md <<EOF\nclaude -p hi\npkill electron\nkillall node\nEOF'
check 0 $'cat > a.md <<\'X\'\n- `claude -p` spends the subscription\nX\ngit status'
check 0 'grep -rn "claude" app/src'
# a | inside a quoted pattern is data, not a pipe into claude
check 0 "grep -niE 'someone|/srv/|/tmp/claude|mail' diff.txt"
check 0 'grep -E "a|claude|b" notes.md'
check 0 "rg -n 'x; claude -p' docs"
check 0 'ls /tmp/claude-1000/scratchpad'
check 2 'out="$(claude -p hi)"'
check 2 "echo 'a|b' | claude -p"
check 0 'git log --oneline | grep claude'
check 0 'claude --version'
check 0 'ls ~/.claude && cat CLAUDE.md'
check 0 'gh pr create --title "Rules" --body "no claude -p, no killall"'
check 0 'PINO_AGENT_CMD="node app/test/fake-agent.mjs" pnpm test:e2e'
check 0 'pnpm -C app exec vitest run src/manifest.test.ts'
check 0 'pnpm test && pnpm test:e2e'
check 0 'pkill -f "node app/test/fake-agent.mjs"'
check 0 'pkill -P 12345'
check 0 'kill 12345'
check 0 'pkill -f "scripts/pino --print-command"'
check 0 'pgrep -af electron'
check 0 'bash .claude/hooks/guard-bash.test.sh'

if [ "$fails" = 0 ]; then echo "guard-bash: all cases pass"; exit 0; fi
exit 1
