from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.core.management import BaseCommand, CommandError, call_command
from django.db import DatabaseError, connection
from django.db.migrations.executor import MigrationExecutor

from notes.models import InviteCode


class Command(BaseCommand):
    help = "Check the public deployment settings and database without changing app records."

    def handle(self, *args, **options):
        if settings.DEBUG:
            raise CommandError("Set DJANGO_DEBUG=0 for the public site.")
        if "*" in settings.ALLOWED_HOSTS or not set(settings.ALLOWED_HOSTS) - {"localhost", "127.0.0.1", "[::1]"}:
            raise CommandError("Set DJANGO_ALLOWED_HOSTS to the public site hostname.")
        if connection.vendor != "postgresql":
            raise CommandError("Configure the Supabase PostgreSQL connection before starting the public site.")
        if not (settings.STATIC_ROOT / "staticfiles.json").is_file():
            raise CommandError("Run collectstatic before starting the public site.")

        call_command("check", deploy=True, fail_level="ERROR", verbosity=0)
        try:
            executor = MigrationExecutor(connection)
            if executor.migration_plan(executor.loader.graph.leaf_nodes()):
                raise CommandError("Run prepare_supabase before starting the public site.")

            users = get_user_model().objects.filter(is_active=True)
            problems = []
            if any(check_password("sapgu-demo", user.password) for user in users.filter(username="demo")):
                problems.append("Change the demo account's published password.")
            if any(invite.is_available for invite in InviteCode.objects.filter(code__iexact="SAPGU-START")):
                problems.append("Deactivate the published demo invite code.")
            if not users.filter(is_staff=True).exists():
                problems.append("Create an administrator account for managing invites.")
        except DatabaseError:
            raise CommandError("Could not verify the Supabase database. Check its connection and schema.") from None

        if problems:
            raise CommandError("\n".join(problems))
        self.stdout.write(self.style.SUCCESS("Public deployment checks passed."))
