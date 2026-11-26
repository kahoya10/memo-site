from django.db.backends.postgresql.base import DatabaseWrapper as PostgreSQLDatabaseWrapper


class DatabaseWrapper(PostgreSQLDatabaseWrapper):
    def init_connection_state(self):
        super().init_connection_state()
        with self.connection.cursor() as cursor:
            cursor.execute("SET search_path TO sapgu")
