from django.urls import path

from . import views


app_name = "notes"

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("notes/", views.library, name="library"),
    path("timer/", views.timer, name="timer"),
    path("planner/", views.planner, name="planner"),
    path("api/study-sessions/", views.study_sessions_api, name="study_sessions_api"),
    path("notebooks/create/", views.notebook_create, name="notebook_create"),
    path("notebooks/<int:notebook_id>/cover/", views.notebook_cover, name="notebook_cover"),
    path("notebooks/<int:notebook_id>/delete/", views.notebook_delete, name="notebook_delete"),
    path("notebooks/<int:notebook_id>/rename/", views.notebook_rename, name="notebook_rename"),
    path("notebooks/<int:notebook_id>/", views.editor, name="editor"),
    path("notebooks/<int:notebook_id>/pages/<int:page_id>/", views.editor, name="page_editor"),
    path("notebooks/<int:notebook_id>/chapters/add/", views.chapter_add, name="chapter_add"),
    path("chapters/<int:chapter_id>/rename/", views.chapter_rename, name="chapter_rename"),
    path("chapters/<int:chapter_id>/delete/", views.chapter_delete, name="chapter_delete"),
    path("chapters/<int:chapter_id>/pages/add/", views.page_add, name="page_add"),
    path("pages/<int:page_id>/save/", views.page_save, name="page_save"),
    path("pages/<int:page_id>/delete/", views.page_delete, name="page_delete"),
    path("pages/<int:page_id>/paper/", views.page_paper, name="page_paper"),
    path("pages/<int:page_id>/recognize/", views.page_recognize, name="page_recognize"),
    path("drawing-preferences/save/", views.drawing_preferences_save, name="drawing_preferences_save"),
    path("handwriting/", views.handwriting_settings, name="handwriting_settings"),
    path("notebooks/<int:notebook_id>/study/", views.study, name="study"),
    path("notebooks/<int:notebook_id>/study/result/", views.study_result, name="study_result"),
    path("notebooks/<int:notebook_id>/organize/", views.organize, name="organize"),
    path("notebooks/<int:notebook_id>/organize/save/", views.organize_save, name="organize_save"),
]
