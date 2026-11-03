import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import Chapter, DrawingPreferences, InviteCode, Notebook, Page


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
                    "paper_template": "grid",
                    "recognition_reviewed": True,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.page.refresh_from_db()
        self.assertEqual(self.page.paper_template, "grid")
        self.assertEqual(self.page.quiz_terms, ["세종대왕", "훈민정음"])
        self.assertEqual(self.page.text_boxes[0]["text"], "설명")
        self.assertEqual(self.page.sticky_notes[0]["text"], "암기")
        self.assertEqual(self.page.recognition_status, "reviewed")

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
        self.assertContains(editor, "글씨 인식 확인")
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
            {"title": "과학 필기", "subject": "과학", "cover_style": "blue"},
        )
        self.assertEqual(response.status_code, 302)
        created = Notebook.objects.get(title="과학 필기")
        self.assertEqual(created.owner, self.owner)
        self.assertEqual(Page.objects.filter(chapter__notebook=created).count(), 1)


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
        self.assertRedirects(response, reverse("notes:library"))
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
