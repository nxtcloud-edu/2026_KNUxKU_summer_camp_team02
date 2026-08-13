#!/usr/bin/env bash
# 팀원 환경 세팅 — 클론 후 한 번만 실행하면 됩니다.
#   bash scripts/setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── Node 버전 확인 ──────────────────────────────────────────
say "1) Node 버전 확인"
if ! command -v node >/dev/null 2>&1; then
  echo "   ✗ Node가 없습니다. https://nodejs.org 에서 20 LTS를 설치하세요."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
echo "   node $(node -v)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "   ✗ Node 20 이상이 필요합니다. (nvm 사용 시: nvm use)"
  exit 1
fi

# ── 의존성 ─────────────────────────────────────────────────
say "2) 의존성 설치"
npm --prefix studyroom-prototype ci 2>/dev/null || npm --prefix studyroom-prototype install

# ── 환경 변수 ──────────────────────────────────────────────
say "3) .env 준비"
if [ -f studyroom-prototype/.env ]; then
  echo "   이미 있습니다 — 건너뜁니다."
else
  cp studyroom-prototype/.env.example studyroom-prototype/.env
  echo "   .env.example → .env 복사 완료. 값이 필요해지면 그때 채우세요."
fi

# ── UI/UX 스킬 (선택) ──────────────────────────────────────
say "4) ui-ux-pro-max 스킬 (선택)"
if [ -d .claude/skills/ui-ux-pro-max ]; then
  echo "   이미 있습니다 — 건너뜁니다."
elif command -v git >/dev/null 2>&1; then
  echo "   Claude Code용 UI/UX 스킬을 받습니다. (건너뛰려면 Ctrl+C)"
  TMP="$(mktemp -d)"
  git clone --depth 1 -q https://github.com/nextlevelbuilder/ui-ux-pro-max-skill "$TMP" || {
    echo "   ! 내려받지 못했습니다. 없어도 개발에는 지장 없습니다."; rm -rf "$TMP"; TMP=""; }
  if [ -n "${TMP:-}" ]; then
    mkdir -p .claude/skills
    cp -R "$TMP/.claude/skills/." .claude/skills/
    cp "$TMP/LICENSE" .claude/ui-ux-pro-max-LICENSE
    rm -rf "$TMP"
    echo "   설치 완료 (.claude/skills/ — 커밋되지 않습니다)"
  fi
fi

say "완료"
cat <<'MSG'
  개발 서버 실행:
    cd studyroom-prototype && npm run dev
  브라우저에서 http://127.0.0.1:5180 (Chrome 권장 — 음성 입력이 Chrome 전용입니다)
MSG
