import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;
import jakarta.mail.internet.MimeMessage;
import com.socialcoisa.rede.identity.application.EmailService;
import com.socialcoisa.rede.blog.application.*;
import com.socialcoisa.rede.blog.application.port.out.BlogSubscriptionRepository;
import com.socialcoisa.rede.profile.application.port.out.UserProfileRepository;
import com.socialcoisa.rede.profile.domain.UserProfile;
import com.socialcoisa.rede.ops.application.port.out.EmailLogRepository;
import com.socialcoisa.rede.ops.domain.*;
import com.socialcoisa.rede.shared.security.SecretCipher;

/** Exercises the actual packaged demo services; records transport calls without sending email. */
public final class DeliveryProbe {
    static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }
    @SuppressWarnings("unchecked")
    static <T> T adapter(Class<T> type, java.lang.reflect.InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler);
    }
    public static void main(String[] args) throws Exception {
        AtomicInteger transport = new AtomicInteger();
        var sender = new JavaMailSenderImpl() {
            @Override public void send(MimeMessage... messages) { transport.addAndGet(messages.length); }
        };
        // Independent positive control: the observer sees an actual send invocation.
        sender.send(sender.createMimeMessage());
        require(transport.get() == 1, "Transport observer did not detect its positive control");
        List<EmailLog> logs = Collections.synchronizedList(new ArrayList<>());
        EmailLogRepository repository = new EmailLogRepository() {
            public EmailLog save(EmailLog log) { logs.add(log); return log; }
            public List<EmailLog> findRecent(int limit) { return List.copyOf(logs); }
        };
        var templates = new SpringTemplateEngine();
        var resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/"); resolver.setSuffix(".html"); resolver.setCharacterEncoding("UTF-8");
        templates.setTemplateResolver(resolver);
        var email = new EmailService(sender, templates, "https://preview.example.invalid", "https://preview.example.invalid", "demo@enois.invalid", repository);
        require(email.sendHtml("reader@enois.invalid", "Fictional direct check", "<p>fictional</p>"), "Demo email failed before local effects");
        require(transport.get() == 1, "Demo direct email reached the observed external transport");
        UserProfile author = UserProfile.create("author", "author", "author@enois.invalid", "Fictional author", "Author", Instant.now());
        UserProfile reader = UserProfile.create("reader", "reader", "reader@enois.invalid", "Fictional reader", "Reader", Instant.now());
        reader.markEmailVerified(Instant.now());
        BlogSubscriptionRepository subscriptions = adapter(BlogSubscriptionRepository.class, (proxy, method, values) -> {
            if (method.getName().equals("findSubscriberIds")) return List.of("reader");
            throw new IllegalStateException("Unexpected subscription operation " + method.getName());
        });
        UserProfileRepository profiles = adapter(UserProfileRepository.class, (proxy, method, values) -> {
            if (method.getName().equals("findById")) return Optional.of(author);
            if (method.getName().equals("findAllByIds")) return List.of(reader);
            throw new IllegalStateException("Unexpected profile operation " + method.getName());
        });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            var cipher = new SecretCipher(Base64.getEncoder().encodeToString(new byte[32]));
            var newsletter = new BlogNewsletterService(subscriptions, profiles, email, cipher, templates, executor, "https://preview.example.invalid");
            newsletter.onPostPublished(new BlogPostPublishedEvent("blog", "fictional", "Fictional blog", "author", "post", "Fictional post", "Eligible newsletter content"));
            executor.submit(() -> {}).get(30, TimeUnit.SECONDS);
            require(logs.stream().anyMatch(log -> log.kind().equals("BLOG_POST") && log.status() == EmailLogStatus.SENT && log.toEmail().equals("reader@enois.invalid")), "Eligible asynchronous newsletter did not preserve local delivery effects");
            require(transport.get() == 1, "Demo asynchronous newsletter reached the observed external transport");
        } finally { executor.shutdownNow(); }
        System.out.println("DELIVERY_PROOF={\"positiveControlCalls\":1,\"demoTransportCalls\":0,\"eligibleAsyncNewsletterLocalEffect\":true,\"directEmailLocalEffect\":true}");
    }
}
