from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("notes", "0003_page_sticky_notes_page_text_boxes"),
    ]

    operations = [
        migrations.CreateModel(
            name="StudySession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("client_id", models.CharField(max_length=80, verbose_name="클라이언트 기록 ID")),
                ("subject", models.CharField(choices=[("korean", "국어"), ("english", "영어"), ("math", "수학"), ("science", "과학"), ("social", "사회"), ("etc", "기타")], max_length=20, verbose_name="과목")),
                ("mode", models.CharField(choices=[("normal", "일반"), ("pomodoro", "뽀모도로"), ("mock", "모의고사")], max_length=20, verbose_name="타이머 모드")),
                ("started_at", models.DateTimeField(verbose_name="시작 시각")),
                ("ended_at", models.DateTimeField(verbose_name="종료 시각")),
                ("duration_seconds", models.PositiveIntegerField(verbose_name="집중 시간(초)")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="저장 시각")),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="study_sessions", to=settings.AUTH_USER_MODEL, verbose_name="사용자")),
            ],
            options={
                "verbose_name": "타이머 공부 기록",
                "verbose_name_plural": "타이머 공부 기록",
                "ordering": ["started_at", "id"],
                "indexes": [models.Index(fields=["owner", "started_at"], name="notes_study_owner_i_b9a7d6_idx")],
                "constraints": [models.UniqueConstraint(fields=("owner", "client_id"), name="unique_study_session_per_user_client_id")],
            },
        ),
    ]
