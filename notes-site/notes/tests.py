import base64
import io
import json
from datetime import timedelta
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Chapter, DrawingPreferences, HandwritingSample, InviteCode, Notebook, NotebookView, Page, QuizAttempt, StudySession


def sample_png():
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (70, 70), "white")
    ImageDraw.Draw(image).line([(20, 10), (42, 10), (24, 58)], fill="black", width=4)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class NotesFlowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username="owner", password="safe-pass-123")
        self.other = User.objects.create_user(username="other", password="safe-pass-123")
        self.notebook = Notebook.objects.create(owner=self.owner, title="한국사", subject="역사")
        self.chapter = Chapter.objects.create(notebook=self.notebook, title="첫 챕터", position=0)
        self.page = Page.objects.create(chapter=self.chapter, title="첫 페이지", position=0)

    def test_private_notebook_is_hidden_from_other_user(self):
        self.client.force_login(self.other)
        response = self.client.get(reverse("notes:editor", args=[self.notebook.id]))
        self.assertEqual(response.status_code, 404)

    def test_owner_can_save_page_content(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("notes:page_save", args=[self.page.id]),
            data=json.dumps(
                {
                    "title": "바뀐 제목",
                    "ink_data": [{"tool": "pen", "points": [[0.1, 0.2]]}],
                    "recognized_text": "세종대왕은 훈민정음을 창제했다.",
                    "quiz_terms": ["세종대왕", "훈민정음"],
                    "text_boxes": [{"id": "text-1", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1, "text": "설명"}],
                    "sticky_notes": [{"id": "memo-1", "x": 0.5, "y": 0.2, "width": 0.2, "height": 0.15, "text": "암기", "color": "#FFF2A8"}],
                    "paper_template": "cornell",
                    "recognition_reviewed": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.page.refresh_from_db()
        self.assertEqual(self.page.paper_template, "cornell")
        self.assertEqual(self.page.quiz_terms, ["세종대왕", "훈민정음"])
        self.assertEqual(self.page.text_boxes[0]["text"], "설명")
        self.assertEqual(self.page.sticky_notes[0]["text"], "암기")
        self.assertEqual(self.page.recognition_status, "reviewed")

    @patch("notes.views.recognize_handwriting_image", return_value=[
        {"text": "국어", "bounds": [.1, .1, .2, .2], "confidence": .95},
        {"text": "훈민정음", "bounds": [.1, .3, .5, .4], "confidence": .4},
    ])
    def test_recognition_preview_is_saved_only_after_confirmation(self, recognize_mock):
        self.client.force_login(self.owner)
        self.page.recognized_text = "기존 결과"
        self.page.quiz_terms = ["기존"]
        self.page.recognition_status = "reviewed"
        self.page.save(update_fields=["recognized_text", "quiz_terms", "recognition_status"])
        response = self.client.post(
            reverse("notes:page_recognize", args=[self.page.id]),
            data=json.dumps({"image_data": "data:image/png;base64,aGFuZHdyaXRpbmc="}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        draft = response.json()
        self.assertEqual(draft["recognized_text"], "국어\n훈민정음")
        self.assertEqual(draft["blocks"][1]["bounds"], [.1, .3, .5, .4])
        recognize_mock.assert_called_once()
        save_url = reverse("notes:page_save", args=[self.page.id])
        self.assertEqual(self.client.post(save_url, {
            "title": "자동 저장", "recognized_text": "취소한 수정", "quiz_terms": ["취소"],
        }, content_type="application/json").status_code, 200)
        self.page.refresh_from_db()
        self.assertEqual(self.page.title, "자동 저장")
        self.assertEqual(self.page.recognized_text, "기존 결과")
        self.assertEqual(self.page.quiz_terms, ["기존"])
        self.assertEqual(self.page.recognition_blocks, [])

        review = {
            "recognition_reviewed": True, "recognized_text": "국어\n수정한 결과",
            "quiz_terms": ["수정"], "recognition_token": draft["recognition_token"],
        }
        other_page = Page.objects.create(chapter=self.chapter)
        other_url = reverse("notes:page_save", args=[other_page.id])
        self.assertEqual(self.client.post(other_url, review, content_type="application/json").status_code, 400)
        self.assertEqual(self.client.post(save_url, review, content_type="application/json").status_code, 200)
        self.page.refresh_from_db()
        self.assertEqual(self.page.recognized_text, "국어\n수정한 결과")
        self.assertEqual(self.page.quiz_terms, ["수정"])
        self.assertEqual(self.page.recognition_status, "reviewed")
        self.assertEqual(self.page.recognition_blocks[1]["text"], "수정한 결과")
        self.assertEqual(self.page.uncertain_ranges, [])

    @patch("notes.views.recognize_handwriting_image", return_value=[{"text": "선택", "bounds": [0, 0, 1, 1], "confidence": .9}])
    def test_recognizing_selection_preserves_page_transcript(self, recognize_mock):
        self.page.recognized_text = "기존 인식 결과"
        self.page.save(update_fields=["recognized_text"])
        self.client.force_login(self.owner)
        response = self.client.post(reverse("notes:page_recognize", args=[self.page.id]), {
            "image_data": "data:image/png;base64,aGFuZHdyaXRpbmc=", "selection": True,
        }, content_type="application/json")
        self.assertEqual(response.json()["recognized_text"], "선택")
        self.page.refresh_from_db()
        self.assertEqual(self.page.recognized_text, "기존 인식 결과")
        self.assertTrue(recognize_mock.call_args.args[-1])

    def test_handwriting_recognition_rejects_unsupported_image(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("notes:page_recognize", args=[self.page.id]),
            data=json.dumps({"image_data": "data:image/gif;base64,aGFuZHdyaXRpbmc="}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)

    def test_other_user_cannot_recognize_owner_handwriting(self):
        self.client.force_login(self.other)
        response = self.client.post(
            reverse("notes:page_recognize", args=[self.page.id]),
            data=json.dumps({"image_data": "data:image/png;base64,aGFuZHdyaXRpbmc="}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)

    def test_recognized_text_is_searchable(self):
        self.page.recognized_text = "세종대왕은 훈민정음을 창제했다."
        self.page.save(update_fields=["recognized_text"])
        self.client.force_login(self.owner)
        response = self.client.get(reverse("notes:library"), {"q": "훈민정음"})
        self.assertContains(response, self.notebook.title)

    def test_editor_and_study_pages_render(self):
        self.page.recognized_text = "세종대왕은 훈민정음을 창제했다."
        self.page.quiz_terms = ["훈민정음"]
        self.page.save(update_fields=["recognized_text", "quiz_terms"])
        self.client.force_login(self.owner)
        editor = self.client.get(reverse("notes:page_editor", args=[self.notebook.id, self.page.id]))
        study = self.client.get(reverse("notes:study", args=[self.notebook.id]))
        self.assertEqual(editor.status_code, 200)
        self.assertContains(editor, "손글씨 자동 인식")
        self.assertContains(editor, "불투명도")
        self.assertContains(editor, "page-thumbnail")
        self.assertContains(editor, "+ 챕터")
        self.assertContains(editor, 'class="chapter-toggle"')
        self.assertContains(editor, 'aria-expanded="false"')
        self.assertContains(editor, 'data-title-edit-target="notebook-title-form"')
        self.assertContains(editor, "data-title-edit-form hidden")
        self.assertContains(editor, "올가미")
        self.assertContains(editor, "메모지")
        self.assertEqual(study.status_code, 200)
        self.assertContains(study, "빈칸")

    def test_editor_creates_drawing_preferences(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("notes:page_editor", args=[self.notebook.id, self.page.id]))
        self.assertEqual(response.status_code, 200)
        preferences = DrawingPreferences.objects.get(user=self.owner)
        self.assertEqual(preferences.eraser_mode, "stroke")
        self.assertEqual(len(preferences.palettes), 4)
        self.assertTrue(any(tool.get("study_role") == "blank" for tool in preferences.tools))

    def test_user_can_save_custom_palette_and_tool_settings(self):
        self.client.force_login(self.owner)
        payload = {
            "tools": [
                {"id": "pencil", "name": "연필", "kind": "pencil", "color": "#123456", "width": 4, "opacity": 0.45, "group": "general"},
                {"id": "study-blank", "name": "빈칸", "kind": "highlighter", "color": "#FFD670", "width": 18, "opacity": 0.32, "group": "study", "study_role": "blank", "fixed_color": True},
            ],
            "palettes": [{"id": "mine", "name": "내 색", "colors": ["#123456", "#ABCDEF"]}],
            "active_palette": "mine",
            "eraser_mode": "lasso",
            "palm_rejection": "on",
        }
        response = self.client.post(
            reverse("notes:drawing_preferences_save"),
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        preferences = DrawingPreferences.objects.get(user=self.owner)
        self.assertEqual(preferences.active_palette, "mine")
        self.assertEqual(preferences.eraser_mode, "lasso")
        self.assertEqual(preferences.palm_rejection, "on")
        self.assertEqual(preferences.tools[0]["opacity"], 0.45)

    def test_chapter_added_beside_page_button_is_inserted_after_chapter(self):
        Chapter.objects.create(notebook=self.notebook, title="마지막 챕터", position=1)
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("notes:chapter_add", args=[self.notebook.id]),
            {"title": "가운데 챕터", "after_chapter_id": self.chapter.id},
        )
        self.assertEqual(response.status_code, 302)
        titles = list(self.notebook.chapters.order_by("position", "id").values_list("title", flat=True))
        self.assertEqual(titles, ["첫 챕터", "가운데 챕터", "마지막 챕터"])

    def test_owner_can_rename_notebook_and_chapter(self):
        self.client.force_login(self.owner)
        notebook_response = self.client.post(
            reverse("notes:notebook_rename", args=[self.notebook.id]),
            {"title": "새 공책 제목", "page_id": self.page.id},
        )
        chapter_response = self.client.post(
            reverse("notes:chapter_rename", args=[self.chapter.id]),
            {"title": "새 챕터 제목", "page_id": self.page.id},
        )
        self.assertEqual(notebook_response.status_code, 302)
        self.assertEqual(chapter_response.status_code, 302)
        self.notebook.refresh_from_db()
        self.chapter.refresh_from_db()
        self.assertEqual(self.notebook.title, "새 공책 제목")
        self.assertEqual(self.chapter.title, "새 챕터 제목")

    def test_other_user_cannot_save_page(self):
        self.client.force_login(self.other)
        response = self.client.post(
            reverse("notes:page_save", args=[self.page.id]),
            data=json.dumps({"ink_data": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_creating_notebook_also_creates_first_page(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("notes:notebook_create"),
            {"title": "과학 필기", "subject": "과학", "cover_style": "moon"},
        )
        self.assertEqual(response.status_code, 302)
        created = Notebook.objects.get(title="과학 필기")
        self.assertEqual(created.owner, self.owner)
        self.assertEqual(created.cover_style, "moon")
        self.assertEqual(Page.objects.filter(chapter__notebook=created).count(), 1)

    def test_page_add_uses_the_last_pages_paper(self):
        self.client.force_login(self.owner)
        last = Page.objects.create(chapter=self.chapter, position=3, paper_template="weekly")
        url = reverse("notes:page_add", args=[self.chapter.id])
        self.assertEqual(self.client.post(url).status_code, 302)
        added = self.chapter.pages.last()
        self.assertEqual(added.position, last.position + 1)
        self.assertEqual(added.paper_template, "weekly")

    def test_page_add_copies_custom_paper_without_copying_notes(self):
        self.client.force_login(self.owner)
        png = sample_png()
        self.page.paper_template = "custom"
        self.page.paper_image = png
        self.page.recognized_text = "기존 필기"
        self.page.save(update_fields=["paper_template", "paper_image", "recognized_text"])
        response = self.client.post(reverse("notes:page_add", args=[self.chapter.id]))
        added = self.chapter.pages.last()
        self.assertRedirects(response, reverse("notes:page_editor", args=[self.notebook.id, added.id]))
        self.assertEqual(added.paper_template, "custom")
        self.assertEqual(added.paper_image, png)
        self.assertEqual(added.recognized_text, "")

    def test_page_add_uses_default_paper_when_the_chapter_is_empty(self):
        self.client.force_login(self.owner)
        empty = Chapter.objects.create(notebook=self.notebook, title="빈 챕터")
        self.assertEqual(self.client.post(reverse("notes:page_add", args=[empty.id])).status_code, 302)
        first = empty.pages.get()
        self.assertEqual((first.position, first.paper_template), (0, "lined"))

    def test_cover_picker_keeps_existing_upload_and_requires_ownership(self):
        self.notebook.cover_upload = "notebook-covers/existing.png"
        self.notebook.save(update_fields=["cover_upload"])
        url = reverse("notes:notebook_cover", args=[self.notebook.id])
        self.client.force_login(self.other)
        self.assertEqual(self.client.post(url, {"cover_style": "linen"}).status_code, 404)
        self.client.force_login(self.owner)
        self.assertContains(self.client.get(url), 'class="template-sheet cover-swatch cover-linen"')
        self.assertRedirects(self.client.post(url, {"cover_style": "linen"}), reverse("notes:library"))
        self.notebook.refresh_from_db()
        self.assertEqual(self.notebook.cover_style, "linen")
        self.assertEqual(self.notebook.cover_upload.name, "notebook-covers/existing.png")

    def test_uploaded_cover_requires_the_notebook_owner(self):
        self.client.force_login(self.owner)
        png = sample_png()
        with TemporaryDirectory() as media_root, self.settings(MEDIA_ROOT=media_root):
            edit = reverse("notes:notebook_cover", args=[self.notebook.id])
            bogus = SimpleUploadedFile("not-png.png", b"plain text", "image/png")
            self.assertContains(self.client.post(edit, {"cover_style": "blue", "cover_upload": bogus}), "PNG 이미지를 올려")
            upload = SimpleUploadedFile("cover.png", png, "image/png")
            self.assertRedirects(self.client.post(edit, {"cover_style": "blue", "cover_upload": upload}), reverse("notes:library"))
            self.notebook.refresh_from_db()
            url = self.notebook.cover_upload.url
            image = self.client.get(url)
            self.assertEqual(image.headers["Content-Type"], "image/png")
            self.assertEqual(b"".join(image.streaming_content), png)
            self.assertIn("no-store", image.headers["Cache-Control"])
            self.client.force_login(self.other)
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_custom_paper_is_private_and_available_when_switching_templates(self):
        url = reverse("notes:page_paper", args=[self.page.id])
        self.client.force_login(self.owner)
        png = sample_png()
        self.assertEqual(self.client.post(url, {"paper_image": SimpleUploadedFile("test.png", png, "image/png")}).status_code, 302)
        self.assertEqual(self.client.get(url).content, png)
        self.page.refresh_from_db()
        self.assertEqual(self.page.paper_template, "custom")
        editor = self.client.get(reverse("notes:page_editor", args=[self.notebook.id, self.page.id]))
        self.assertContains(editor, 'value="custom"')
        save = reverse("notes:page_save", args=[self.page.id])
        self.client.post(save, {"paper_template": "lined"}, content_type="application/json")
        self.assertEqual(self.client.get(url).content, png)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_individual_page_and_chapter_deletion_is_owner_only(self):
        extra = Chapter.objects.create(notebook=self.notebook, title="추가")
        Page.objects.create(chapter=extra, title="남은 페이지")
        page_url = reverse("notes:page_delete", args=[self.page.id])
        chapter_url = reverse("notes:chapter_delete", args=[self.chapter.id])
        self.client.force_login(self.other)
        self.assertEqual(self.client.post(page_url).status_code, 404)
        self.assertEqual(self.client.post(chapter_url).status_code, 404)
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(page_url).status_code, 405)
        self.assertEqual(self.client.post(page_url).status_code, 302)
        self.assertEqual(self.client.post(chapter_url).status_code, 302)
        self.assertFalse(Page.objects.filter(pk=self.page.id).exists())
        self.assertTrue(Page.objects.filter(chapter=extra).exists())

    def test_search_matches_text_boxes_and_sticky_notes(self):
        self.page.text_boxes = [{"text": "삼각형의 합동"}]
        self.page.sticky_notes = [{"text": "수직이등분선"}]
        self.page.save(update_fields=["text_boxes", "sticky_notes"])
        self.client.force_login(self.owner)
        for query in ("합동", "수직이등분선"):
            self.assertContains(self.client.get(reverse("notes:library"), {"q": query}), self.notebook.title)

    def test_study_works_with_ink_markings_without_recognized_text_and_records_score_once(self):
        self.page.ink_data = [
            {"id": "blank-1", "tool": "highlighter", "study_role": "blank", "points": [[.2, .2], [.5, .2]]},
            {"id": "card-1", "tool": "pen", "study_role": "card", "points": [[.1, .3], [.4, .3]]},
        ]
        self.page.save(update_fields=["ink_data"])
        self.client.force_login(self.owner)
        study = reverse("notes:study", args=[self.notebook.id])
        payload = self.client.get(study).context["study_payload"][0]
        self.assertEqual(payload["blanks"][0]["id"], "blank-1")
        self.assertEqual(payload["cards"][0]["id"], "card-1")
        url = reverse("notes:study_result", args=[self.notebook.id])
        result = {"id": str(uuid4()), "mode": "speed", "duration": 45, "results": [{"key": f"{self.page.id}:blank:blank-1", "correct": False}]}
        for _ in range(2):
            self.assertEqual(self.client.post(url, result, content_type="application/json").status_code, 200)
        self.assertEqual(QuizAttempt.objects.count(), 1)
        self.assertContains(self.client.get(study), "자주 틀린 문제")

    def test_saved_organization_preserves_original_order(self):
        other_page = Page.objects.create(chapter=self.chapter, title="두 번째", position=1)
        self.client.force_login(self.owner)
        url = reverse("notes:organize_save", args=[self.notebook.id])
        payload = {"kind": "reorder", "unit": "page", "name": "시간순 보기", "items": [
            {"id": "a", "page": other_page.id}, {"id": "b", "page": self.page.id},
        ]}
        result = self.client.post(url, payload, content_type="application/json").json()
        self.assertTrue(result["ok"])
        self.assertContains(self.client.get(result["url"]), "시간순 보기")
        self.assertEqual([item["page"] for item in NotebookView.objects.get().items], [other_page.id, self.page.id])
        self.assertEqual(list(self.chapter.pages.values_list("id", flat=True)), [self.page.id, other_page.id])
        payload.update(kind="map", name="관계도", items=[{"id": "a", "page": self.page.id, "x": 30, "y": 40, "parent": None}])
        self.assertTrue(self.client.post(url, payload, content_type="application/json").json()["ok"])
        self.assertEqual(NotebookView.objects.get(kind="map").items[0]["x"], 30)

    def test_handwriting_samples_store_features_scoped_to_account_and_can_reset(self):
        from PIL import Image
        from .handwriting import best_sample

        self.client.force_login(self.owner)
        url = reverse("notes:handwriting_settings")
        image = sample_png()
        encoded = base64.b64encode(image).decode()
        response = self.client.post(url, {"glyph": "7", "image_data": f"data:image/png;base64,{encoded}"})
        self.assertEqual(response.status_code, 200)
        sample = HandwritingSample.objects.get(owner=self.owner)
        self.assertEqual(len(sample.signature), 400)
        self.assertEqual(best_sample(Image.open(io.BytesIO(image)), [("7", sample.signature)]), "7")
        self.client.force_login(self.other)
        self.client.post(url, {"action": "reset"})
        self.assertEqual(HandwritingSample.objects.count(), 1)
        self.client.force_login(self.owner)
        self.client.post(url, {"action": "reset"})
        self.assertFalse(HandwritingSample.objects.exists())


class InviteSignupTests(TestCase):
    def test_signup_uses_valid_invite(self):
        invite = InviteCode.objects.create(code="FRIEND-01", max_uses=1)
        response = self.client.post(
            reverse("signup"),
            {
                "username": "newfriend",
                "password1": "a-safe-test-pass-391",
                "password2": "a-safe-test-pass-391",
                "invite_code": "FRIEND-01",
            },
        )
        self.assertRedirects(response, reverse("notes:dashboard"))
        invite.refresh_from_db()
        self.assertEqual(invite.used_count, 1)

    def test_signup_rejects_unknown_invite(self):
        response = self.client.post(
            reverse("signup"),
            {
                "username": "uninvited",
                "password1": "a-safe-test-pass-391",
                "password2": "a-safe-test-pass-391",
                "invite_code": "NOPE",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "올바른 초대 코드가 아닙니다")


class StudySessionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username="timer-owner", password="safe-pass-123")
        self.other = User.objects.create_user(username="timer-other", password="safe-pass-123")

    def session_payload(self, client_id="session-1"):
        ended_at = timezone.now() - timedelta(seconds=2)
        started_at = ended_at - timedelta(minutes=12, seconds=31)
        return {
            "client_id": client_id,
            "subject": "math",
            "mode": "normal",
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
            "duration_seconds": 751,
        }

    def test_timer_and_planner_require_login(self):
        timer = self.client.get(reverse("notes:timer"))
        planner = self.client.get(reverse("notes:planner"))
        self.assertEqual(timer.status_code, 302)
        self.assertEqual(planner.status_code, 302)
        self.assertTrue(timer.url.startswith(reverse("notes:dashboard")))
        self.assertTrue(planner.url.startswith(reverse("notes:dashboard")))

    def test_logged_in_pages_receive_shared_api_url(self):
        self.client.force_login(self.owner)
        timer = self.client.get(reverse("notes:timer"))
        planner = self.client.get(reverse("notes:planner"))
        self.assertContains(timer, reverse("notes:study_sessions_api"))
        self.assertContains(planner, reverse("notes:study_sessions_api"))
        self.assertNotContains(timer, 'data-csrf-token=""')
        self.assertNotContains(timer, "NOTPROVIDED")
        self.assertContains(timer, "과목 선택")
        self.assertContains(planner, "스터디 플래너")
        self.assertContains(planner, f'data-user-id="{self.owner.pk}"')
        self.assertIn("no-store", planner.headers["Cache-Control"])

    def test_timer_session_is_saved_for_logged_in_user(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("notes:study_sessions_api"),
            data=json.dumps(self.session_payload()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        session = StudySession.objects.get(owner=self.owner)
        self.assertEqual(session.subject, "math")
        self.assertEqual(session.duration_seconds, 751)

    def test_duplicate_client_id_does_not_duplicate_session(self):
        self.client.force_login(self.owner)
        payload = self.session_payload()
        for _ in range(2):
            self.client.post(reverse("notes:study_sessions_api"), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(StudySession.objects.filter(owner=self.owner).count(), 1)

    def test_user_only_reads_own_sessions(self):
        ended_at = timezone.now() - timedelta(seconds=1)
        StudySession.objects.create(
            owner=self.other,
            client_id="other-session",
            subject="korean",
            mode="normal",
            started_at=ended_at - timedelta(minutes=5),
            ended_at=ended_at,
            duration_seconds=300,
        )
        self.client.force_login(self.owner)
        response = self.client.get(reverse("notes:study_sessions_api"))
        self.assertEqual(response.json()["sessions"], [])

    def test_under_thirty_seconds_rounds_to_no_record(self):
        self.client.force_login(self.owner)
        payload = self.session_payload("short-session")
        payload["duration_seconds"] = 29
        payload["ended_at"] = (timezone.now() - timedelta(seconds=1)).isoformat()
        payload["started_at"] = (timezone.now() - timedelta(seconds=31)).isoformat()
        response = self.client.post(reverse("notes:study_sessions_api"), data=json.dumps(payload), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["recorded"])
        self.assertFalse(StudySession.objects.filter(owner=self.owner).exists())


class MainAuthenticationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="main-user", password="safe-pass-123")

    def test_anonymous_main_page_contains_login_form(self):
        response = self.client.get(reverse("notes:dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "서당에 들어가기")
        self.assertContains(response, "초대 코드로 회원가입")
        self.assertNotContains(response, "나의 필기")

    def test_login_happens_on_main_page(self):
        response = self.client.post(
            reverse("notes:dashboard"),
            {"username": "main-user", "password": "safe-pass-123"},
        )
        self.assertRedirects(response, reverse("notes:dashboard"))
        dashboard = self.client.get(reverse("notes:dashboard"))
        self.assertContains(dashboard, "나의 필기")
        self.assertNotContains(dashboard, "미리 알림")
        self.assertContains(dashboard, "main-user 님")
        self.assertContains(dashboard, reverse("notes:library"))
        self.assertContains(dashboard, 'data-notebook-count="0"')

    def test_login_returns_to_requested_feature(self):
        response = self.client.post(
            reverse("notes:dashboard"),
            {"username": "main-user", "password": "safe-pass-123", "next": reverse("notes:timer")},
        )
        self.assertRedirects(response, reverse("notes:timer"))
