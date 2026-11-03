from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.db import transaction

from .models import InviteCode, Notebook


class InviteSignupForm(UserCreationForm):
    invite_code = forms.CharField(
        label="초대 코드",
        max_length=40,
        help_text="학교 친구에게 받은 초대 코드를 입력해 주세요.",
    )

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username",)
        labels = {"username": "아이디"}

    def clean_invite_code(self):
        raw_code = self.cleaned_data["invite_code"].strip()
        try:
            invite = InviteCode.objects.get(code__iexact=raw_code)
        except InviteCode.DoesNotExist as exc:
            raise forms.ValidationError("올바른 초대 코드가 아닙니다.") from exc
        if not invite.is_available:
            raise forms.ValidationError("사용할 수 없거나 만료된 초대 코드입니다.")
        return invite.code

    @transaction.atomic
    def save(self, commit=True):
        user = super().save(commit=False)
        if not commit:
            return user
        invite = InviteCode.objects.select_for_update().get(
            code=self.cleaned_data["invite_code"]
        )
        if not invite.is_available:
            raise forms.ValidationError("초대 코드 사용 가능 횟수가 모두 소진되었습니다.")
        user.save()
        invite.used_count += 1
        invite.save(update_fields=["used_count"])
        return user


class NotebookForm(forms.ModelForm):
    class Meta:
        model = Notebook
        fields = ("title", "subject", "cover_style", "cover_upload")
        widgets = {
            "title": forms.TextInput(attrs={"placeholder": "예: 시대의 흐름"}),
            "subject": forms.TextInput(attrs={"placeholder": "예: 한국사"}),
            "cover_upload": forms.ClearableFileInput(attrs={"accept": "image/png"}),
        }

    def clean_cover_upload(self):
        upload = self.cleaned_data.get("cover_upload")
        if upload and upload.content_type not in {"image/png", "image/x-png"}:
            raise forms.ValidationError("PNG 이미지 파일만 사용할 수 있습니다.")
        return upload
