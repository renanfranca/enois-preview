package com.socialcoisa.rede.media.application;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import com.socialcoisa.rede.shared.web.ApiException;

/** Demo-only strict boundary: malformed media and failed tools never reach storage. */
@Component
@Primary
@Profile("demo")
public final class StrictMediaSanitizer extends MediaMetadataSanitizer {
    public StrictMediaSanitizer() { super("ffmpeg"); javax.imageio.ImageIO.setUseCache(false); }
    static final Map<String,String> EXTENSIONS = Map.ofEntries(
        Map.entry("image/jpeg","jpg"), Map.entry("image/png","png"), Map.entry("image/gif","gif"),
        Map.entry("image/webp","webp"), Map.entry("image/avif","avif"), Map.entry("video/mp4","mp4"),
        Map.entry("video/quicktime","mov"), Map.entry("video/webm","webm"), Map.entry("audio/mpeg","mp3"),
        Map.entry("audio/ogg","ogg"), Map.entry("audio/wav","wav"), Map.entry("audio/webm","webm"));
    @Override public byte[] sanitize(byte[] raw, String mime, String key) {
        if (raw == null || raw.length == 0 || raw.length > 20 * 1024 * 1024) throw invalid();
        Path input = null, output = null;
        try {
            if (mime.equals("application/pdf")) {
                if (raw.length < 5 || !new String(raw, 0, 5, java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-")) throw invalid();
                try (var pdf = org.apache.pdfbox.Loader.loadPDF(raw)) {
                    if (pdf.isEncrypted()) throw invalid();
                    pdf.setDocumentInformation(new org.apache.pdfbox.pdmodel.PDDocumentInformation());
                    pdf.getDocumentCatalog().setMetadata(null);
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream(); pdf.save(bytes); return bytes.toByteArray();
                }
            }
            String extension = EXTENSIONS.get(mime);
            if (extension == null || !signature(raw, mime)) throw invalid();
            input = temporary("demo-media-", "." + extension);
            output = temporary("demo-clean-", "." + extension);
            Files.write(input, raw);
            String types = streamTypes(input);
            if (mime.startsWith("audio/") && (!types.contains("audio") || types.contains("video"))) throw invalid();
            if ((mime.startsWith("video/") || mime.startsWith("image/")) && !types.contains("video")) throw invalid();
            // Full decode detects malformed bodies. No original-byte fallback is permitted.
            execute(List.of("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-i", input.toString(), "-f", "null", "-"));
            if (mime.startsWith("image/") && !mime.equals("image/avif")) {
                byte[] clean = super.sanitize(raw, mime, key);
                if (clean == raw) throw invalid();
                return clean;
            }
            List<String> command = new ArrayList<>(List.of("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-y", "-i", input.toString(), "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy", output.toString()));
            execute(command);
            if (Files.size(output) <= 0 || Files.size(output) > 20L * 1024 * 1024) throw invalid();
            return Files.readAllBytes(output);
        } catch (Exception failure) { throw invalid(); }
        finally { for (Path path : new Path[]{input, output}) if (path != null) try { Files.deleteIfExists(path); } catch (IOException failure) { throw new IllegalStateException("Media processing cleanup failed", failure); } }
    }
    static boolean signature(byte[] raw, String mime) {
        if (raw.length < 12) return false;
        String first = new String(raw, 0, 12, java.nio.charset.StandardCharsets.ISO_8859_1);
        return switch (mime) {
            case "image/jpeg" -> (raw[0] & 255) == 255 && (raw[1] & 255) == 216 && (raw[2] & 255) == 255;
            case "image/png" -> Arrays.equals(Arrays.copyOf(raw,8), new byte[]{(byte)137,80,78,71,13,10,26,10});
            case "image/gif" -> first.startsWith("GIF87a") || first.startsWith("GIF89a");
            case "image/webp" -> first.startsWith("RIFF") && first.endsWith("WEBP");
            case "audio/wav" -> first.startsWith("RIFF") && first.endsWith("WAVE");
            case "audio/ogg" -> first.startsWith("OggS");
            case "audio/mpeg" -> first.startsWith("ID3") || ((raw[0] & 255) == 255 && (raw[1] & 224) == 224);
            case "video/webm", "audio/webm" -> (raw[0] & 255) == 26 && (raw[1] & 255) == 69 && (raw[2] & 255) == 223 && (raw[3] & 255) == 163;
            case "image/avif" -> first.contains("ftypavif") || first.contains("ftypavis");
            case "video/quicktime" -> first.substring(4,8).equals("ftyp") && first.substring(8,12).equals("qt  ");
            case "video/mp4" -> first.substring(4,8).equals("ftyp") && Set.of("isom","iso2","mp41","mp42","av01","dash","M4V ").contains(first.substring(8,12));
            default -> false;
        };
    }
    static Path temporary(String prefix, String suffix) throws IOException {
        Path root = Path.of("/tmp/demo-uploads/.processing");
        Files.createDirectories(root);
        Files.setPosixFilePermissions(root, java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        return Files.createTempFile(root, prefix, suffix);
    }
    static String streamTypes(Path input) throws Exception {
        Path output = temporary("demo-probe-", ".txt");
        try {
            Process process = new ProcessBuilder("ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", input.toString())
                .redirectOutput(output.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            try { if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0 || Files.size(output) > 65536) throw invalid(); }
            finally { if (process.isAlive()) { process.destroyForcibly(); process.waitFor(); } }
            return Files.readString(output);
        } finally { Files.deleteIfExists(output); }
    }
    static void execute(List<String> command) throws Exception {
        command = new ArrayList<>(command);
        command.addAll(1, List.of("-protocol_whitelist", "file,pipe"));
        Process process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try { if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) throw invalid(); }
        finally { if (process.isAlive()) { process.destroyForcibly(); process.waitFor(); } }
    }
    static ApiException invalid() { return new ApiException(422,"MEDIA_SANITIZATION_FAILED","Arquivo invalido ou falha na limpeza de metadados."); }
}
