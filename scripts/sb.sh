#!/usr/bin/env bash
# Supabase CLI scoped to FindMed.
#
# Loads SUPABASE_ACCESS_TOKEN (FindMed account) and SUPABASE_PROJECT_REF from
# the gitignored .env.local, so the global `supabase login` (used by other
# projects on this machine) is never touched. Always targets the FindMed
# project. Destructive commands are refused here on purpose; run those by hand.
#
# Usage: bash scripts/sb.sh functions deploy reserve-slots --use-api
#        bash scripts/sb.sh db query "select 1"
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ! -f .env.local ]]; then
  echo "sb.sh: falta .env.local" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env.local
set +a

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "sb.sh: SUPABASE_ACCESS_TOKEN vacío en .env.local (token personal de la cuenta FindMed)" >&2
  exit 1
fi
REF="${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF vacío en .env.local}"

case "${1:-} ${2:-}" in
  "db reset" | "projects delete" | "functions delete" | "branches delete" | "secrets unset" | "storage rm" | "link "* | "login "* | "logout "*)
    echo "sb.sh: '$1 $2' está bloqueado en este envoltorio; ejecútalo a mano si de verdad hace falta." >&2
    exit 2
    ;;
esac

# Commands that accept --project-ref get it injected; `db query` also needs --linked.
case "${1:-} ${2:-}" in
  "db query" | "db push" | "migration list" | "migration repair")
    exec npx -y supabase "$@" --linked --project-ref "$REF"
    ;;
  "functions "* | "secrets "*)
    exec npx -y supabase "$@" --project-ref "$REF"
    ;;
  *)
    exec npx -y supabase "$@"
    ;;
esac
