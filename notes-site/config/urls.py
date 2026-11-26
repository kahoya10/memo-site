from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.http import HttpResponseRedirect
from django.templatetags.static import static
from django.urls import include, path

from notes.views import health, notebook_cover_image, signup


def favicon(request):
    return HttpResponseRedirect(static("shell/avatars/dogs/sapsal.webp"))


urlpatterns = [
    path("admin/", admin.site.urls),
    path(
        "accounts/login/",
        auth_views.LoginView.as_view(template_name="registration/main_login.html"),
        name="login",
    ),
    path(
        "accounts/logout/",
        auth_views.LogoutView.as_view(),
        name="logout",
    ),
    path("accounts/signup/", signup, name="signup"),
    path("favicon.ico", favicon),
    path("healthz/", health, name="health"),
    path("media/<path:name>", notebook_cover_image, name="notebook_cover_image"),
    path("", include("notes.urls")),
]
