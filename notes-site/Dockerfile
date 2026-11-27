FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DJANGO_DEBUG=0 DJANGO_BEHIND_HTTPS_PROXY=1 \
    DJANGO_MEDIA_ROOT=/var/lib/sapgu/media \
    LOCAL_OCR_MODEL_DIR=/var/lib/sapgu/ocr-models

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-web.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
        torch==2.13.0 torchvision==0.28.0 \
    && pip install --no-cache-dir -r requirements.txt

COPY . .
RUN DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" \
        python manage.py collectstatic --noinput \
    && useradd --system --uid 10001 --no-create-home sapgu \
    && mkdir -p "$DJANGO_MEDIA_ROOT" "$LOCAL_OCR_MODEL_DIR" \
    && chown -R sapgu:sapgu /var/lib/sapgu

USER sapgu
EXPOSE 8000
CMD ["sh", "./start.sh"]
