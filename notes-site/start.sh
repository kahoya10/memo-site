#!/bin/sh
set -eu

python manage.py verify_deployment
exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-1}" \
    --threads "${WEB_THREADS:-4}" \
    --timeout "${WEB_TIMEOUT:-180}" \
    --access-logfile -
