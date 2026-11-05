import java.nio.file.*;
import java.sql.*;
import org.flywaydb.core.Flyway;

/** Reproduce schema from the pinned application, then insert only fictional rows. */
public final class ExampleSeed {
    public static void main(String[] args) throws Exception {
        String url = "jdbc:h2:file:" + Path.of(args[0]).toAbsolutePath() + ";MODE=MySQL;DATABASE_TO_LOWER=FALSE";
        Flyway.configure().dataSource(url, "sa", "").locations("filesystem:" + args[1]).load().migrate();
        try (Connection db = DriverManager.getConnection(url, "sa", ""); Statement sql = db.createStatement()) {
            sql.execute("RUNSCRIPT FROM '" + Path.of(args[2]).toAbsolutePath().toString().replace("'", "''") + "'");
            sql.execute("SHUTDOWN COMPACT");
        }
    }
}
