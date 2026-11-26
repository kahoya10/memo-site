import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent
env_file = BASE_DIR / ".env"
database_password = os.environ.get("DJANGO_DATABASE_PASSWORD")
if database_password is None:
    database_password = dotenv_values(env_file, interpolate=False).get("DJANGO_DATABASE_PASSWORD")
load_dotenv(env_file)

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
LOCAL_SECRET_KEY = "django-insecure-sapgu-local-development-key-change-before-deploy"
SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    LOCAL_SECRET_KEY if DEBUG else "",
)
if not DEBUG and (not SECRET_KEY or SECRET_KEY == LOCAL_SECRET_KEY):
    raise ImproperlyConfigured("DJANGO_SECRET_KEY is required when DJANGO_DEBUG=0.")

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
    if host.strip()
]
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_REDIRECT_EXEMPT = [r"^healthz/$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    if os.environ.get("DJANGO_BEHIND_HTTPS_PROXY", "0") == "1":
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "notes.apps.NotesConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if not DEBUG:
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

database_url = os.environ.get("DJANGO_DATABASE_URL", "").strip()
if database_url and database_password != "":
    from psycopg import ProgrammingError
    from psycopg.conninfo import conninfo_to_dict

    try:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError
        database = conninfo_to_dict(database_url)
        if not all(database.get(key) for key in ("dbname", "user", "host")) or not (database_password or database.get("password")):
            raise ValueError
        if database.get("port") == "6543":
            raise ValueError
    except (ProgrammingError, ValueError):
        raise ImproperlyConfigured(
            "DJANGO_DATABASE_URL must contain a PostgreSQL Direct or Session pooler connection URL."
        ) from None

    sslmode = database.get("sslmode", "require")
    if sslmode not in {"require", "verify-ca", "verify-full"}:
        raise ImproperlyConfigured("DJANGO_DATABASE_URL requires sslmode=require, verify-ca or verify-full.")

    DATABASES["local_sqlite"] = DATABASES["default"]
    DATABASES["default"] = {
        "ENGINE": "config.postgres",
        "NAME": database["dbname"],
        "USER": database["user"],
        "PASSWORD": database_password or database["password"],
        "HOST": database["host"],
        "PORT": database.get("port", "5432"),
        "OPTIONS": {
            "sslmode": sslmode,
            "connect_timeout": 10,
        },
    }
    if "sslrootcert" in database:
        DATABASES["default"]["OPTIONS"]["sslrootcert"] = database["sslrootcert"]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = Path(os.environ.get("DJANGO_STATIC_ROOT", BASE_DIR / "staticfiles"))
if not DEBUG:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
    }
MEDIA_URL = "media/"
MEDIA_ROOT = Path(os.environ.get("DJANGO_MEDIA_ROOT", BASE_DIR / "media"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LOGIN_REDIRECT_URL = "notes:dashboard"
LOGOUT_REDIRECT_URL = "notes:dashboard"
LOGIN_URL = "notes:dashboard"

FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

LOCAL_OCR_MODEL_DIR = Path(os.environ.get("LOCAL_OCR_MODEL_DIR", BASE_DIR / "ocr-models"))
LOCAL_OCR_DOWNLOAD_ENABLED = os.environ.get("LOCAL_OCR_DOWNLOAD_ENABLED", "1") == "1"
HANDWRITING_IMAGE_MAX_BYTES = 6 * 1024 * 1024
