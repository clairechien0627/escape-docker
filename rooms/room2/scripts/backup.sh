#!/bin/bash
# Backup script - DO NOT MODIFY
# Usage: backup.sh <source_file>
#
# WARNING: This script is intentionally vulnerable for educational purposes.
# In production, NEVER write scripts that pass unsanitized input to system commands.

cp $1 /tmp/out 2>/dev/null
echo "Backup complete. Output saved to /tmp/out"
