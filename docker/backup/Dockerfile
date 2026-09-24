# Sicherung: täglicher Datenbank-Dump + optional verschlüsselte Kopie außer Haus (restic)
FROM postgres:16-alpine
RUN apk add --no-cache restic curl tzdata
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
