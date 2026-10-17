#!/bin/sh
# Apply database migrations (idempotent), then start the server.
set -e
node /app/scripts/migrate.mjs
exec "$@"
