#!/usr/bin/env bash
# PreToolUse guard for Bash: refuses the commands the CLAUDE.md files forbid in prose.
# Reads the tool call as JSON on stdin; prints a deny decision and exits 2 to block, exits 0 to allow.
# Every rule matches a command in COMMAND POSITION (start of line, or after ; & | ( $( ), so a heredoc,
# an echo or a commit message that merely mentions `killall` passes. `guard-bash.test.sh` holds the cases.
set -u
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$cmd" ] && exit 0

# Drop heredoc bodies (`<<EOF` ... `EOF`): they are data, not commands.
cmd=$(printf '%s\n' "$cmd" | awk '
  t != "" { if ($0 == t || $0 ~ ("^[ \t]*" t "$")) t = ""; next }
  {
    if (match($0, /<<-?[ \t]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?/)) {
      s = substr($0, RSTART, RLENGTH); sub(/<<-?[ \t]*["'"'"']?/, "", s); sub(/["'"'"']$/, "", s); t = s
    }
    print
  }')

# The decision goes to stdout as JSON and the reason to stderr too, which is what Claude Code reads on exit 2.
deny() {
  printf '%s\n' "$1" >&2
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 2
}
# Command position, then what may stand before the command itself: keywords, sudo, env and assignments,
# and the runners that run another command (npx, npm exec, pnpm dlx/exec, exec, command, nohup, time, timeout).
P='(^|[;&|(]|\$\()\s*((then|do|else|!)\s+)*(sudo\s+)?(env\s+)?(\w+=("[^"]*"|'"'"'[^'"'"']*'"'"'|\S*)\s+)*(sudo\s+)?((npx|bunx)\s+(-y\s+)?|npm\s+exec\s+|pnpm\s+(dlx|exec)\s+|exec\s+|command\s+|nohup\s+|time\s+|timeout\s+\S+\s+)*'
E='(?=[\s;&|)]|$)'
has() { printf '%s\n' "$cmd" | grep -Pq "$1"; }
line() { printf '%s\n' "$cmd" | grep -P "$1"; }
# The command with what is inside quotes blanked (a double-quoted string that runs $( ) is kept): a | or ; in a
# grep pattern or a message is data, not a pipe or a new command. Used where a word is common in data (claude).
bare=$(printf '%s\n' "$cmd" | perl -pe "s/'[^']*'/''/g; s/\"((?:[^\"\\\\]|\\\\.)*)\"/index(\$1, '\$(') >= 0 ? \"\\\"\$1\\\"\" : '\"\"'/ge")
bareline() { printf '%s\n' "$bare" | grep -P "$1"; }

# 1. The real claude CLI. No test runs it, and no agent runs it for a test or a check: it spends the person's
#    subscription and depends on their login and settings. `claude --version` alone is harmless.
if bareline "${P}(\S*/)?claude(-code)?${E}" | grep -Pvq "claude\s+(--version|-v)\s*($|[;&|)])"; then
  deny "Never run the real claude CLI from here: tests and checks use the stand-in, PINO_AGENT_CMD=\"node app/test/fake-agent.mjs\" (root CLAUDE.md, Never run a real agent CLI from tests). A check against the real CLI is done by hand by the person."
fi
if has "\bPINO_AGENT_CMD=[\"']?(\S*/)?claude\b"; then
  deny "PINO_AGENT_CMD never names the real claude: use the stand-in, \"node app/test/fake-agent.mjs\"."
fi

# 2. Broad kills. The person's own pino, torno, Electron, node, python and Claude Code run on this desktop.
KILL="Never kill by a broad name or for a whole user: the person's pino, torno, Electron, node, python and Claude Code run on this desktop. Kill the process you started, by its pid (kill <pid>, pkill -P <pid>) or by its full command line."
if has "${P}killall${E}"; then deny "$KILL"; fi
if has "${P}kill\s+(-\S+\s+)*-1\s*($|[;&|)])"; then deny "$KILL"; fi
while IFS= read -r seg; do
  [ -z "$seg" ] && continue
  if printf '%s\n' "$seg" | grep -Pq '\s-[uUG]\b|--(e?uid|group)\b'; then deny "$KILL"; fi
  pat=$(printf '%s\n' "$seg" | sed -E 's/^pkill//; s/[[:space:]]+-[A-Za-z0-9-]+//g; s/["'"'"']//g; s/^[[:space:]]+//; s/[[:space:]]+$//')
  if [ -z "$pat" ] || printf '%s\n' "$pat" | grep -Piq '^(electron|node|python3?|uv|claude|pino(-app)?|torno(-app)?|vitest|playwright|chrome|chromium|xvfb-run|xvfb|pnpm|npm|bash|sh|zsh|code)$'; then
    deny "$KILL"
  fi
done < <(printf '%s\n' "$cmd" | grep -oP "${P}\Kpkill\b[^;&|\n)]*")

exit 0
