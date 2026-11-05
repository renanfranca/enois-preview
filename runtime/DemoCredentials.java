import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.sql.*;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Rotates only the disposable H2 copy, before Spring opens it. Never prints credentials. */
public final class DemoCredentials {
    public static void main(String[] args) throws Exception {
        if (Files.exists(Path.of("/opt/render-demo/seed/accounts.tsv"))) { rotateSelected(); return; }
        String originalEmail = Files.readString(Path.of("/opt/render-demo/seed/account.txt")).strip();
        String login = "demo@enois.invalid";
        SecureRandom random = new SecureRandom();
        byte[] secret = new byte[24]; random.nextBytes(secret);
        byte[] salt = new byte[16]; random.nextBytes(salt);
        String password = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        byte[] hash = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(new PBEKeySpec(password.toCharArray(), salt, 120000, 256)).getEncoded();
        String encoded = "120000:" + Base64.getEncoder().encodeToString(salt) + ":" + Base64.getEncoder().encodeToString(hash);
        try (Connection db = DriverManager.getConnection("jdbc:h2:file:/tmp/rede-db/rede;MODE=MySQL", "sa", "")) {
            db.setAutoCommit(false);
            try (PreparedStatement credentials = db.prepareStatement("UPDATE USER_CREDENTIALS SET EMAIL=?, PASSWORD_HASH=?, PASSWORD_USABLE=TRUE, RESET_NEEDED=FALSE WHERE EMAIL=?");
                 PreparedStatement user = db.prepareStatement("UPDATE USERS SET EMAIL=? WHERE EMAIL=?")) {
                credentials.setString(1, login); credentials.setString(2, encoded); credentials.setString(3, originalEmail);
                if (credentials.executeUpdate() != 1) throw new IllegalStateException("Shared demo account not found uniquely");
                user.setString(1, login); user.setString(2, originalEmail);
                if (user.executeUpdate() != 1) throw new IllegalStateException("Demo user not found uniquely");
                db.commit();
            } catch (Exception failure) { db.rollback(); throw failure; }
        }
        Path file = Path.of("/tmp/demo-credentials.json");
        Files.deleteIfExists(file);
        Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        Files.writeString(file, "{\"email\":\"" + login + "\",\"password\":\"" + password + "\"}\n");
    }

    static String escape(String value) {
        StringBuilder out = new StringBuilder();
        for (char c : value.toCharArray()) {
            if (c == '\"' || c == '\\') out.append('\\').append(c);
            else if (c < 32) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.toString();
    }
    static void rotateSelected() throws Exception {
        SecureRandom random = new SecureRandom();
        java.util.List<String> accounts = new java.util.ArrayList<>();
        try (Connection db = DriverManager.getConnection("jdbc:h2:file:/tmp/rede-db/rede;MODE=MySQL", "sa", "")) {
            db.setAutoCommit(false);
            try {
                for (String line : Files.readAllLines(Path.of("/opt/render-demo/seed/accounts.tsv"))) {
                    String[] fields = line.split("\\t", -1);
                    if (fields.length != 3) throw new IllegalStateException("Invalid demo account mapping");
                    String id = fields[0], login = fields[1];
                    String label = new String(Base64.getDecoder().decode(fields[2]), java.nio.charset.StandardCharsets.UTF_8);
                    byte[] secret = new byte[24], salt = new byte[16]; random.nextBytes(secret); random.nextBytes(salt);
                    String password = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
                    byte[] hash = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(password.toCharArray(), salt, 120000, 256)).getEncoded();
                    String encoded = "120000:" + Base64.getEncoder().encodeToString(salt) + ":" + Base64.getEncoder().encodeToString(hash);
                    try (PreparedStatement query = db.prepareStatement("UPDATE USER_CREDENTIALS SET PASSWORD_HASH=?, PASSWORD_USABLE=TRUE, RESET_NEEDED=FALSE WHERE USER_ID=? AND EMAIL=?")) {
                        query.setString(1, encoded); query.setString(2, id); query.setString(3, login);
                        if (query.executeUpdate() != 1) throw new IllegalStateException("Selected demo identity missing");
                    }
                    accounts.add("{\"id\":\"" + escape(id) + "\",\"email\":\"" + escape(login) + "\",\"label\":\"" + escape(label) + "\",\"password\":\"" + password + "\"}");
                }
                if (accounts.isEmpty()) throw new IllegalStateException("No selected demo identities");
                db.commit();
            } catch (Exception failure) { db.rollback(); throw failure; }
        }
        Path file = Path.of("/tmp/demo-credentials.json");
        Files.deleteIfExists(file);
        Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        Files.writeString(file, "{\"accounts\":[" + String.join(",", accounts) + "]}\n");
    }
}
