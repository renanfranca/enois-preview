package com.socialcoisa.rede.media.adapters.out.storage;

import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.*;
import com.socialcoisa.rede.media.application.port.out.*;

@Configuration(proxyBeanMethods = false)
@Profile("demo")
class DemoStorageConfig {
    @Bean DemoLocalStore demoLocalStore() throws java.io.IOException { return new DemoLocalStore(Path.of("/tmp/demo-uploads")); }
    @Bean StorageUrlFactory demoUrls() {
        String boot = UUID.randomUUID().toString();
        return new StorageUrlFactory() {
            public com.socialcoisa.rede.media.domain.MediaStorageProvider provider() { return com.socialcoisa.rede.media.domain.MediaStorageProvider.S3; }
            public String objectKey(String id, String file) { return "uploads/" + boot + "/" + id + "/" + file; }
            public String cdnUrl(String key) { return "/api/storage/" + key; }
            public String uploadUrl(String key) { return cdnUrl(key); }
        };
    }
    @Bean MediaUploadSigner demoSigner(StorageUrlFactory urls) {
        return (key, mime, size) -> new MediaUploadSigner.SignedUpload(urls.uploadUrl(key), "PUT", Map.of("Content-Type", mime), Instant.now().plusSeconds(3600));
    }
}
