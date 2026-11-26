import base64
import binascii
import io
import json
import logging
import re
import threading
from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.core import signing
from django.db import DatabaseError, connection, transaction
from django.db.models import F, Max, Q, Prefetch
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_POST

from .forms import InviteSignupForm, NotebookCoverForm, NotebookForm
from .handwriting_examples import HANDWRITING_EXAMPLES
from .study_material import marked_regions
from .models import Chapter, DrawingPreferences, HandwritingSample, Notebook, NotebookView, Page, QuizAttempt, StudySession


logger = logging.getLogger(__name__)
HANDWRITING_DATA_URL = re.compile(
    r"^data:image/(?P<format>png|jpeg|jpg|webp);base64,(?P<data>[A-Za-z0-9+/=]+)$"
)
RECOGNITION_REVIEW_SALT = "notes.page-recognition-review"
PROFILE_CHARACTERS = (
    ("sapsal", "삽살개"),
    ("jindo", "진돗개"),
    ("poodle", "푸들"),
    ("beagle", "비글"),
    ("dachshund", "닥스훈트"),
    ("dalmatian", "달마시안"),
)
_local_ocr_reader = None
_local_ocr_reader_lock = threading.Lock()
_local_ocr_inference_lock = threading.Lock()


@never_cache
def dashboard(request):
    if not request.user.is_authenticated:
        form = AuthenticationForm(request, data=request.POST or None)
        if request.method == "POST" and form.is_valid():
            login(request, form.get_user())
            next_url = request.POST.get("next", "")
            if next_url and url_has_allowed_host_and_scheme(
                next_url,
                allowed_hosts={request.get_host()},
                require_https=request.is_secure(),
            ):
                return redirect(next_url)
            return redirect("notes:dashboard")
        return render(
            request,
            "registration/main_login.html",
            {"form": form, "next": request.GET.get("next", "")},
        )
    return render(
        request,
        "notes/dashboard.html",
        {
            "notebook_count": Notebook.objects.filter(owner=request.user).count(),
            "profile_characters": PROFILE_CHARACTERS,
        },
    )


@never_cache
@require_http_methods(["GET", "HEAD"])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        return HttpResponse("Database unavailable", status=503, content_type="text/plain")
    return HttpResponse("OK", content_type="text/plain")


@login_required
def timer(request):
    return render(request, "notes/timer.html")


@never_cache
@login_required
def planner(request):
    return render(request, "notes/planner.html")


@never_cache
@login_required
@require_http_methods(["GET", "POST"])
def study_sessions_api(request):
    if request.method == "GET":
        sessions = StudySession.objects.filter(owner=request.user).order_by("started_at", "id")
        return JsonResponse(
            {
                "sessions": [
                    {
                        "id": session.id,
                        "subject": session.subject,
                        "mode": session.mode,
                        "started_at": session.started_at.isoformat(),
                        "ended_at": session.ended_at.isoformat(),
                        "duration_seconds": session.duration_seconds,
                    }
                    for session in sessions
                ]
            }
        )

    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "올바르지 않은 기록입니다."}, status=400)

    client_id = str(payload.get("client_id", ""))[:80]
    subject = str(payload.get("subject", ""))
    mode = str(payload.get("mode", ""))
    started_at = parse_datetime(str(payload.get("started_at", "")))
    ended_at = parse_datetime(str(payload.get("ended_at", "")))
    try:
        duration_seconds = max(0, int(payload.get("duration_seconds", 0)))
    except (TypeError, ValueError):
        duration_seconds = 0

    if not client_id or subject not in dict(StudySession.SUBJECTS) or mode not in dict(StudySession.MODES):
        return JsonResponse({"ok": False, "error": "과목 또는 타이머 정보가 올바르지 않습니다."}, status=400)
    if not started_at or not ended_at:
        return JsonResponse({"ok": False, "error": "시작·종료 시각이 필요합니다."}, status=400)
    if timezone.is_naive(started_at):
        started_at = timezone.make_aware(started_at)
    if timezone.is_naive(ended_at):
        ended_at = timezone.make_aware(ended_at)
    wall_seconds = int((ended_at - started_at).total_seconds())
    if wall_seconds <= 0 or duration_seconds <= 0 or duration_seconds > wall_seconds + 2:
        return JsonResponse({"ok": False, "error": "집중 시간 범위가 올바르지 않습니다."}, status=400)
    if duration_seconds > 24 * 60 * 60 or ended_at > timezone.now() + timedelta(minutes=1):
        return JsonResponse({"ok": False, "error": "저장할 수 없는 시간 범위입니다."}, status=400)

    rounded_minutes = int(duration_seconds / 60 + 0.5)
    if rounded_minutes < 1:
        return JsonResponse({"ok": True, "recorded": False, "reason": "rounded_to_zero"})

    session, created = StudySession.objects.get_or_create(
        owner=request.user,
        client_id=client_id,
        defaults={
            "subject": subject,
            "mode": mode,
            "started_at": started_at,
            "ended_at": ended_at,
            "duration_seconds": duration_seconds,
        },
    )
    return JsonResponse({"ok": True, "recorded": True, "created": created, "id": session.id})


def signup(request):
    if request.user.is_authenticated:
        return redirect("notes:dashboard")
    form = InviteSignupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save()
        login(request, user)
        messages.success(request, "삽구의 서당에 온 것을 환영해요.")
        return redirect("notes:dashboard")
    return render(request, "registration/signup.html", {"form": form})


def accessible_notebook(user, notebook_id):
    queryset = Notebook.objects.select_related("owner")
    if not user.is_staff:
        queryset = queryset.filter(owner=user)
    return get_object_or_404(queryset, pk=notebook_id)


@login_required
def library(request):
    query = request.GET.get("q", "").strip()
    notebooks = Notebook.objects.filter(owner=request.user)
    if query:
        needle = query.casefold()
        objects = Page.objects.filter(chapter__notebook__owner=request.user).values_list(
            "chapter__notebook_id", "text_boxes", "sticky_notes"
        )
        matching_ids = {
            notebook_id for notebook_id, text_boxes, sticky_notes in objects.iterator()
            if any(needle in str(item.get("text", "")).casefold() for item in [*text_boxes, *sticky_notes] if isinstance(item, dict))
        }
        notebooks = notebooks.filter(
            Q(title__icontains=query)
            | Q(subject__icontains=query)
            | Q(chapters__title__icontains=query)
            | Q(chapters__pages__title__icontains=query)
            | Q(chapters__pages__text_content__icontains=query)
            | Q(chapters__pages__recognized_text__icontains=query)
            | Q(pk__in=matching_ids)
        ).distinct()
    return render(
        request,
        "notes/library.html",
        {
            "notebooks": notebooks,
            "query": query,
            "create_form": NotebookForm(),
        },
    )


@login_required
@require_POST
@transaction.atomic
def notebook_create(request):
    form = NotebookForm(request.POST, request.FILES)
    if not form.is_valid():
        notebooks = Notebook.objects.filter(owner=request.user)
        return render(
            request,
            "notes/library.html",
            {"notebooks": notebooks, "query": "", "create_form": form, "open_create": True},
            status=400,
        )
    notebook = form.save(commit=False)
    notebook.owner = request.user
    notebook.save()
    chapter = Chapter.objects.create(notebook=notebook, title="첫 번째 챕터", position=0)
    page = Page.objects.create(chapter=chapter, title="첫 페이지", position=0)
    messages.success(request, f"‘{notebook.title}’ 공책을 만들었어요.")
    return redirect("notes:page_editor", notebook_id=notebook.id, page_id=page.id)


@login_required
def notebook_cover(request, notebook_id):
    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    form = NotebookCoverForm(instance=notebook)
    if request.method == "POST":
        form = NotebookCoverForm(request.POST, request.FILES, instance=notebook)
        if form.is_valid():
            form.save(commit=False).save(update_fields=["cover_style", "cover_upload", "updated_at"])
            return redirect("notes:library")
    return render(request, "notes/notebook_cover.html", {"notebook": notebook, "form": form})


@login_required
@never_cache
@require_http_methods(["GET", "HEAD"])
def notebook_cover_image(request, name):
    notebooks = Notebook.objects.filter(cover_upload=name)
    if not request.user.is_staff:
        notebooks = notebooks.filter(owner=request.user)
    cover = get_object_or_404(notebooks).cover_upload
    try:
        return FileResponse(cover.open("rb"), content_type="image/png")
    except FileNotFoundError as error:
        raise Http404 from error


@login_required
@require_POST
def notebook_delete(request, notebook_id):
    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    title = notebook.title
    notebook.delete()
    messages.success(request, f"‘{title}’ 공책을 삭제했어요.")
    return redirect("notes:library")


def editor_redirect_for_page(notebook, page_id):
    if page_id and Page.objects.filter(pk=page_id, chapter__notebook=notebook).exists():
        return redirect("notes:page_editor", notebook_id=notebook.id, page_id=page_id)
    return redirect("notes:editor", notebook_id=notebook.id)


@login_required
@require_POST
def notebook_rename(request, notebook_id):
    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    title = request.POST.get("title", "").strip()[:80]
    if title:
        notebook.title = title
        notebook.save(update_fields=["title", "updated_at"])
    return editor_redirect_for_page(notebook, request.POST.get("page_id"))


@login_required
def editor(request, notebook_id, page_id=None):
    notebook = accessible_notebook(request.user, notebook_id)
    chapters = notebook.chapters.prefetch_related(Prefetch("pages", queryset=Page.objects.defer("paper_image")))
    pages = Page.objects.filter(chapter__notebook=notebook).defer("paper_image").select_related("chapter").order_by(
        "chapter__position", "chapter__id", "position", "id"
    )
    if page_id is None:
        page = pages.first()
        if page is None:
            chapter = notebook.chapters.first() or Chapter.objects.create(
                notebook=notebook, title="첫 번째 챕터", position=0
            )
            page = Page.objects.create(chapter=chapter, title="첫 페이지", position=0)
        return redirect("notes:page_editor", notebook_id=notebook.id, page_id=page.id)
    page = get_object_or_404(pages, pk=page_id)
    if page.text_content and not page.sticky_notes:
        page.sticky_notes = [
            {
                "id": f"legacy-note-{page.id}",
                "x": 0.66,
                "y": 0.08,
                "width": 0.26,
                "height": 0.18,
                "text": page.text_content,
                "color": "#FFF2A8",
            }
        ]
        page.text_content = ""
        page.save(update_fields=["sticky_notes", "text_content", "updated_at"])
    drawing_preferences, _ = DrawingPreferences.objects.get_or_create(user=request.user)
    normalized_tools = []
    tools_changed = False
    opacity_defaults = {"pencil": 0.72, "pen": 1, "highlighter": 0.32}
    for tool in drawing_preferences.tools:
        normalized = dict(tool)
        if "opacity" not in normalized:
            normalized["opacity"] = opacity_defaults.get(normalized.get("kind"), 1)
            tools_changed = True
        normalized_tools.append(normalized)
    if tools_changed:
        drawing_preferences.tools = normalized_tools
        drawing_preferences.save(update_fields=["tools", "updated_at"])

    ordered_pages = list(pages)
    current_index = next(index for index, item in enumerate(ordered_pages) if item.id == page.id)
    previous_page = ordered_pages[current_index - 1] if current_index > 0 else None
    next_page = ordered_pages[current_index + 1] if current_index + 1 < len(ordered_pages) else None
    page_previews = [
        {
            "id": item.id,
            "ink_data": item.ink_data,
            "text_boxes": item.text_boxes,
            "sticky_notes": item.sticky_notes,
        }
        for item in ordered_pages
    ]
    return render(
        request,
        "notes/editor.html",
        {
            "notebook": notebook,
            "chapters": chapters,
            "current_page": page,
            "drawing_preferences": {
                "tools": normalized_tools,
                "palettes": drawing_preferences.palettes,
                "active_palette": drawing_preferences.active_palette,
                "eraser_mode": drawing_preferences.eraser_mode,
                "palm_rejection": drawing_preferences.palm_rejection,
            },
            "page_previews": page_previews,
            "previous_page": previous_page,
            "next_page": next_page,
            "has_custom_paper": pages.filter(pk=page.id, paper_image__isnull=False).exists(),
        },
    )


@login_required
@require_POST
def drawing_preferences_save(request):
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "error": "올바르지 않은 요청입니다."}, status=400)

    tools = payload.get("tools")
    palettes = payload.get("palettes")
    if not isinstance(tools, list) or not isinstance(palettes, list):
        return JsonResponse({"ok": False, "error": "필기 설정 형식이 올바르지 않습니다."}, status=400)

    clean_palettes = []
    for palette in palettes[:100]:
        if not isinstance(palette, dict):
            continue
        colors = [
            color.upper()
            for color in palette.get("colors", [])
            if isinstance(color, str) and len(color) == 7 and color.startswith("#")
        ]
        palette_id = str(palette.get("id", ""))[:80]
        if palette_id and colors:
            clean_palettes.append(
                {
                    "id": palette_id,
                    "name": str(palette.get("name", "새 팔레트"))[:40],
                    "colors": colors,
                    "built_in": bool(palette.get("built_in", False)),
                }
            )

    allowed_kinds = {"pencil", "pen", "highlighter"}
    clean_tools = []
    for tool in tools[:100]:
        if not isinstance(tool, dict) or tool.get("kind") not in allowed_kinds:
            continue
        try:
            width = max(1, min(40, float(tool.get("width", 3))))
        except (TypeError, ValueError):
            width = 3
        clean_tool = {
            "id": str(tool.get("id", ""))[:80],
            "name": str(tool.get("name", "필기도구"))[:30],
            "kind": tool["kind"],
            "color": str(tool.get("color", "#343A40"))[:7],
            "width": width,
            "opacity": max(0.05, min(1, float(tool.get("opacity", 1)))) if isinstance(tool.get("opacity", 1), (int, float)) else 1,
            "group": "study" if tool.get("group") == "study" else "general",
        }
        if tool.get("study_role") in {"blank", "card"}:
            clean_tool["study_role"] = tool["study_role"]
        if tool.get("fixed_color"):
            clean_tool["fixed_color"] = True
        clean_tools.append(clean_tool)

    if not clean_tools or not clean_palettes:
        return JsonResponse({"ok": False, "error": "필기 도구나 팔레트를 비울 수 없습니다."}, status=400)

    preferences, _ = DrawingPreferences.objects.get_or_create(user=request.user)
    preferences.tools = clean_tools
    preferences.palettes = clean_palettes
    active_palette = str(payload.get("active_palette", "basic"))[:80]
    preferences.active_palette = active_palette if any(item["id"] == active_palette for item in clean_palettes) else clean_palettes[0]["id"]
    if payload.get("eraser_mode") in dict(DrawingPreferences.ERASER_MODES):
        preferences.eraser_mode = payload["eraser_mode"]
    if payload.get("palm_rejection") in dict(DrawingPreferences.PALM_MODES):
        preferences.palm_rejection = payload["palm_rejection"]
    preferences.save()
    return JsonResponse({"ok": True})


@login_required
@require_POST
def chapter_add(request, notebook_id):
    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    title = request.POST.get("title", "").strip()[:80] or "새 챕터"
    after_chapter_id = request.POST.get("after_chapter_id")
    if after_chapter_id:
        after_chapter = get_object_or_404(notebook.chapters, pk=after_chapter_id)
        next_position = after_chapter.position + 1
        notebook.chapters.filter(position__gte=next_position).update(position=F("position") + 1)
    else:
        next_position = (notebook.chapters.aggregate(value=Max("position"))["value"] or -1) + 1
    chapter = Chapter.objects.create(notebook=notebook, title=title, position=next_position)
    page = Page.objects.create(chapter=chapter, title="첫 페이지", position=0)
    return redirect("notes:page_editor", notebook_id=notebook.id, page_id=page.id)


@login_required
@require_POST
def chapter_rename(request, chapter_id):
    chapter = get_object_or_404(Chapter, pk=chapter_id, notebook__owner=request.user)
    title = request.POST.get("title", "").strip()[:80]
    if title:
        chapter.title = title
        chapter.save(update_fields=["title"])
    return editor_redirect_for_page(chapter.notebook, request.POST.get("page_id"))


@login_required
@require_POST
def chapter_delete(request, chapter_id):
    chapter = get_object_or_404(Chapter.objects.select_related("notebook"), pk=chapter_id, notebook__owner=request.user)
    notebook = chapter.notebook
    chapter.delete()
    return editor_redirect_for_page(notebook, request.POST.get("page_id"))


@login_required
@require_POST
def page_delete(request, page_id):
    page = get_object_or_404(Page.objects.defer("paper_image"), pk=page_id, chapter__notebook__owner=request.user)
    notebook = page.chapter.notebook
    sibling = page.chapter.pages.filter(position__gt=page.position).values_list("id", flat=True).first()
    if sibling is None:
        sibling = page.chapter.pages.exclude(pk=page.pk).order_by("-position", "-id").values_list("id", flat=True).first()
    page.delete()
    return editor_redirect_for_page(notebook, sibling)


@login_required
@require_http_methods(["GET", "POST"])
def page_paper(request, page_id):
    pages = Page.objects.select_related("chapter__notebook")
    if request.method == "POST" or not request.user.is_staff:
        pages = pages.filter(chapter__notebook__owner=request.user)
    if request.method == "GET":
        page = get_object_or_404(pages.only("paper_image", "chapter__notebook__owner"), pk=page_id, paper_image__isnull=False)
        response = HttpResponse(bytes(page.paper_image), content_type="image/png")
        response["Cache-Control"] = "private, no-cache"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    from PIL import Image

    page = get_object_or_404(pages.defer("paper_image"), pk=page_id)
    upload = request.FILES.get("paper_image")
    try:
        if not upload or upload.size > 5 * 1024 * 1024:
            raise ValueError
        image_data = upload.read()
        with Image.open(io.BytesIO(image_data)) as image:
            if image.format != "PNG" or image.width * image.height > 16_000_000:
                raise ValueError
            image.verify()
    except (OSError, ValueError, Image.DecompressionBombError):
        messages.error(request, "5MB 이하, 1600만 픽셀 이하의 PNG 속지를 골라 주세요.")
    else:
        page.paper_image = image_data
        page.paper_template = "custom"
        page.save(update_fields=["paper_image", "paper_template", "updated_at"])
    return editor_redirect_for_page(page.chapter.notebook, page.id)


@login_required
@require_POST
@transaction.atomic
def page_add(request, chapter_id):
    chapter = get_object_or_404(Chapter.objects.select_for_update(), pk=chapter_id, notebook__owner=request.user)
    previous = chapter.pages.only("position", "paper_template", "paper_image").order_by("-position", "-id").first()
    next_position = previous.position + 1 if previous else 0
    paper = {}
    if previous and previous.paper_template in dict(Page.PAPER_TEMPLATES):
        if previous.paper_template != "custom":
            paper["paper_template"] = previous.paper_template
        elif previous.paper_image:
            paper = {"paper_template": "custom", "paper_image": previous.paper_image}
    page = Page.objects.create(
        chapter=chapter,
        title=f"{next_position + 1}쪽",
        position=next_position,
        **paper,
    )
    return redirect(
        "notes:page_editor", notebook_id=chapter.notebook_id, page_id=page.id
    )


@login_required
@require_POST
@transaction.atomic
def page_save(request, page_id):
    page = get_object_or_404(
        Page.objects.defer("paper_image").select_for_update(of=("self",)),
        pk=page_id, chapter__notebook__owner=request.user,
    )
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "error": "올바르지 않은 저장 요청입니다."}, status=400)

    ink_data = payload.get("ink_data", [])
    text_boxes = payload.get("text_boxes", [])
    sticky_notes = payload.get("sticky_notes", [])
    if not isinstance(ink_data, list) or len(ink_data) > 5000:
        return JsonResponse({"ok": False, "error": "손글씨 데이터가 너무 큽니다."}, status=400)
    if not isinstance(text_boxes, list) or len(text_boxes) > 500:
        return JsonResponse({"ok": False, "error": "텍스트 상자 데이터가 올바르지 않습니다."}, status=400)
    if not isinstance(sticky_notes, list) or len(sticky_notes) > 500:
        return JsonResponse({"ok": False, "error": "메모지 데이터가 올바르지 않습니다."}, status=400)
    page.ink_data = ink_data
    page.text_boxes = text_boxes
    page.sticky_notes = sticky_notes
    page.text_content = str(payload.get("text_content", ""))[:50000]
    fields = ["ink_data", "text_boxes", "sticky_notes", "text_content", "paper_template", "title", "updated_at"]
    template = payload.get("paper_template", page.paper_template)
    if isinstance(template, str) and template in dict(Page.PAPER_TEMPLATES) and (
        template != "custom" or Page.objects.filter(pk=page.id, paper_image__isnull=False).exists()
    ):
        page.paper_template = template
    title = str(payload.get("title", page.title)).strip()[:100]
    if title:
        page.title = title
    result = {"ok": True}
    if payload.get("recognition_reviewed") is True:
        quiz_terms = payload.get("quiz_terms", [])
        if not isinstance(quiz_terms, list):
            return JsonResponse({"ok": False, "error": "빈칸 단어 형식이 올바르지 않습니다."}, status=400)
        blocks = page.recognition_blocks
        score_review = page.recognition_status == "needs_review"
        if "recognition_token" in payload:
            try:
                token = payload["recognition_token"]
                if not isinstance(token, str):
                    raise signing.BadSignature
                review = signing.loads(token, salt=RECOGNITION_REVIEW_SALT)
                if review["page"] != page.id or review["owner"] != request.user.id:
                    raise signing.BadSignature
            except signing.BadSignature:
                return JsonResponse({"ok": False, "error": "인식 결과를 다시 불러와 주세요."}, status=400)
            blocks = review["blocks"]
            score_review = True

        text = str(payload.get("recognized_text", ""))[:50000]
        lines = text.split("\n")
        revised = [dict(block, text=line) for block, line in zip(blocks, lines)] if len(lines) == len(blocks) else []
        if score_review and revised and (page.recognition_status != "reviewed" or revised != page.recognition_blocks):
            for block in revised:
                if glyph := block.get("personalized"):
                    HandwritingSample.objects.filter(owner=request.user, glyph=glyph).update(
                        reviewed=F("reviewed") + 1, correct=F("correct") + int(block["text"].strip() == glyph),
                    )
        page.recognized_text = text
        page.quiz_terms = [str(term).strip()[:100] for term in quiz_terms if str(term).strip()][:50]
        page.recognition_blocks = revised
        page.recognition_status = "reviewed"
        page.uncertain_ranges = []
        fields.extend(["recognized_text", "quiz_terms", "recognition_blocks", "recognition_status", "uncertain_ranges"])
        result.update(recognized_text=text, quiz_terms=page.quiz_terms, blocks=revised)
    page.save(update_fields=fields)
    page.chapter.notebook.save(update_fields=["updated_at"])
    return JsonResponse({**result, "saved_at": page.updated_at.isoformat()})


def get_local_ocr_reader():
    global _local_ocr_reader
    if _local_ocr_reader is None:
        with _local_ocr_reader_lock:
            if _local_ocr_reader is None:
                from easyocr import Reader

                model_dir = settings.LOCAL_OCR_MODEL_DIR
                model_dir.mkdir(parents=True, exist_ok=True)
                _local_ocr_reader = Reader(
                    ["ko", "en"],
                    gpu=False,
                    model_storage_directory=str(model_dir),
                    download_enabled=settings.LOCAL_OCR_DOWNLOAD_ENABLED,
                    verbose=False,
                )
    return _local_ocr_reader


def recognize_handwriting_image(image_bytes, samples=(), allow_single_glyph=False):
    import numpy as np
    from PIL import Image, ImageOps
    from .handwriting import personalize_blocks

    with Image.open(io.BytesIO(image_bytes)) as source_image:
        if source_image.width * source_image.height > 36_000_000:
            raise ValueError("Image too large")
        image = ImageOps.exif_transpose(source_image).convert("RGB")
        image.thumbnail((2200, 2200))
        image_array = np.asarray(image)

    reader = get_local_ocr_reader()
    with _local_ocr_inference_lock:
        detected_text = reader.readtext(
            image_array,
            detail=1,
            paragraph=False,
            workers=0,
            batch_size=1,
            min_size=8,
            canvas_size=2560,
            mag_ratio=1.5,
        )
    height, width = image_array.shape[:2]
    blocks = []
    for corners, text, confidence in detected_text:
        if not text.strip():
            continue
        xs, ys = zip(*corners)
        bounds = [max(0, min(xs) / width), max(0, min(ys) / height), min(1, max(xs) / width), min(1, max(ys) / height)]
        blocks.append({"text": text.strip(), "bounds": [float(value) for value in bounds], "confidence": float(confidence)})
    return personalize_blocks(image, blocks, samples, allow_single_glyph)


@login_required
@require_POST
def page_recognize(request, page_id):
    page = get_object_or_404(Page.objects.defer("paper_image"), pk=page_id, chapter__notebook__owner=request.user)
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "올바르지 않은 인식 요청입니다."}, status=400)

    image_data = payload.get("image_data", "")
    if not isinstance(image_data, str):
        return JsonResponse({"ok": False, "error": "필기 이미지가 올바르지 않습니다."}, status=400)
    match = HANDWRITING_DATA_URL.fullmatch(image_data)
    if not match:
        return JsonResponse({"ok": False, "error": "지원하지 않는 필기 이미지 형식입니다."}, status=400)
    try:
        image_bytes = base64.b64decode(match.group("data"), validate=True)
    except (binascii.Error, ValueError):
        return JsonResponse({"ok": False, "error": "필기 이미지를 읽을 수 없습니다."}, status=400)
    if not image_bytes or len(image_bytes) > settings.HANDWRITING_IMAGE_MAX_BYTES:
        return JsonResponse({"ok": False, "error": "필기 이미지가 너무 큽니다."}, status=400)

    try:
        samples = list(HandwritingSample.objects.filter(owner=request.user).values_list("glyph", "signature"))
        blocks = recognize_handwriting_image(image_bytes, samples, payload.get("selection") is True)
    except Exception:
        logger.exception("Handwriting recognition failed for page %s", page.id)
        return JsonResponse(
            {"ok": False, "error": "손글씨 인식에 실패했어요. 잠시 후 다시 시도해 주세요."},
            status=502,
        )
    if not blocks:
        return JsonResponse(
            {"ok": False, "error": "인식할 수 있는 손글씨를 찾지 못했어요."},
            status=422,
        )

    recognized_text = "\n".join(block["text"] for block in blocks)[:50000]
    if payload.get("selection") is True:
        return JsonResponse({"ok": True, "recognized_text": recognized_text})
    token = signing.dumps(
        {"page": page.id, "owner": request.user.id, "blocks": blocks},
        salt=RECOGNITION_REVIEW_SALT,
        compress=True,
    )
    return JsonResponse({"ok": True, "recognized_text": recognized_text, "blocks": blocks, "recognition_token": token})


@login_required
@require_http_methods(["GET", "POST"])
def handwriting_settings(request):
    samples = HandwritingSample.objects.filter(owner=request.user)
    if request.method == "GET":
        return render(request, "notes/handwriting.html", {"samples": samples, "handwriting_examples": HANDWRITING_EXAMPLES})
    if request.POST.get("action") == "reset":
        samples.delete()
        return redirect("notes:handwriting_settings")

    import unicodedata
    from PIL import Image
    from .handwriting import glyph_signature

    glyph = unicodedata.normalize("NFC", request.POST.get("glyph", "").strip())
    data_url = request.POST.get("image_data", "")
    prefix = "data:image/png;base64,"
    try:
        if len(glyph) != 1 or unicodedata.category(glyph)[0] not in "LNPS" or not data_url.startswith(prefix) or len(data_url) > 350_000:
            raise ValueError
        if samples.count() >= 500 and not samples.filter(glyph=glyph).exists():
            return JsonResponse({"ok": False, "error": "글자 표본은 500개까지 저장할 수 있어요."}, status=400)
        data = base64.b64decode(data_url[len(prefix):], validate=True)
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or max(image.size) > 600:
                raise ValueError
            signature = glyph_signature(image)
        if not signature:
            raise ValueError
    except (binascii.Error, ValueError, OSError, Image.DecompressionBombError):
        return JsonResponse({"ok": False, "error": "글자 한 개를 입력하고 아래 칸에 같은 글자를 써 주세요."}, status=400)
    samples.update_or_create(owner=request.user, glyph=glyph, defaults={"signature": signature, "reviewed": 0, "correct": 0})
    return JsonResponse({"ok": True, "glyph": glyph})


def notebook_pages(notebook):
    return Page.objects.filter(chapter__notebook=notebook).defer("paper_image").select_related("chapter").order_by(
        "chapter__position", "chapter_id", "position", "id"
    )


@login_required
def organize(request, notebook_id):
    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    kind = request.GET.get("mode", "reorder")
    if kind not in dict(NotebookView.KINDS):
        kind = "reorder"
    saved_views = list(notebook.saved_views.filter(kind=kind))
    selected = next((item for item in saved_views if str(item.id) == request.GET.get("view")), None)
    source = []
    for page in notebook_pages(notebook):
        paragraphs = page.recognized_text.splitlines() or page.text_content.splitlines()
        paragraphs.extend(str(item.get("text", "")) for item in [*page.text_boxes, *page.sticky_notes] if isinstance(item, dict))
        source.append({
            "id": page.id, "title": page.title, "chapter": page.chapter.title,
            "ink": page.ink_data, "paper": page.paper_template,
            "paper_url": reverse("notes:page_paper", args=[page.id]) if page.paper_template == "custom" else "",
            "paragraphs": [text.strip() for text in paragraphs if text.strip()],
        })
    return render(request, "notes/organize.html", {
        "notebook": notebook, "kind": kind, "saved_views": saved_views, "selected": selected,
        "source": source, "items": selected.items if selected else [],
    })


@login_required
@require_POST
def organize_save(request, notebook_id):
    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    try:
        payload = json.loads(request.body)
        name = payload["name"].strip()
        kind, unit, raw = payload["kind"], payload["unit"], payload["items"]
        saved_id = int(payload["id"]) if payload.get("id") else None
        if not name or len(name) > 80 or kind not in dict(NotebookView.KINDS) or unit not in dict(NotebookView.UNITS):
            raise ValueError
        if not isinstance(raw, list) or len(raw) > 100:
            raise ValueError
        page_ids = set(notebook_pages(notebook).values_list("id", flat=True))
        seen = set()
        items = []
        for item in raw:
            if item["page"] not in page_ids:
                continue
            key = item["id"]
            paragraph = item.get("paragraph")
            if not isinstance(key, str) or not key or len(key) > 80 or key in seen:
                raise ValueError
            if paragraph is not None and (not isinstance(paragraph, int) or not 0 <= paragraph < 10000):
                raise ValueError
            seen.add(key)
            clean = {"id": key, "page": item["page"], "paragraph": paragraph}
            if kind == "map":
                clean.update(x=max(0, min(100, float(item["x"]))), y=max(0, min(100, float(item["y"]))), parent=item.get("parent"))
            items.append(clean)
        if kind == "map":
            for item in items:
                if item["parent"] not in seen or item["parent"] == item["id"]:
                    item["parent"] = None
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
        return JsonResponse({"ok": False, "error": "정리 내용을 확인해 주세요."}, status=400)
    if saved_id is not None:
        saved = get_object_or_404(notebook.saved_views, pk=saved_id, kind=kind)
        saved.name, saved.unit, saved.items = name, unit, items
        saved.save()
    else:
        saved = notebook.saved_views.create(name=name, kind=kind, unit=unit, items=items)
    return JsonResponse({"ok": True, "url": reverse("notes:organize", args=[notebook.id]) + f"?mode={kind}&view={saved.id}"})


def study_material(notebook):
    study_pages = []
    study_payload = []
    for page in notebook_pages(notebook):
        blanks = marked_regions(page.ink_data, "blank")
        cards = marked_regions(page.ink_data, "card")
        terms = page.quiz_terms if page.recognized_text else []
        if not (blanks or cards or terms):
            continue
        study_pages.append(page)
        study_payload.append({
            "id": page.id,
            "chapter": page.chapter.title,
            "title": page.title,
            "text": page.recognized_text,
            "terms": terms,
            "blanks": blanks,
            "cards": cards,
            "paper": page.paper_template,
            "paper_url": reverse("notes:page_paper", args=[page.id]) if page.paper_template == "custom" else "",
            "ink": page.ink_data if blanks or cards else [],
        })
    return study_pages, study_payload


@login_required
def study(request, notebook_id):
    notebook = accessible_notebook(request.user, notebook_id)
    study_pages, study_payload = study_material(notebook)
    attempts = QuizAttempt.objects.filter(notebook=notebook, owner=request.user)
    statistics = []
    missed = Counter()
    labels = {}
    for index, attempt in enumerate(attempts.iterator()):
        if index < 12:
            statistics.append((attempt, sum(result["correct"] for result in attempt.results), len(attempt.results)))
        for result in attempt.results:
            if not result["correct"]:
                missed[result["key"]] += 1
                labels[result["key"]] = result["label"]
    return render(
        request,
        "notes/study.html",
        {
            "notebook": notebook,
            "study_pages": study_pages,
            "study_payload": study_payload,
            "statistics": statistics,
            "missed": [(labels[key], count) for key, count in missed.most_common(5)],
        },
    )


@login_required
@require_POST
def study_result(request, notebook_id):
    from uuid import UUID

    notebook = get_object_or_404(Notebook, pk=notebook_id, owner=request.user)
    try:
        payload = json.loads(request.body)
        client_id = UUID(payload["id"])
        mode = payload["mode"]
        duration = int(payload["duration"])
        raw = payload["results"]
        if mode not in dict(QuizAttempt.MODES) or not 0 <= duration <= 86400 or not isinstance(raw, list) or not 1 <= len(raw) <= 150:
            raise ValueError
        _, pages = study_material(notebook)
        labels = {}
        for page in pages:
            page_id = page["id"]
            if mode == "card":
                labels.update({f"{page_id}:card:{item['id']}": f"{page['title']} · 카드 {index + 1}" for index, item in enumerate(page["cards"])})
            else:
                labels.update({f"{page_id}:blank:{item['id']}": f"{page['title']} · 형광펜 {index + 1}" for index, item in enumerate(page["blanks"])})
                labels.update({f"{page_id}:term:{index}": f"{page['title']} · {term}" for index, term in enumerate(page["terms"])})
        results = []
        for item in raw:
            key, correct = item["key"], item["correct"]
            if key not in labels or not isinstance(correct, bool):
                raise ValueError
            results.append({"key": key, "label": labels[key], "correct": correct})
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
        return JsonResponse({"ok": False, "error": "학습 결과를 저장할 수 없어요."}, status=400)
    QuizAttempt.objects.get_or_create(owner=request.user, client_id=client_id, defaults={
        "mode": mode, "notebook": notebook, "duration_seconds": duration, "results": results,
    })
    return JsonResponse({"ok": True})
