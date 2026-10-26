#!/usr/bin/env bash
# Manual backup of the production database (Supabase Free has no automatic backups).
# Run before every prod migration and once a week: ./scripts/backup-prod.sh
#
# - Asks for the prod "Session pooler" connection string (Supabase dashboard → Connect).
#   It is read silently, never echoed, never written to disk or shell history, and is not
#   put on any command line (other processes could see it there): the parts are handed to
#   pg_dump through libpq environment variables for that one command only.
# - Writes ~/FinCreador-backups/prod-YYYYMMDD-HHMM.dump (custom format), readable only by
#   you. Keep backups outside the repository: they contain personal financial data.
set -euo pipefail

BACKUP_DIR="$HOME/FinCreador-backups"

fail() {
  echo "Backup failed: $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------- 1. pg_dump
PG_DUMP="$(command -v pg_dump || true)"
PG_RESTORE="$(command -v pg_restore || true)"
if [[ -z "$PG_DUMP" && -x /opt/homebrew/opt/libpq/bin/pg_dump ]]; then
  PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
  PG_RESTORE=/opt/homebrew/opt/libpq/bin/pg_restore
fi
if [[ -z "$PG_DUMP" ]]; then
  echo "pg_dump was not found."
  echo "Run: brew install libpq"
  exit 1
fi
[[ -n "$PG_RESTORE" ]] || PG_RESTORE="$(dirname "$PG_DUMP")/pg_restore"
[[ -x "$PG_RESTORE" ]] || fail "pg_restore was not found next to $PG_DUMP. Run: brew install libpq"

# ---------------------------------------------------------------------------- 2. folder
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# ---------------------------------------------------------------------------- 3. connection string
CONN=""
PGPASSWORD=""
cleanup() {
  CONN=""
  PGPASSWORD=""
  unset CONN PGPASSWORD
}
trap cleanup EXIT INT TERM

echo "Paste the PRODUCTION Session pooler connection string (input is hidden), then press Enter."
echo "It starts with postgresql://  (Supabase dashboard → Connect → Session pooler)."
IFS= read -r -s CONN || true
echo
[[ -n "$CONN" ]] || fail "no connection string was entered."
if [[ "$CONN" == *"[YOUR-PASSWORD]"* ]]; then
  fail "the string still contains [YOUR-PASSWORD]. Replace it with the database password."
fi

# postgresql://user:password@host:port/dbname?params
re='^postgres(ql)?://([^:@/]+):([^@]*)@([^:/?]+):?([0-9]*)/?([^?]*)'
[[ "$CONN" =~ $re ]] || fail "that doesn't look like a connection string (postgresql://user:password@host:port/postgres)."
DB_USER="${BASH_REMATCH[2]}"
DB_HOST="${BASH_REMATCH[4]}"
DB_PORT="${BASH_REMATCH[5]:-5432}"
DB_NAME="${BASH_REMATCH[6]:-postgres}"
# The password may be percent-encoded (%40 for @ and so on); "+" stays a plus.
encoded="${BASH_REMATCH[3]}"
PGPASSWORD="$(printf '%b' "${encoded//%/\\x}")"
encoded=""
CONN=""

# ---------------------------------------------------------------------------- 4. pg_dump
FILE="$BACKUP_DIR/prod-$(date +%Y%m%d-%H%M).dump"
echo "Backing up $DB_HOST ($DB_NAME) to $FILE …"

set +e
ERR="$(
  PGPASSWORD="$PGPASSWORD" PGSSLMODE=require PGCONNECT_TIMEOUT=15 \
    "$PG_DUMP" --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" \
    --no-password --format=custom --no-owner --no-privileges \
    --schema=public --schema=auth --schema=supabase_migrations \
    --file="$FILE" 2>&1
)"
STATUS=$?
set -e
PGPASSWORD=""

if [[ $STATUS -ne 0 ]]; then
  rm -f "$FILE"
  if [[ "$ERR" == *"password authentication failed"* || "$ERR" == *"no password supplied"* ]]; then
    fail "wrong password (or user). Copy the Session pooler string again and check the database password."
  elif [[ "$ERR" == *"server version mismatch"* ]]; then
    fail "your pg_dump is older than the database server. Run: brew upgrade libpq"
  elif [[ "$ERR" == *"could not translate host name"* || "$ERR" == *"Connection refused"* || "$ERR" == *"timeout"* || "$ERR" == *"could not connect"* || "$ERR" == *"connection to server"* ]]; then
    fail "could not connect to the database. Check your internet connection, that you copied the Session pooler string, and that the project isn't paused."
  else
    echo "$ERR" >&2
    fail "pg_dump stopped with the error above."
  fi
fi

# ---------------------------------------------------------------------------- 5. verify
LIST="$("$PG_RESTORE" --list "$FILE" 2>/dev/null)" || fail "the file $FILE can't be read back by pg_restore."
TABLES="$(grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE ' <<<"$LIST" || true)"
if [[ "${TABLES:-0}" -eq 0 ]]; then
  fail "the backup $FILE contains no tables. Don't run the migration; check the connection string."
fi
SIZE="$(du -h "$FILE" | cut -f1)"

echo "Backup done."
echo "  File:   $FILE"
echo "  Size:   $SIZE"
echo "  Tables: $TABLES"
echo "Keep it outside the repository; copy it somewhere encrypted. Keep at least the last four."
