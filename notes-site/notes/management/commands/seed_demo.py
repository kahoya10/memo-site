from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from notes.models import Chapter, InviteCode, Notebook, Page


class Command(BaseCommand):
    help = "로컬 확인용 초대 코드와 예시 공책을 만듭니다."

    @transaction.atomic
    def handle(self, *args, **options):
        User = get_user_model()
        user, created = User.objects.get_or_create(username="demo")
        if created:
            user.set_password("sapgu-demo")
            user.save(update_fields=["password"])

        InviteCode.objects.get_or_create(
            code="SAPGU-START",
            defaults={"max_uses": 30, "is_active": True},
        )

        if not user.notebooks.exists():
            notebook = Notebook.objects.create(
                owner=user,
                title="한국사 핵심 정리",
                subject="한국사",
                cover_style="hanji",
            )
            chapter = Chapter.objects.create(notebook=notebook, title="조선 전기", position=0)
            Page.objects.create(
                chapter=chapter,
                title="세종과 훈민정음",
                position=0,
                recognized_text="세종대왕은 백성이 쉽게 글을 익히도록 훈민정음을 창제하였다.",
                quiz_terms=["세종대왕", "훈민정음"],
                recognition_status="reviewed",
            )

        self.stdout.write(self.style.SUCCESS("예시 준비 완료: demo / sapgu-demo, 초대 코드 SAPGU-START"))
