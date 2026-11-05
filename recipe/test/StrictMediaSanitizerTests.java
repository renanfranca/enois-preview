package com.socialcoisa.rede.media.application;
import java.io.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class StrictMediaSanitizerTests {
    @Test void supportedAudioWebmRetainsItsPlayableStreamAndDropsPrivateMetadata() throws Exception {
        Path file=Files.createTempFile("valid-audio-", ".webm");
        try {
            var ffmpeg=new ProcessBuilder("ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","sine=frequency=440:duration=0.2","-c:a","libopus","-metadata","comment=private-control-marker",file.toString())
                .redirectError(ProcessBuilder.Redirect.DISCARD).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            assertThat(ffmpeg.waitFor(30,TimeUnit.SECONDS)).isTrue();assertThat(ffmpeg.exitValue()).isZero();
            byte[] clean=new StrictMediaSanitizer().sanitize(Files.readAllBytes(file),"audio/webm","file.weba");
            assertThat(clean).startsWith((byte)0x1a,(byte)0x45,(byte)0xdf,(byte)0xa3);
            assertThat(new String(clean,java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain("private-control-marker");
            Files.write(file,clean);
            var decode=new ProcessBuilder("ffmpeg","-nostdin","-hide_banner","-loglevel","error","-xerror","-i",file.toString(),"-f","null","-")
                .redirectError(ProcessBuilder.Redirect.DISCARD).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            assertThat(decode.waitFor(30,TimeUnit.SECONDS)).isTrue();assertThat(decode.exitValue()).isZero();
        } finally {Files.deleteIfExists(file);}
    }
    @Test void validImageRemainsDecodableWhileMismatchedAndMalformedBodiesAreRejected() throws Exception {
        var image = new BufferedImage(16,16,BufferedImage.TYPE_INT_RGB);
        var bytes = new ByteArrayOutputStream(); ImageIO.write(image,"png",bytes);
        var sanitizer = new StrictMediaSanitizer();
        byte[] clean = sanitizer.sanitize(bytes.toByteArray(),"image/png","file.png");
        assertThat(ImageIO.read(new ByteArrayInputStream(clean)).getWidth()).isEqualTo(16);
        assertThatThrownBy(() -> sanitizer.sanitize(bytes.toByteArray(),"image/jpeg","file.jpg")).hasMessageContaining("invalido");
        assertThatThrownBy(() -> sanitizer.sanitize("not an image".getBytes(),"image/png","file.png")).hasMessageContaining("invalido");
        assertThatThrownBy(() -> sanitizer.sanitize("%PDF-corrupt".getBytes(),"application/pdf","file.pdf")).hasMessageContaining("invalido");
    }
}
