#!/usr/bin/env python3
"""Apply reviewed demo adjustments only to exported sources."""
import base64
import json
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve()
recipe = Path(__file__).resolve().parent
backend = root / 'sources/enois-backend'
frontend = root / 'sources/enois-frontend'
java = backend / 'src/main/java/com/socialcoisa/rede'

def replace(path, old, new):
    text = path.read_text()
    if old not in text: raise SystemExit(f'Demo recipe does not support the captured source contract: {path.name}')
    path.write_text(text.replace(old, new))

shutil.copyfile(recipe / 'application-demo.properties', backend / 'src/main/resources/application-demo.properties')
for file in (recipe / 'java').glob('*.java'):
    shutil.copyfile(file, java / 'media/adapters/out/storage' / file.name)
# Disable fallback factories whose no-op deletion is not a local store.
for name in ('DevMediaStorageGateway.java', 'DevStorageUrlFactory.java'):
    replace(java / 'media/adapters/out/storage' / name, '@Component\n', '@Component\n@org.springframework.context.annotation.Profile("!demo")\n')
replace(java / 'media/application/MediaService.java', '500L * 1024L * 1024L', '20L * 1024L * 1024L')
# Reserve raw bytes before reading/sanitizing; settle output in the same reservation.
controller = java / 'media/adapters/in/web/MediaStorageProxyController.java'
replace(controller, '\t\ttry {\n\t\t\tif (length >', '''\t\ttry (var reservation = (store() instanceof com.socialcoisa.rede.media.adapters.out.storage.DemoLocalStore local ? local.reserve(objectKey, length) : (com.socialcoisa.rede.media.adapters.out.storage.DemoLocalStore.Reservation) () -> {})) {
            if (store() instanceof com.socialcoisa.rede.media.adapters.out.storage.DemoLocalStore && (contentType == null || !contentType.split(";", 2)[0].strip().equalsIgnoreCase(mime)))
                throw new ApiException(400, "MEDIA_TYPE_MISMATCH", "Tipo enviado difere do declarado.");
\t\t\tif (length >''')
replace(controller, 'byte[] raw = request.getInputStream().readAllBytes();', '''byte[] raw = request.getInputStream().readNBytes(Math.toIntExact(length + 1));
                if (raw.length != length) throw new ApiException(400, "MEDIA_SIZE_MISMATCH", "Corpo enviado difere do tamanho declarado.");''')
# Strict demo sanitizer shares the public sanitizer API and processing tools; no fallback to raw bytes.
shutil.copyfile(recipe / 'StrictMediaSanitizer.java', java / 'media/application/StrictMediaSanitizer.java')
# Suppress the email transport at its boundary, leaving domain events and internal delivery intact.
email = java / 'identity/application/EmailService.java'
replace(email, 'this.mailSender = mailSender;', '''this.mailSender = new org.springframework.mail.javamail.JavaMailSenderImpl() {
            @Override public void send(jakarta.mail.internet.MimeMessage... messages) { /* demo: local effects only */ }
            @Override public void send(org.springframework.mail.SimpleMailMessage... messages) { /* demo */ }
        };''')
# Preserve configured seed roots and disposable storage URLs on the current origin.
manifest = json.loads((root / 'runtime-manifest.json').read_text())
prefixes = [mapping['url'] for mapping in manifest['media']] + ['/api/storage/']
replace(frontend / 'src/lib/api/media.ts',
    '  const cleaned = url.replace(/%2F/g, "/");',
    '  const cleaned = url.replace(/%2F/g, "/");\n  if (' + json.dumps(prefixes) + '.some(prefix => cleaned.startsWith(prefix))) return cleaned;')
(frontend / 'src/lib/api/demo-media.test.ts').write_text(
    'import { describe, it, expect } from "vitest";\nimport { resolveCdnUrl, withImageKitOriginal } from "./media";\n'
    + 'describe("demo same origin media", () => {\n'
    + ''.join('it(' + json.dumps(prefix) + ', () => { expect(resolveCdnUrl(' + json.dumps(prefix + 'image.png') + ')).toBe(' + json.dumps(prefix + 'image.png') + '); expect(withImageKitOriginal(' + json.dumps(prefix + 'image.png') + ')).toBe(' + json.dumps(prefix + 'image.png') + '); });\n' for prefix in prefixes)
    + 'it("retains external read URLs", () => { expect(resolveCdnUrl("https://example.org/image.png")).toBe("https://example.org/image.png"); });\n});\n')

replace(frontend / 'src/lib/api/client-origin.ts',
    '  return import.meta.env.VITE_SITE_URL ?? "https://enois.ia.br";',
    '  return (typeof process !== "undefined" ? process.env.DEMO_PUBLIC_ORIGIN : undefined) ?? import.meta.env.VITE_SITE_URL ?? "https://enois.ia.br";')
# Close signup in the actual UI as well as the backend. A server rendered
# password form must never fall back to a GET while waiting for hydration.
replace(frontend / 'src/constants/account.ts', 'export const SIGNUP_OPEN = true;', 'export const SIGNUP_OPEN = false;')
auth = frontend / 'src/routes/entrar.tsx'
replace(auth, 'type ReactNode, useRef, useState', 'type ReactNode, useEffect, useRef, useState')
replace(auth, 'function LoginForm({ onDone, onForgot }: LoginFormProps) {', '''function LoginForm({ onDone, onForgot }: LoginFormProps) {
  const [demoReady, setDemoReady] = useState(false);
  useEffect(() => setDemoReady(true), []);''')
replace(auth, '<form onSubmit={submit}', '<form method="post" onSubmit={submit}')
text = auth.read_text()
start = text.index('function LoginForm(')
end = text.index('function TwoFactorForm(', start)
login = text[start:end]
login = login.replace('<form method="post" onSubmit={submit}', '<form method="post" data-demo-ready={demoReady} aria-busy={!demoReady} onSubmit={submit}')
login = login.replace('disabled={loading}', 'disabled={loading || !demoReady}')
auth.write_text(text[:start] + login + text[end:])
# Human interaction is recorded in the demo gateway HTML injection, with no source UI changes.
accounts = json.loads((root / 'data/seed/accounts.json').read_text())
(root / 'data/seed/accounts.tsv').write_text(''.join(f'{a["id"]}\t{a["email"]}\t{base64.b64encode(a["label"].encode()).decode()}\n' for a in accounts))
# The DS is built inside Docker; install the freshly packed tarball, never a private registry copy.
package = frontend / 'package.json'
value = json.loads(package.read_text())
value['dependencies']['@rede-enois/design-system'] = 'file:../design-system.tgz'
package.write_text(json.dumps(value, indent=2) + '\n')

manifest = json.loads((root / 'runtime-manifest.json').read_text())
(root / 'media-mappings.tsv').write_text(''.join(mapping['url'] + path + '\t' + mapping['directory'] + '/' + path + '\n' for mapping in manifest['media'] for path in mapping['inventory']))

import re
for file in (recipe / 'test').glob('*.java'):
    package_name = re.search(r'^package ([\w.]+);', file.read_text(), re.MULTILINE).group(1)
    target = backend / 'src/test/java' / package_name.replace('.', '/') / file.name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, target)
