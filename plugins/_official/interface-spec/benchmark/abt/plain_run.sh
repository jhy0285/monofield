#!/bin/bash
# usage: plain_run.sh <run-id> <phase 1|2> <model> [prompt-suffix]
set -u
RUN=$1; PHASE=$2; MODEL=${3:-sonnet}; VAR=${4:-}
HERE=$(cd "$(dirname "$0")" && pwd)
D=$HERE/plain/run${VAR}$RUN
BASE=$(python3 -c "import json;print(json.load(open('$HERE/work/truth/stats.json'))['base'])")
HEAD=$(python3 -c "import json;print(json.load(open('$HERE/work/truth/stats.json'))['head'])")
mkdir -p $D
if [ "$PHASE" = "1" ]; then
  rm -rf $D/abt-platform $D/spec_v1.json
  git clone -q $HERE/work/abt-platform $D/abt-platform
  git -C $D/abt-platform checkout -q $BASE
  PROMPT=$HERE/prompts/p1${VAR}.txt
else
  git -C $D/abt-platform checkout -q $HEAD
  PROMPT=$HERE/prompts/p2${VAR}.txt
fi
cd $D
START=$(date +%s)
claude -p --model $MODEL --output-format json --permission-mode acceptEdits \
  --allowedTools "Read" "Glob" "Grep" "Write" "Edit" "Bash" "Task" \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --no-session-persistence \
  --max-budget-usd 25 < $PROMPT > $D/p$PHASE.result.json 2> $D/p$PHASE.err
echo "exit=$? seconds=$(( $(date +%s) - START ))" > $D/p$PHASE.done
