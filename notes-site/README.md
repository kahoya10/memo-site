# 삽구의 서당 · 필기 첫 버전

초대받은 사용자가 개인 공책에 손필기하고, 확인한 텍스트와 핵심어로 빈칸 학습을 할 수 있는 Django 프로젝트입니다.

## 실행

이 폴더에는 현재 로컬 실행에 필요한 Django 패키지가 `vendor` 폴더에 준비되어 있습니다.

```powershell
py -3.13 manage.py migrate
py -3.13 manage.py seed_demo
py -3.13 manage.py runserver
```

브라우저에서 `http://127.0.0.1:8000`을 엽니다.

## 공개 배포

`notes-site/Dockerfile`을 사용하는 Docker 웹 서비스로 실행합니다. Django의 로그인과 계정별 데이터는 기존 Supabase PostgreSQL을 사용합니다. 웹 서비스 앞의 프록시는 HTTPS를 제공하고 요청의 `X-Forwarded-Proto`를 설정해야 합니다.

| 서버 환경 변수 | 값 |
| --- | --- |
| `DJANGO_DEBUG` | `0` |
| `DJANGO_SECRET_KEY` | 운영 전용의 긴 무작위 문자열 |
| `DJANGO_ALLOWED_HOSTS` | 서비스 주소의 호스트명. 여러 개면 쉼표로 구분 |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | 접속할 HTTPS 주소. 여러 개면 쉼표로 구분 |
| `DJANGO_BEHIND_HTTPS_PROXY` | HTTPS를 종료하는 프록시를 사용할 때 `1` |
| `DJANGO_DATABASE_URL` | Supabase Session pooler 주소 |
| `DJANGO_DATABASE_PASSWORD` | 접속 주소와 비밀번호를 분리해서 설정할 때 DB 비밀번호 |

서버에서 `/var/lib/sapgu`에 쓰기 가능한 영구 볼륨을 연결합니다. PNG 표지는 그 아래 `media/`, 손글씨 인식 모델은 `ocr-models/`에 저장됩니다. 로컬에서 올린 PNG 표지가 있으면 기존 `notes-site/media/`의 파일을 서버 볼륨의 `media/`로 복사합니다.

```sh
docker build -t sapgu ./notes-site
docker run --rm --env-file path/to/server.env sapgu python manage.py prepare_supabase
docker run --rm --env-file path/to/server.env sapgu python manage.py verify_deployment
docker run --rm --env-file path/to/server.env -p 8000:8000 -v sapgu-data:/var/lib/sapgu sapgu
```

호스팅 서비스가 `PORT`를 제공하면 Gunicorn이 그 포트에서 실행합니다. 상태 확인 경로는 `/healthz/`입니다. 배포 전 같은 DB에서 `python manage.py changepassword demo`로 기존 데모 계정 비밀번호를 바꾸고, `python manage.py createsuperuser`로 관리자를 만든 뒤 `/admin/`의 초대 코드 목록에서 공개된 데모 코드를 비활성화합니다. `verify_deployment`는 이 조건, 마이그레이션 여부, 정적 파일을 확인합니다.

읽기 전용 점검 외의 테스트는 Supabase 접속 주소를 제외하고 로컬 테스트 DB에서 실행합니다.

## Supabase 연결

Supabase 프로젝트에서 **Connect → Session pooler**의 PostgreSQL 주소를 복사합니다. 서버에 IPv6 연결이 있으면 **Direct connection**도 사용할 수 있습니다. 주소에 들어가는 데이터베이스 비밀번호에 특수문자가 있으면 URL 인코딩한 값을 사용합니다.

`notes-site/.env` 또는 배포 서버 환경 변수에 `DJANGO_DATABASE_URL`을 설정합니다. 주소에서 비밀번호를 빼고 `DJANGO_DATABASE_PASSWORD`에 직접 입력할 수도 있습니다. 별도 비밀번호 칸을 비워 두거나 주소를 설정하지 않으면 로컬 SQLite를 사용합니다. Supabase 주소는 서버에서만 사용합니다.

```powershell
py -3.13 -m pip install -r requirements.txt
py -3.13 manage.py prepare_supabase --check
py -3.13 manage.py prepare_supabase
```

Django는 전용 `sapgu` 스키마에 테이블을 만듭니다. Supabase Data API의 **Exposed schemas**에 `sapgu`를 추가하지 않습니다. 기존 Django 로그인과 초대 코드, 공책 접근 권한을 사용합니다.

### 기존 SQLite 데이터 이전

대상 스키마의 마이그레이션을 마친 뒤, 신규 가입이나 데모 데이터 생성 전에 이전합니다. 아래 명령은 기존 계정, 필기, 타이머 및 학습 기록을 복사합니다. 세션은 이전에서 제외되어 다시 로그인해야 합니다.

```powershell
$transferFile = Join-Path $env:TEMP ("sapgu-" + [Guid]::NewGuid() + ".json")
py -3.13 -X utf8 manage.py dumpdata --database local_sqlite --natural-foreign --exclude contenttypes --exclude auth.permission --exclude sessions --output $transferFile
if ($LASTEXITCODE -eq 0) { py -3.13 -X utf8 manage.py loaddata --database default $transferFile }
```

전송 파일에는 계정 정보와 필기 내용이 들어 있습니다. 이전을 확인한 뒤 삭제하고, PNG 공책 표지가 있으면 기존 `media/` 파일도 배포 서버로 복사합니다. 플래너에서 직접 작성한 일정과 메모는 현재 브라우저에 저장되므로 이 DB 이전에는 포함되지 않습니다.

## 손글씨 자동 인식 설정

서버에 설치된 EasyOCR이 한국어·영어 필기를 인식하므로 OpenAI API 키나 사용자별
프로그램 설치가 필요하지 않습니다. 서버를 처음 준비할 때만 `ocr-models` 폴더에
인식 모델을 내려받고, 이후 모든 사용자가 같은 서버 모델을 공유합니다.

필기 화면에서 `손글씨 자동 인식`을 누르면 필기 이미지를 서버 내부에서 인식하고
결과를 검토창에 채웁니다. 사용자가 내용을 확인·수정한 뒤 저장하면 검색과 빈칸
학습에 사용됩니다.

- 예시 계정: `demo`
- 예시 비밀번호: `sapgu-demo`
- 새 회원가입용 초대 코드: `SAPGU-START`

예시 비밀번호와 개발용 비밀 키는 로컬 확인용입니다. 실제 배포 전에는 환경 변수와 안전한 계정으로 바꿔야 합니다.

관리자 계정은 `py -3.13 manage.py createsuperuser`로 만들 수 있습니다. 관리자 로그인 뒤 `/admin/`에서 초대 코드를 추가하고 모든 사용자의 필기 데이터를 확인할 수 있습니다.

## 현재 범위

- 아이디·비밀번호 로그인과 초대 코드 회원가입
- 사용자별 비공개 공책, 챕터, 페이지
- A4 필기지의 펜·형광펜·지우개, 필기지 템플릿, 자동 저장
- 서버 내부 EasyOCR을 이용한 한국어·영어 손글씨 자동 인식과 결과 검토
- 인식 텍스트 검색·학습용 핵심어 저장
- 핵심어 빈칸 학습
- 관리자 화면에서 사용자 필기 열람 가능

전체 필기 내용 검색, 재배치, 마인드맵, 펜그램 학습은 후속 단계입니다.
