#!/bin/sh
# Tägliche Sicherung der Kassenbelege.
#
#   1. Datenbank-Dump nach /backups (lokal, KEEP_LOCAL_DAYS Tage)
#   2. Wenn RESTIC_REPOSITORY gesetzt ist: verschlüsselte Sicherung von Dump + Originalbelegen
#      außer Haus (NAS, USB-Platte, S3, Backblaze B2 …) mit Aufbewahrung 7 Tage / 8 Wochen / 24 Monate
#   3. Status nach /backups/status.json (wird in der Web-App angezeigt), bei Fehler Telegram-Nachricht
#
# Aufruf:  backup.sh        → läuft dauerhaft, sichert täglich ab BACKUP_HOUR Uhr
#          backup.sh now    → sofort einmal sichern (z. B. docker compose run --rm backup now)
set -u

BACKUP_HOUR="${BACKUP_HOUR:-3}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-14}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
FILES_DIR="${FILES_DIR:-/data/files}"
STATUS="$BACKUP_DIR/status.json"
DB_HOST="${DB_HOST:-db}"

log() { echo "$(date '+%F %T') $*"; }

notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || return 0
  for id in $(echo "${TELEGRAM_ALLOWED_USER_IDS:-}" | tr ',;' '  '); do
    curl -fsS -m 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=$id" --data-urlencode "text=$1" >/dev/null \
      || log "Telegram-Nachricht an $id fehlgeschlagen"
  done
}

# status.json: {"status":"ok|error","date":"JJJJ-MM-TT","time":"…","offsite":true|false,"message":"…","last_success":"…"}
write_status() {
  last_success="$(sed -n 's/.*"last_success":"\([^"]*\)".*/\1/p' "$STATUS" 2>/dev/null)"
  [ "$1" = "ok" ] && last_success="$(date -Iseconds)"
  # Nur druckbare Zeichen – Tabulatoren/Zeilenumbrüche aus Fehlermeldungen würden das JSON ungültig machen
  msg="$(printf '%s' "$3" | tr '\n\r\t' '   ' | tr -d '\000-\037' | tr '"\\' "'/" | cut -c1-500)"
  printf '{"status":"%s","date":"%s","time":"%s","offsite":%s,"message":"%s","last_success":"%s"}\n' \
    "$1" "$(date +%F)" "$(date -Iseconds)" "$2" "$msg" "$last_success" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

fail() {
  log "FEHLER: $1"
  write_status error "$2" "$1"
  notify "⚠️ Kassenbelege: Sicherung fehlgeschlagen – $1"
  return 1
}

run_backup() {
  offsite=false
  [ -n "${RESTIC_REPOSITORY:-}" ] && offsite=true
  mkdir -p "$BACKUP_DIR"
  dump="$BACKUP_DIR/kassenbeleg-$(date +%F).sql.gz"

  log "Datenbank-Dump …"
  if ! pg_dump -h "$DB_HOST" -U kassenbeleg kassenbeleg > /tmp/dump.sql 2>/tmp/dump.err; then
    fail "Datenbank-Dump: $(tail -c 300 /tmp/dump.err)" "$offsite"; return 1
  fi
  gzip -c /tmp/dump.sql > "$dump.tmp" && mv "$dump.tmp" "$dump"
  rm -f /tmp/dump.sql
  find "$BACKUP_DIR" -name 'kassenbeleg-*.sql.gz' -mtime +"$KEEP_LOCAL_DAYS" -delete
  log "Dump gespeichert: $dump ($(du -h "$dump" | cut -f1))"

  if [ "$offsite" = true ]; then
    [ -n "${RESTIC_PASSWORD:-}" ] || { fail "RESTIC_PASSWORD ist nicht gesetzt" true; return 1; }
    if ! restic cat config > /tmp/restic.log 2>&1; then
      if grep -qi "wrong password\|no key found" /tmp/restic.log; then
        fail "Falsches RESTIC_PASSWORD für das Sicherungsziel $RESTIC_REPOSITORY" true; return 1
      elif grep -qi "does not exist\|is there a repository\|no such file" /tmp/restic.log; then
        log "Neues Sicherungsziel wird eingerichtet: $RESTIC_REPOSITORY"
        restic init > /tmp/restic.log 2>&1 || { fail "Sicherungsziel einrichten: $(tail -c 300 /tmp/restic.log)" true; return 1; }
      else
        fail "Sicherungsziel nicht erreichbar: $(tail -c 300 /tmp/restic.log)" true; return 1
      fi
    fi
    log "Sicherung außer Haus …"
    restic backup --host kassenbeleg --tag kassenbeleg "$BACKUP_DIR" "$FILES_DIR" --exclude "$STATUS" > /tmp/restic.log 2>&1 \
      || { fail "restic backup: $(tail -c 300 /tmp/restic.log)" true; return 1; }
    tail -n 3 /tmp/restic.log
    restic forget --host kassenbeleg --keep-daily 7 --keep-weekly 8 --keep-monthly 24 --prune > /tmp/restic.log 2>&1 \
      || { fail "restic forget: $(tail -c 300 /tmp/restic.log)" true; return 1; }
    # Sonntags die Integrität prüfen (liest 5 % der Daten)
    if [ "$(date +%u)" = "7" ]; then
      restic check --read-data-subset=5% > /tmp/restic.log 2>&1 \
        || { fail "restic check: $(tail -c 300 /tmp/restic.log)" true; return 1; }
    fi
  fi

  write_status ok "$offsite" "$([ "$offsite" = true ] && echo "lokal + außer Haus" || echo "nur lokal")"
  log "Sicherung erfolgreich."
}

if [ "${1:-}" = "now" ]; then
  run_backup
  exit $?
fi

log "Sicherungsdienst gestartet – täglich ab ${BACKUP_HOUR} Uhr$([ -n "${RESTIC_REPOSITORY:-}" ] && echo ", außer Haus: $RESTIC_REPOSITORY" || echo ", nur lokal")"
last_attempt=0
while true; do
  today="$(date +%F)"
  done_today="$(sed -n 's/.*"status":"ok","date":"\([^"]*\)".*/\1/p' "$STATUS" 2>/dev/null)"
  now="$(date +%s)"
  # ab BACKUP_HOUR, einmal täglich; nach einem Fehler frühestens eine Stunde später erneut
  if [ "$(date +%H | sed 's/^0//')" -ge "$BACKUP_HOUR" ] && [ "$done_today" != "$today" ] && [ $((now - last_attempt)) -ge 3600 ]; then
    last_attempt="$now"
    run_backup || true
  fi
  sleep 300
done
