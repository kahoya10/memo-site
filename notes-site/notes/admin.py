from django.contrib import admin

from .models import Chapter, DrawingPreferences, InviteCode, Notebook, Page, StudySession


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "is_active", "used_count", "max_uses", "expires_at")
    list_filter = ("is_active",)
    search_fields = ("code",)


class ChapterInline(admin.TabularInline):
    model = Chapter
    extra = 0


@admin.register(Notebook)
class NotebookAdmin(admin.ModelAdmin):
    list_display = ("title", "subject", "owner", "updated_at")
    list_filter = ("subject", "cover_style")
    search_fields = ("title", "subject", "owner__username")
    inlines = (ChapterInline,)


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ("title", "notebook", "position")
    list_filter = ("notebook__subject",)


@admin.register(Page)
class PageAdmin(admin.ModelAdmin):
    list_display = ("title", "chapter", "position", "recognition_status", "updated_at")
    list_filter = ("paper_template", "recognition_status")
    search_fields = ("title", "recognized_text", "chapter__notebook__title")


@admin.register(DrawingPreferences)
class DrawingPreferencesAdmin(admin.ModelAdmin):
    list_display = ("user", "active_palette", "eraser_mode", "palm_rejection", "updated_at")


@admin.register(StudySession)
class StudySessionAdmin(admin.ModelAdmin):
    list_display = ("owner", "subject", "mode", "started_at", "ended_at", "duration_seconds")
    list_filter = ("subject", "mode")
    search_fields = ("owner__username",)
    readonly_fields = ("owner", "client_id", "subject", "mode", "started_at", "ended_at", "duration_seconds", "created_at")

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
