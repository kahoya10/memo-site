from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone


def notebook_cover_path(instance, filename):
    safe_name = Path(filename).name
    return f"notebook-covers/user-{instance.owner_id}/{safe_name}"


def validate_cover_size(upload):
    if getattr(upload, "_committed", False):
        return
    if upload.size > 5 * 1024 * 1024:
        raise ValidationError("표지 PNG는 5MB 이하여야 합니다.")


def default_drawing_palettes():
    return [
        {"id": "basic", "name": "기본", "colors": ["#343A40", "#4776A8", "#D65A5A", "#71896B", "#9380A3", "#C19A46"], "built_in": True},
        {"id": "leafy-green", "name": "초록 정원", "colors": ["#132A13", "#31572C", "#4F772D", "#90A955", "#ECF39E"], "built_in": True},
        {"id": "pastel-rainbow", "name": "선명한 파스텔", "colors": ["#70D6FF", "#FF70A6", "#FF9770", "#FFD670", "#E9FF70"], "built_in": True},
        {"id": "soft-rainbow", "name": "연한 파스텔", "colors": ["#FBF8CC", "#FDE4CF", "#FFCFD2", "#F1C0E8", "#CFBAF0", "#A3C4F3", "#90DBF4", "#8EECF5", "#98F5E1", "#B9FBC0"], "built_in": True},
    ]


def default_drawing_tools():
    return [
        {"id": "pencil", "name": "연필", "kind": "pencil", "color": "#343A40", "width": 2, "opacity": 0.72, "group": "general"},
        {"id": "pen", "name": "볼펜", "kind": "pen", "color": "#343A40", "width": 3, "opacity": 1, "group": "general"},
        {"id": "highlighter", "name": "형광펜", "kind": "highlighter", "color": "#FFD670", "width": 18, "opacity": 0.32, "group": "general"},
        {"id": "study-blank", "name": "빈칸", "kind": "highlighter", "color": "#FFD670", "width": 18, "opacity": 0.32, "group": "study", "study_role": "blank", "fixed_color": True},
        {"id": "study-card-highlight", "name": "카드 형광펜", "kind": "highlighter", "color": "#4776A8", "width": 18, "opacity": 0.32, "group": "study", "study_role": "card", "fixed_color": True},
        {"id": "study-card-pen", "name": "카드 볼펜", "kind": "pen", "color": "#4776A8", "width": 3, "opacity": 1, "group": "study", "study_role": "card", "fixed_color": True},
    ]


class DrawingPreferences(models.Model):
    ERASER_MODES = [("stroke", "획 지우기"), ("area", "영역 지우기"), ("lasso", "올가미 지우기")]
    PALM_MODES = [("auto", "자동"), ("on", "켜기"), ("off", "끄기")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="drawing_preferences")
    tools = models.JSONField(default=default_drawing_tools)
    palettes = models.JSONField(default=default_drawing_palettes)
    active_palette = models.CharField(max_length=80, default="basic")
    eraser_mode = models.CharField(max_length=10, choices=ERASER_MODES, default="stroke")
    palm_rejection = models.CharField(max_length=10, choices=PALM_MODES, default="auto")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username} 필기 설정"


class InviteCode(models.Model):
    code = models.CharField("초대 코드", max_length=40, unique=True)
    is_active = models.BooleanField("사용 가능", default=True)
    max_uses = models.PositiveIntegerField("최대 사용 횟수", default=30)
    used_count = models.PositiveIntegerField("사용 횟수", default=0)
    expires_at = models.DateTimeField("만료 시각", blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="만든 관리자",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_invite_codes",
    )
    created_at = models.DateTimeField("만든 시각", auto_now_add=True)

    class Meta:
        verbose_name = "초대 코드"
        verbose_name_plural = "초대 코드"

    def __str__(self):
        return self.code

    @property
    def is_available(self):
        if not self.is_active or self.used_count >= self.max_uses:
            return False
        return not self.expires_at or self.expires_at > timezone.now()


class Notebook(models.Model):
    COVER_STYLES = [
        ("blue", "청회색"),
        ("coral", "붉은 흙색"),
        ("green", "잎새색"),
        ("violet", "보라색"),
        ("gold", "황토색"),
        ("slate", "먹청색"),
        ("hanji", "서당 한지"),
        ("linen", "오트밀 리넨"),
        ("marble", "푸른 마블"),
        ("gingham", "세이지 체크"),
        ("orchard", "살구꽃"),
        ("moon", "달밤"),
        ("frame", "고전 문양"),
        ("waves", "청록 물결"),
        ("geo", "황토 기하학"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="작성자",
        on_delete=models.CASCADE,
        related_name="notebooks",
    )
    title = models.CharField("공책 제목", max_length=80)
    subject = models.CharField("과목", max_length=40)
    cover_style = models.CharField(
        "표지 디자인",
        max_length=20,
        choices=COVER_STYLES,
        default="blue",
    )
    cover_upload = models.FileField(
        "사용자 PNG 표지",
        upload_to=notebook_cover_path,
        blank=True,
        validators=[FileExtensionValidator(["png"]), validate_cover_size],
    )
    created_at = models.DateTimeField("만든 시각", auto_now_add=True)
    updated_at = models.DateTimeField("수정 시각", auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "공책"
        verbose_name_plural = "공책"

    def __str__(self):
        return f"{self.subject} · {self.title}"


class Chapter(models.Model):
    notebook = models.ForeignKey(
        Notebook,
        verbose_name="공책",
        on_delete=models.CASCADE,
        related_name="chapters",
    )
    title = models.CharField("챕터 제목", max_length=80)
    position = models.PositiveIntegerField("순서", default=0)
    created_at = models.DateTimeField("만든 시각", auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "챕터"
        verbose_name_plural = "챕터"

    def __str__(self):
        return f"{self.notebook.title} / {self.title}"


class Page(models.Model):
    PAPER_TEMPLATES = [
        ("lined", "줄 노트"),
        ("wide-lined", "넓은 줄"),
        ("margin-lined", "여백 줄 노트"),
        ("grid", "모눈"),
        ("fine-grid", "촘촘한 모눈"),
        ("dots", "도트"),
        ("blank", "무지"),
        ("cream", "크림 무지"),
        ("hanji", "서당 한지"),
        ("cornell", "코넬 노트"),
        ("two-column", "두 칸 노트"),
        ("weekly", "주간 계획"),
        ("music", "오선지"),
        ("handwriting", "글씨 연습"),
        ("custom", "내 PNG 속지"),
    ]
    RECOGNITION_STATUS = [
        ("not_requested", "인식 전"),
        ("needs_review", "확인 필요"),
        ("reviewed", "확인 완료"),
    ]

    chapter = models.ForeignKey(
        Chapter,
        verbose_name="챕터",
        on_delete=models.CASCADE,
        related_name="pages",
    )
    title = models.CharField("페이지 제목", max_length=100, default="새 페이지")
    position = models.PositiveIntegerField("순서", default=0)
    paper_template = models.CharField(
        "필기지",
        max_length=20,
        choices=PAPER_TEMPLATES,
        default="lined",
    )
    paper_image = models.BinaryField("사용자 PNG 속지", null=True, editable=False)
    ink_data = models.JSONField("손글씨 선 데이터", default=list, blank=True)
    text_boxes = models.JSONField("텍스트 상자", default=list, blank=True)
    sticky_notes = models.JSONField("스티커 메모", default=list, blank=True)
    text_content = models.TextField("텍스트 필기", blank=True)
    recognized_text = models.TextField("인식된 텍스트", blank=True)
    recognition_blocks = models.JSONField("손글씨 인식 위치", default=list, blank=True)
    uncertain_ranges = models.JSONField("인식 확인 필요 위치", default=list, blank=True)
    quiz_terms = models.JSONField("빈칸 단어", default=list, blank=True)
    recognition_status = models.CharField(
        "인식 상태",
        max_length=20,
        choices=RECOGNITION_STATUS,
        default="not_requested",
    )
    created_at = models.DateTimeField("만든 시각", auto_now_add=True)
    updated_at = models.DateTimeField("수정 시각", auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "페이지"
        verbose_name_plural = "페이지"

    def __str__(self):
        return f"{self.chapter} / {self.position + 1}쪽"


class HandwritingSample(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="handwriting_samples")
    glyph = models.CharField(max_length=1)
    signature = models.BinaryField(editable=False)
    reviewed = models.PositiveIntegerField(default=0)
    correct = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["glyph"]
        constraints = [models.UniqueConstraint(fields=["owner", "glyph"], name="unique_handwriting_sample_glyph")]


class NotebookView(models.Model):
    KINDS = [("reorder", "재배치"), ("map", "마인드맵")]
    UNITS = [("page", "페이지"), ("paragraph", "문단")]

    notebook = models.ForeignKey(Notebook, on_delete=models.CASCADE, related_name="saved_views")
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=10, choices=KINDS)
    unit = models.CharField(max_length=10, choices=UNITS, default="page")
    items = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]


class QuizAttempt(models.Model):
    MODES = [("blank", "빈칸"), ("card", "카드 매치"), ("speed", "스피드 퀴즈")]

    notebook = models.ForeignKey(Notebook, on_delete=models.CASCADE, related_name="quiz_attempts")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    client_id = models.UUIDField()
    mode = models.CharField(max_length=10, choices=MODES)
    duration_seconds = models.PositiveIntegerField()
    results = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["owner", "client_id"], name="unique_quiz_attempt_client")]


class StudySession(models.Model):
    SUBJECTS = [
        ("korean", "국어"),
        ("english", "영어"),
        ("math", "수학"),
        ("science", "과학"),
        ("social", "사회"),
        ("etc", "기타"),
    ]
    MODES = [
        ("normal", "일반"),
        ("pomodoro", "뽀모도로"),
        ("mock", "모의고사"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="사용자",
        on_delete=models.CASCADE,
        related_name="study_sessions",
    )
    client_id = models.CharField("클라이언트 기록 ID", max_length=80)
    subject = models.CharField("과목", max_length=20, choices=SUBJECTS)
    mode = models.CharField("타이머 모드", max_length=20, choices=MODES)
    started_at = models.DateTimeField("시작 시각")
    ended_at = models.DateTimeField("종료 시각")
    duration_seconds = models.PositiveIntegerField("집중 시간(초)")
    created_at = models.DateTimeField("저장 시각", auto_now_add=True)

    class Meta:
        ordering = ["started_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "client_id"],
                name="unique_study_session_per_user_client_id",
            )
        ]
        indexes = [models.Index(fields=["owner", "started_at"])]
        verbose_name = "타이머 공부 기록"
        verbose_name_plural = "타이머 공부 기록"

    def __str__(self):
        return f"{self.owner} · {self.get_subject_display()} · {self.started_at:%Y-%m-%d %H:%M}"

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("타이머 공부 기록은 수정할 수 없습니다.")
        super().save(*args, **kwargs)
