from django.urls import path

from . import views


app_name = "notes"

urlpatterns = [
    path("", views.library, name="library"),
    path("notebooks/create/", views.notebook_create, name="notebook_create"),
    path("notebooks/<int:notebook_id>/delete/", views.notebook_delete, name="notebook_delete"),
    path("notebooks/<int:notebook_id>/rename/", views.notebook_rename, name="notebook_rename"),
    path("notebooks/<int:notebook_id>/", views.editor, name="editor"),
    path("notebooks/<int:notebook_id>/pages/<int:page_id>/", views.editor, name="page_editor"),
    path("notebooks/<int:notebook_id>/chapters/add/", views.chapter_add, name="chapter_add"),
    path("chapters/<int:chapter_id>/rename/", views.chapter_rename, name="chapter_rename"),
    path("chapters/<int:chapter_id>/pages/add/", views.page_add, name="page_add"),
    path("pages/<int:page_id>/save/", views.page_save, name="page_save"),
    path("drawing-preferences/save/", views.drawing_preferences_save, name="drawing_preferences_save"),
    path("notebooks/<int:notebook_id>/study/", views.study, name="study"),
]
