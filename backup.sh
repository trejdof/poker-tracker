#!/bin/bash

BACKUP_DIR="/home/dietpi/poker-tracker/backups"
DB_PATH="/home/dietpi/poker-tracker/instance/poker.db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_DIR/poker-backup-$TIMESTAMP.db"

# Keep only the last 15 backups
ls -t "$BACKUP_DIR"/poker-backup-*.db | tail -n +16 | xargs -r rm --

echo "Backup saved: poker-backup-$TIMESTAMP.db"
