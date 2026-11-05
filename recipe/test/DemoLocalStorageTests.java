package com.socialcoisa.rede.media.adapters.out.storage;
import java.io.*;
import java.nio.file.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.assertj.core.api.Assertions.*;
class DemoLocalStorageTests {
    @TempDir Path root;
    static String key(String id) { return "uploads/00000000-0000-0000-0000-000000000001/media_" + id + "/file.wav"; }
    static InputStream bytes(long length) {
        return new InputStream() {
            long remaining = length;
            public int read() { return remaining-- > 0 ? 0 : -1; }
            public int read(byte[] data,int offset,int size) { if (remaining <= 0) return -1; int count = (int)Math.min(size,remaining); java.util.Arrays.fill(data,offset,offset+count,(byte)0); remaining -= count; return count; }
        };
    }
    static void upload(DemoLocalStore store, String id, long count) throws Exception {
        try (var reservation = store.reserve(key(id),count)) { store.write(key(id),"audio/wav",count,bytes(count)); }
    }
    @Test void exactFileBoundaryReadsBackAndOneExtraByteIsRefused() throws Exception {
        DemoLocalStore store = new DemoLocalStore(root);
        upload(store,"exact",20_971_520);
        try (var body = store.read(key("exact"),null).body()) { assertThat(body.transferTo(OutputStream.nullOutputStream())).isEqualTo(20_971_520); }
        assertThatThrownBy(() -> store.reserve(key("large"),20_971_521)).hasMessageContaining("20 MiB");
        assertThatThrownBy(() -> store.read("../private",null)).hasMessageContaining("invalida");
    }
    @Test void concurrentReservationsShareTheLastTwoMiBAndCancellationRestoresCapacity() throws Exception {
        DemoLocalStore store = new DemoLocalStore(root);
        for (int i=0; i<12; i++) upload(store,"full"+i,20_971_520);
        upload(store,"tail",14_680_064);
        CountDownLatch start = new CountDownLatch(1), reserved = new CountDownLatch(2), release = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        try {
            java.util.List<Future<Boolean>> futures = new java.util.ArrayList<>();
            for (int i=0; i<2; i++) {
                final String id = "race"+i;
                futures.add(executor.submit(() -> {
                    start.await(); DemoLocalStore.Reservation reservation;
                    try { reservation=store.reserve(key(id),2_097_152); }
                    catch (RuntimeException unavailable) { reserved.countDown(); return false; }
                    reserved.countDown(); release.await(); reservation.close(); return true;
                }));
            }
            start.countDown(); assertThat(reserved.await(5,TimeUnit.SECONDS)).isTrue(); release.countDown();
            int accepted = 0; for (var result : futures) if (result.get(5,TimeUnit.SECONDS)) accepted++;
            assertThat(accepted).isEqualTo(1); upload(store,"afterCancel",2_097_152);
            assertThatThrownBy(() -> store.reserve(key("over"),1)).hasMessageContaining("256 MiB");
        } finally { release.countDown(); executor.shutdownNow(); }
    }
    @Test void bodyFailureLeavesNoUsableObjectOrReservation() throws Exception {
        DemoLocalStore store = new DemoLocalStore(root);
        try (var reservation=store.reserve(key("broken"),100)) {
            assertThatThrownBy(() -> store.write(key("broken"),"audio/wav",100,bytes(99))).hasMessageContaining("guardar");
        }
        assertThatThrownBy(() -> store.read(key("broken"),null)).hasMessageContaining("encontrada");
        upload(store,"broken",100);
        try(var files=Files.list(root)) { assertThat(files.noneMatch(path -> path.getFileName().toString().startsWith(".upload-"))).isTrue(); }
    }
    @Test void physicalDeletionFreesSpaceForAnotherUpload() throws Exception {
        DemoLocalStore store = new DemoLocalStore(root);
        for (int i=0;i<12;i++) upload(store,"full"+i,20_971_520);
        upload(store,"tail",16_777_216);
        assertThatThrownBy(() -> store.reserve(key("over"),1)).hasMessageContaining("256 MiB");
        var now=java.time.Instant.now();
        var asset=com.socialcoisa.rede.media.domain.MediaAsset.pending("media_full0",new com.socialcoisa.rede.feed.domain.UserId("owner"),"file.wav","audio/wav",20_971_520,"POST",key("full0"),"/api/storage/"+key("full0"),now,now.plusSeconds(3600),com.socialcoisa.rede.media.domain.MediaStorageProvider.S3);
        store.deleteObject(asset);
        assertThatThrownBy(() -> store.read(key("full0"),null)).hasMessageContaining("encontrada");
        upload(store,"afterDelete",20_971_520);
    }
}
