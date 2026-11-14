package com.socialcoisa.rede.media.adapters.out.storage;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import com.socialcoisa.rede.media.application.port.out.MediaObjectStore;
import com.socialcoisa.rede.media.application.port.out.MediaStorageGateway;
import com.socialcoisa.rede.media.domain.MediaAsset;
import com.socialcoisa.rede.shared.web.ApiException;

/** One store per boot. One per file limit (the Cloudflare Free plan request body ceiling); the Codespace disk is the only capacity limit. */
public final class DemoLocalStore implements MediaObjectStore, MediaStorageGateway {
    public static final long FILE_LIMIT = 100_000_000L;
    private final Path root;
    private final Set<String> writing = new HashSet<>();
    private final Map<String, Long> sizes = new HashMap<>();
    private final Map<String, Path> seeds = new HashMap<>();
    public DemoLocalStore(Path root) throws IOException {
        this.root = root.toAbsolutePath().normalize();
        Files.createDirectories(this.root);
        Path mappings = Path.of("/opt/render-demo/media-mappings.tsv");
        if (Files.exists(mappings)) for (String line : Files.readAllLines(mappings)) {
            String[] parts = line.split("\\t", -1);
            if (parts.length != 2 || parts[1].contains("..") || parts[1].startsWith("/")) throw new IOException("Invalid seed media mapping");
            seeds.put(parts[0], Path.of("/tmp/demo-media").resolve(parts[1]));
        }
        // The boot script creates a new namespace and directory. Refuse stale bytes.
        try (var entries = Files.list(this.root)) {
            if (entries.findAny().isPresent()) throw new IOException("Disposable store must start empty");
        }
    }
    private Path path(String key) {
        if (!key.matches("uploads/[a-f0-9-]+/media_[A-Za-z0-9_-]+/[A-Za-z0-9._-]+") || key.contains(".."))
            throw new ApiException(400, "MEDIA_INVALID_KEY", "Chave de midia invalida.");
        Path result = root.resolve(key).normalize();
        if (!result.startsWith(root)) throw new ApiException(400, "MEDIA_INVALID_KEY", "Chave de midia invalida.");
        return result;
    }
    /** Concurrent uploads write separate temporary files outside the lock; only a complete file is moved into place. */
    @Override public void write(String key, String mime, long length, InputStream body) {
        Path destination = path(key);
        if (length <= 0 || length > FILE_LIMIT) throw new ApiException(413, "MEDIA_TOO_LARGE", "Limite de 100 MB por arquivo.");
        synchronized (this) {
            if (sizes.containsKey(key) || !writing.add(key)) throw new ApiException(409, "MEDIA_ALREADY_STORED", "Esta midia ja foi enviada.");
        }
        Path temporary = null;
        try {
            Files.createDirectories(destination.getParent());
            temporary = Files.createTempFile(root, ".upload-", ".partial");
            try (OutputStream out = Files.newOutputStream(temporary)) {
                long count = 0; byte[] buffer = new byte[65536]; int read;
                while ((read = body.read(buffer)) != -1) {
                    count += read;
                    if (count > length) throw new IOException("Body length mismatch");
                    out.write(buffer, 0, read);
                }
                if (count != length) throw new IOException("Body length mismatch");
            }
            Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE);
            synchronized (this) { sizes.put(key, length); }
        } catch (IOException failure) { throw new ApiException(400, "MEDIA_UPLOAD_FAILED", "Nao foi possivel guardar o envio."); }
        finally {
            synchronized (this) { writing.remove(key); }
            if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException failure) { throw new IllegalStateException("Partial upload cleanup failed", failure); }
        }
    }
    @Override public synchronized StoredObject read(String key, String range) {
        Path file = path(key);
        if (!sizes.containsKey(key)) throw new ApiException(404, "MEDIA_NOT_FOUND", "Midia nao encontrada.");
        try {
            long length = Files.size(file), start = 0, end = length - 1;
            if (range != null) {
                if (!range.matches("bytes=\\d*-\\d*") || range.equals("bytes=-")) throw new ApiException(416, "MEDIA_RANGE_INVALID", "Intervalo invalido.");
                String[] parts = range.substring(6).split("-", -1);
                if (parts[0].isEmpty()) start = Math.max(0, length - Long.parseLong(parts[1]));
                else { start = Long.parseLong(parts[0]); if (!parts[1].isEmpty()) end = Math.min(end, Long.parseLong(parts[1])); }
                if (start > end || start >= length) throw new ApiException(416, "MEDIA_RANGE_INVALID", "Intervalo invalido.");
            }
            InputStream body = Files.newInputStream(file); body.skipNBytes(start);
            final long count = end - start + 1;
            InputStream limited = new FilterInputStream(body) {
                long remaining = count;
                @Override public int read() throws IOException { if (remaining <= 0) return -1; int value = super.read(); if (value >= 0) remaining--; return value; }
                @Override public int read(byte[] bytes, int offset, int size) throws IOException { if (remaining <= 0) return -1; int value = in.read(bytes, offset, (int)Math.min(size, remaining)); if (value > 0) remaining -= value; return value; }
            };
            return new StoredObject(limited, count, Files.probeContentType(file), range == null ? null : "bytes " + start + "-" + end + "/" + length, null);
        } catch (IOException | NumberFormatException failure) { throw new ApiException(404, "MEDIA_NOT_FOUND", "Midia nao encontrada."); }
    }
    @Override public void purgeCdn(MediaAsset asset) { /* Only the disposable disk is used. */ }
    @Override public synchronized void deleteObject(MediaAsset asset) {
        String key = asset.objectKey();
        if (!sizes.containsKey(key)) {
            Path seed = seeds.get(asset.cdnUrl());
            if (seed != null) try { Files.deleteIfExists(seed); } catch (IOException failure) { throw new IllegalStateException("Seed media deletion failed", failure); }
            return;
        }
        try { Files.deleteIfExists(path(key)); sizes.remove(key); }
        catch (IOException failure) { throw new IllegalStateException("Media deletion failed", failure); }
    }
}
