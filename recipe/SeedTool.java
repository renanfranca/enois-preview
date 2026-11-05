import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.*;
import java.util.*;

/** Operates on a closed private copy. Exports sanitized rows into new H2 pages. */
public final class SeedTool {
    static final Set<String> DROP = Set.of("AUTH_SESSIONS", "PASSWORD_RESET_TOKENS", "EMAIL_VERIFICATION_TOKENS",
        "OAUTH_AUTHORIZATION_REQUESTS", "USER_EXTERNAL_IDENTITIES", "PENDING_SIGNUPS", "USER_TWO_FACTOR_SECRETS",
        "TWO_FACTOR_BACKUP_CODES", "TWO_FACTOR_CHALLENGES", "LINKEDIN_CONNECTIONS", "GITHUB_USER_TOKENS",
        "PUSH_SUBSCRIPTIONS", "GAME_TOKENS", "SUPPORT_SETTINGS", "PENDING_EMAIL_CHANGES", "IDEMPOTENCY_KEYS", "USER_E2E_KEYPAIRS", "CONVERSATION_E2E_KEYS", "EMAIL_DELIVERIES", "EMAIL_OUTBOX");
    static Connection open(String path) throws Exception {
        return DriverManager.getConnection("jdbc:h2:file:" + Path.of(path).toAbsolutePath() + ";MODE=MySQL;IFEXISTS=TRUE", "sa", "");
    }
    static Map<String, Set<String>> schema(Connection db) throws Exception {
        Map<String, Set<String>> result = new TreeMap<>();
        try (ResultSet rows = db.getMetaData().getColumns(null, "PUBLIC", null, null)) {
            while (rows.next()) result.computeIfAbsent(rows.getString("TABLE_NAME"), x -> new TreeSet<>()).add(rows.getString("COLUMN_NAME"));
        }
        return result;
    }
    public static void main(String[] args) throws Exception {
        try (Connection db = open(args[1])) {
            if (args[0].equals("list")) {
                try (ResultSet rs = db.createStatement().executeQuery("SELECT ID, NAME FROM USERS ORDER BY ID")) {
                    while (rs.next()) System.out.println(rs.getString(1).replaceAll("[\\t\\r\\n]", " ") + "\t" + rs.getString(2).replaceAll("[\\t\\r\\n]", " "));
                }
                return;
            }
            if (args[0].equals("metadata") && args.length == 3) {
                Map<String, Set<String>> tables = schema(db);
                for (String line : Files.readAllLines(Path.of(args[2]))) {
                    String id = line.split("\t", -1)[0];
                    if (!id.matches("[A-Za-z0-9_-]{1,100}")) throw new IllegalArgumentException("Invalid identity");
                    try (PreparedStatement user = db.prepareStatement("SELECT IS_ADMIN FROM USERS WHERE ID=?")) {
                        user.setString(1, id);
                        try (ResultSet rows = user.executeQuery()) {
                            if (!rows.next()) throw new IllegalStateException("Selected identity missing");
                            boolean admin = rows.getBoolean(1), moderator = false;
                            if (tables.containsKey("MODERATOR_APPLICATIONS")) {
                                try (PreparedStatement mod = db.prepareStatement("SELECT COUNT(*) FROM MODERATOR_APPLICATIONS WHERE USER_ID=? AND STATUS='APPROVED'")) {
                                    mod.setString(1, id);
                                    try (ResultSet found = mod.executeQuery()) { found.next(); moderator = found.getLong(1) > 0; }
                                }
                            }
                            System.out.println("permission\t" + id + "\t" + admin + "\t" + moderator);
                        }
                    }
                }
                // Reviewed renderable fields, not arbitrary integration records.
                var pattern = java.util.regex.Pattern.compile("https?://[^\\s<>\"']+");
                Set<String> references = new TreeSet<>();
                for (var table : tables.entrySet()) {
                    if (!table.getKey().matches("[A-Z0-9_]+") || DROP.contains(table.getKey())) continue;
                    for (String column : table.getValue()) {
                        if (!column.matches("[A-Z0-9_]*(AVATAR|BANNER|BADGE|IMAGE|CDN_URL|HTML|VIDEO|AUDIO|EMBED|BODY|CONTENT)[A-Z0-9_]*")) continue;
                        try (ResultSet rows = db.createStatement().executeQuery("SELECT " + column + " FROM " + table.getKey() + " WHERE " + column + " IS NOT NULL")) {
                            while (rows.next()) {
                                String value = rows.getString(1);
                                var urls = pattern.matcher(value);
                                while (urls.find()) references.add(urls.group().replace("&amp;", "&"));
                            }
                        }
                    }
                }
                for (String reference : references) System.out.println("reference\t" + Base64.getEncoder().encodeToString(reference.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                return;
            }
            if (!args[0].equals("sanitize") || args.length != 4) throw new IllegalArgumentException("Invalid seed tool action");
            Map<String, Set<String>> tables = schema(db);
            for (var table : tables.entrySet()) {
                if (!table.getKey().matches("[A-Za-z0-9_]+")) throw new IllegalStateException("Unsupported table identifier");
                if (DROP.contains(table.getKey()) || table.getKey().equals("USER_CREDENTIALS")) continue;
                for (String column : table.getValue()) {
                    if (table.getKey().equals("PARENTAL_LINKS") && column.equals("TOKEN_HASH")) continue;
                    if (table.getKey().equals("CONTENT_FINGERPRINTS") && column.equals("TOKEN_COUNT")) continue;
                    if (column.matches(".*(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|WEBHOOK|MFA|OAUTH_GRANT|CIPHER|ENCRYPTED).*"))
                        throw new IllegalStateException("Unrecognized authentication or integration column: " + table.getKey() + "." + column + "; extend the reviewed sanitizer before capture");
                }
            }
            db.setAutoCommit(false);
            try (Statement sql = db.createStatement()) {
                for (String table : DROP) if (tables.containsKey(table)) sql.executeUpdate("DELETE FROM " + table);
                if (tables.containsKey("PARENTAL_LINKS")) sql.executeUpdate("UPDATE PARENTAL_LINKS SET TOKEN_HASH=NULL");
                sql.executeUpdate("UPDATE USER_CREDENTIALS SET PASSWORD_HASH='!preview-disabled', PASSWORD_USABLE=FALSE, RESET_NEEDED=FALSE");
                // All logins are disposable, including nonselected identities. Stable IDs and roles survive.
                sql.executeUpdate("UPDATE USER_CREDENTIALS SET EMAIL=USER_ID || '@disabled.enois.invalid'");
                sql.executeUpdate("UPDATE USERS SET EMAIL=ID || '@disabled.enois.invalid'");
                for (String column : List.of("TOTP_ENABLED_AT", "EMAIL_OTP_ENABLED_AT", "FEDERATED_SECOND_FACTOR_AT"))
                    if (tables.get("USERS").contains(column)) sql.executeUpdate("UPDATE USERS SET " + column + "=NULL");
                Set<String> selected = new HashSet<>();
                for (String line : Files.readAllLines(Path.of(args[3]))) {
                    String[] account = line.split("\t", -1);
                    if (account.length != 2 || !account[0].matches("[A-Za-z0-9_-]{1,100}") || !account[1].matches("[a-z0-9._-]+@enois\\.invalid") || !selected.add(account[0]))
                        throw new IllegalArgumentException("Invalid account selection");
                    try (PreparedStatement credentials = db.prepareStatement("UPDATE USER_CREDENTIALS SET EMAIL=? WHERE USER_ID=?");
                         PreparedStatement user = db.prepareStatement("UPDATE USERS SET EMAIL=? WHERE ID=?")) {
                        for (PreparedStatement query : List.of(credentials, user)) {
                            query.setString(1, account[1]); query.setString(2, account[0]);
                            if (query.executeUpdate() != 1) throw new IllegalStateException("Selected identity missing; correct the account selection and refresh explicitly");
                        }
                    }
                }
                if (selected.isEmpty()) throw new IllegalArgumentException("No selected identities");
                db.commit();
                Path script = Files.createTempFile(Path.of(args[2]).getParent(), ".sanitized-", ".sql",
                    PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
                try {
                    sql.execute("SCRIPT TO '" + script.toString().replace("'", "''") + "'");
                    String canonical = Files.readAllLines(script).stream().filter(line -> !line.startsWith("CREATE USER ")).collect(java.util.stream.Collectors.joining("\n"));
                    String logical = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                    Files.writeString(Path.of(args[2]).getParent().resolve("logical.sha256"), logical + "\n");
                    try (Connection clean = DriverManager.getConnection("jdbc:h2:file:" + args[2] + ";MODE=MySQL", "sa", "")) {
                        clean.createStatement().execute("RUNSCRIPT FROM '" + script.toString().replace("'", "''") + "'");
                        clean.createStatement().execute("SHUTDOWN COMPACT");
                    }
                    Files.setPosixFilePermissions(Path.of(args[2] + ".mv.db"), PosixFilePermissions.fromString("rw-------"));
                } finally { Files.deleteIfExists(script); }
            } catch (Exception failure) { db.rollback(); throw failure; }
        }
    }
}
