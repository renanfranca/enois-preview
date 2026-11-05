import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.builder.SpringApplicationBuilder;
import com.socialcoisa.rede.RedeApplication;
import com.socialcoisa.rede.feed.domain.UserId;
import com.socialcoisa.rede.media.application.port.out.*;
import com.socialcoisa.rede.media.domain.*;

/** Actual packaged application, isolated fictional seed, blocked HTTP transports. */
public final class IntegrationProbe {
    static void require(boolean ok, String message) { if (!ok) throw new IllegalStateException(message); }
    static void invoke(Object bean, String method) throws Exception {
        var call = org.springframework.aop.support.AopUtils.getTargetClass(bean).getDeclaredMethod(method);
        call.setAccessible(true); call.invoke(bean);
    }
    public static void main(String[] args) throws Exception {
        var accounts = new tools.jackson.databind.ObjectMapper().readTree(Files.readString(Path.of("/opt/render-demo/seed/accounts.json")));
        require(accounts.isArray() && accounts.size() == 2, "Use the fictional two account image");
        for (var account : accounts) require(account.path("id").asText().startsWith("example_"), "Only fictional seed copies may be exercised");
        AtomicInteger attempts = new AtomicInteger();
        ProxySelector.setDefault(new ProxySelector() {
            public List<Proxy> select(URI uri) {
                attempts.incrementAndGet();
                return List.of(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", 9)));
            }
            public void connectFailed(URI uri, SocketAddress address, IOException error) {}
        });
        try {
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build().send(
                HttpRequest.newBuilder(URI.create("https://observer.example.invalid/control")).timeout(Duration.ofSeconds(2)).GET().build(),
                HttpResponse.BodyHandlers.discarding());
            throw new IllegalStateException("Blocked transport control unexpectedly succeeded");
        } catch (IOException expected) {}
        require(attempts.get() > 0, "HTTP observer missed positive control");
        int positive = attempts.get(); attempts.set(0);
        Files.createDirectories(Path.of("/tmp/rede-db"));
        Files.copy(Path.of("/opt/render-demo/seed/rede.mv.db"),Path.of("/tmp/rede-db/rede.mv.db"),StandardCopyOption.REPLACE_EXISTING);
        try (var app = new SpringApplicationBuilder(RedeApplication.class).run("--server.port=0", "--server.address=127.0.0.1")) {
            // No network storage or opportunistic copy can exist in this profile.
            for (String type : List.of("software.amazon.awssdk.services.s3.S3Client",
                    "com.socialcoisa.rede.media.application.LazyUrlMigrationService",
                    "com.socialcoisa.rede.media.application.MediaMigrationWorker",
                    "com.socialcoisa.rede.media.application.port.out.MediaS3Copier"))
                require(app.getBeanNamesForType(Class.forName(type)).length == 0,"External media capability is active");
            for (String[] task : List.of(
                    new String[]{"com.socialcoisa.rede.contributions.application.GitHubContributionSyncWorker","run"},
                    new String[]{"com.socialcoisa.rede.importlinkedin.application.LinkedinContactInviteWorker","run"},
                    new String[]{"com.socialcoisa.rede.emotes.application.EmoteCatalogScheduler","warmUpOnBoot"},
                    new String[]{"com.socialcoisa.rede.emotes.application.EmoteCatalogScheduler","refreshDaily"},
                    new String[]{"com.socialcoisa.rede.jobs.application.ExternalJobRefreshScheduler","seedIfEmpty"},
                    new String[]{"com.socialcoisa.rede.jobs.application.ExternalJobRefreshScheduler","refreshNightly"}))
                invoke(app.getBean(Class.forName(task[0])),task[1]);
            var support = app.getBean(com.socialcoisa.rede.support.application.SupportGithubConfig.class);
            require(!support.enabled() && !support.tokenConfigured(),"Support integration remains configured");
            var linkedin = app.getBean(com.socialcoisa.rede.linkedin.application.LinkedInIntegrationService.class);
            require(!linkedin.status("example_lia").connected(),"Original LinkedIn connection remains usable");
            linkedin.sharePublishedPost("example_lia","fictional-isolation-post","Fictional content","Fictional title");
            var store = app.getBean(MediaObjectStore.class);
            var gateway = app.getBean(MediaStorageGateway.class);
            require(store == gateway && store.getClass().getSimpleName().equals("DemoLocalStore"),"Media gateway is not disposable disk");
            // An eligible deletion job for a frozen external URL must finish locally,
            // including the purge phase, without contacting its former provider.
            var assets = app.getBean(MediaAssetRepository.class);
            var jobs = app.getBean(MediaDeletionJobRepository.class);
            var now = Instant.now();
            var asset = MediaAsset.pending("media_isolation_probe",new UserId("example_lia"),"retained.jpg","image/jpeg",12,
                "POST_IMAGE","legacy-file","https://legacy.example.invalid/retained.jpg",now,now.plusSeconds(3600));
            asset.requestDeletion(now); assets.save(asset);
            jobs.request("isolation-deletion",asset.id(),null,asset.ownerId(),now);
            invoke(app.getBean(Class.forName("com.socialcoisa.rede.media.application.MediaDeletionWorker")),"processPendingJobs");
            require(assets.findById(asset.id()).orElseThrow().deleteStatus() == MediaDeleteStatus.OBJECT_DELETED,"Eligible deletion did not complete");
            require(jobs.findPending(Instant.now(),100).stream().noneMatch(j -> j.mediaId().equals(asset.id())),"Deletion job remains pending");
            require(attempts.get() == 0,"Application attempted blocked outbound HTTP");
            System.out.println("INTEGRATION_PROOF={\"httpPositiveControlAttempts\":"+positive+",\"demoHttpAttempts\":0,\"scheduledEntryPointsExercised\":6,\"eligibleExternalAssetDeletionCompleted\":true,\"externalStorageAndLazyMigrationAbsent\":true,\"originalLinkedInUnavailable\":true,\"supportUnconfigured\":true}");
        }
    }
}
