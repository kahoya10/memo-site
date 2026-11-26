from django.core.management import BaseCommand, CommandError, call_command
from django.db import DatabaseError, connections


class Command(BaseCommand):
    help = "Prepare the private sapgu schema and apply the Django migrations."

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Verify connectivity without writing to the database.")

    def handle(self, *args, **options):
        database = connections["default"]
        if database.settings_dict["ENGINE"] != "config.postgres":
            raise CommandError("Set DJANGO_DATABASE_URL to the project's PostgreSQL connection URL first.")

        try:
            with database.cursor() as cursor:
                cursor.execute("SELECT 1")
                if options["check"]:
                    self.stdout.write(self.style.SUCCESS("PostgreSQL connection verified."))
                    return
                cursor.execute("CREATE SCHEMA IF NOT EXISTS sapgu")
                cursor.execute(
                    """
                    SELECT rolname FROM pg_roles
                    WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
                      AND has_schema_privilege(oid, 'sapgu', 'USAGE')
                    """
                )
                if cursor.fetchone():
                    raise CommandError("The sapgu schema must be private to the Django database role.")
        except DatabaseError:
            raise CommandError(
                "Could not connect to PostgreSQL or prepare the schema. Check the connection URL and database permissions."
            ) from None

        call_command("migrate", database="default", interactive=False, verbosity=options["verbosity"])
        self.stdout.write(self.style.SUCCESS("The sapgu database schema is ready."))
