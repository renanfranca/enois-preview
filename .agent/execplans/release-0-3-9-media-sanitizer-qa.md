# Plano 0.3.9: receita compatível com o backend `qa` atual, release e preview da #806

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Purpose and success

Em 13 de novembro de 2026, a publicação do cenário `issue-806-precos-longos` parou na etapa `localImage`, antes de qualquer efeito remoto. A receita da imagem copia `recipe/StrictMediaSanitizer.java` para dentro do backend. Essa classe estende `MediaMetadataSanitizer` e chama `super("ffmpeg")`. O commit `1a3f9964` do `enois-backend` (#492, 2026-11-06) trocou esse construtor por `MediaMetadataSanitizer(MediaFfmpegRunner, MediaTemporaryFiles)`. Desde então, nenhum backend do `qa` compila com a receita:

```
StrictMediaSanitizer.java:[17,37] constructor MediaMetadataSanitizer in class com.socialcoisa.rede.media.application.MediaMetadataSanitizer cannot be applied to given types;
  required: com.socialcoisa.rede.media.application.MediaFfmpegRunner,com.socialcoisa.rede.media.application.MediaTemporaryFiles
  found:    java.lang.String
```

O usuário decidiu:
- suportar **só o `qa` atual** do backend, sem compatibilidade com backends anteriores ao `1a3f9964`;
- lançar a correção como **0.3.9**, que já tem no `main` o instalador de um comando;
- atualizar o lançador privado para a 0.3.9;
- refazer a publicação da #806.

**Sucesso:**
- A imagem compila e valida a partir do exemplo fictício com os pins no `qa` público atual. O `StrictMediaSanitizerTests` roda dentro do build e passa.
- O comportamento estrito de mídia da demo continua: upload com tipo diferente do conteúdo, corpo malformado ou PDF corrompido é recusado com `MEDIA_SANITIZATION_FAILED`; áudio e imagem válidos continuam decodificáveis e sem o marcador de metadado.
- `v0.3.9` foi marcada, a release foi publicada e lida de volta sem vazamentos, e a instalação real veio pelo `install.sh` da própria tag.
- O lançador fixa a 0.3.9 em `tool.lock.json` e no `package.json`.
- `enois-preview publish issue-806-precos-longos` termina com `status: "validated"`, e o link mostra a correção a 390 px.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, sem worktree. A branch nova sai da `main` = `origin/main` = `d2c2bbb` (merge do PR #10). A `main` está à frente da `v0.3.8` (`e733eb4`) só com o instalador de um comando e o `docs/en/CHANGELOG.md`/`CHANGELOG.md` com a seção "0.3.9 (não publicada)". Desde a `v0.3.8`, `src/` (o Worker) não mudou: `git diff --stat v0.3.8 main -- src` é vazio.
  - Este plano é a única mudança pendente e vai no commit.
  - O GitHub é **público**: não escreva no repositório caminhos absolutos com o nome do usuário, segredos, emails, IDs de conta nem valores do banco. Use `~`.
- **Tags que não mudam:** `v0.3.8` = `e733eb4`, `v0.3.7` = `c52d80e`, `v0.3.6` = `4e81e92`.
- **Instalações:** `~/.local/share/enois-preview/` tem `d2c2bbb` e `e733eb4`; `current` → `e733eb4`. O comando global aponta para `e733eb4`, cuja CLI **não** tem o subcomando `install`.
- **Backend `qa`:** o `qa` público (`Rede-ENois/enois-backend`) estava em `da431a88` em 2026-11-13 e contém `1a3f9964`. O commit da #806, `a3a6da97`, também contém.
- **O que a receita faz:** `recipe/prepare.ts` copia `StrictMediaSanitizer.java` para `media/application/` do backend e `recipe/test/*.java` para os testes. O `recipe/Dockerfile` roda `DemoLocalStorageTests,StrictMediaSanitizerTests,MediaStorageProxyTests,MediaMetadataSanitizerTests,BlogFlowTests` antes do `package`. As outras substituições textuais do `prepare.ts` passaram no backend `a3a6da97` e no frontend da #806 (a falha veio depois, no `docker build`). O estágio do frontend foi cancelado antes do `typecheck`, então ele **não** foi exercitado contra esses commits.
- **Backend atual** (`MediaMetadataSanitizer`, `a3a6da97`):
  - construtor `(MediaFfmpegRunner ffmpeg, MediaTemporaryFiles temporaryFiles)`, `@Component`;
  - `sanitize(byte[], String, String) throws MediaTemporaryFiles.UnavailableException`;
  - devolve os bytes como vieram para tipo sem limpeza definida, vazio ou acima de 40 MiB;
  - não confere assinatura contra o MIME nem decodifica o conteúdo inteiro.
  - `MediaFfmpegRunner(String ffmpegPath, int maxConcurrent)` e `MediaTemporaryFiles(String, String, String, String)` são construtores acessíveis no pacote, usados pelo `MediaMetadataSanitizerTests` do backend.
- **Exemplo fictício:** `example/sources.json` fixa backend `c6a6d3be`, frontend `c21edb9` e design system `e18fa87`, todos anteriores ao `1a3f9964`. `npm run test:example` prepara um workspace novo a partir desses pins. `test:image`, `test:media` e `test:capture` usam esse workspace (`ENOIS_PREVIEW_EXAMPLE_WORKSPACE`). O `test:example` confere `observed` e `canonicalDataSha256` fixos.
- **Workspaces `public-walkthrough-ts-{pt,en}`** (`~/projects/enois/.local/`): backend `c6a6d3be` e `toolCommit` `e733eb4`. Eles ficam como estão, presos à 0.3.8. Com a 0.3.9, uma revisão nova deles não compila. Não edite esses workspaces.
- **Lançador:** checkout local `~/projects/enois/.local/render-demo/launcher`, branch `codespaces-demo`, igual ao origin, com pin `e733eb4` em `tool.lock.json` e na dependência `enois-preview` do `package.json`. O próprio `publish` clona o lançador, roda `npm ci`, `build`, `test` e `check` e faz o deploy do Worker (`preview/remote.ts:164-170`). Por isso o lançador só precisa do pin novo e do push. Não rode `wrangler deploy` à mão.
- **Lease da tentativa anterior:** não há lease preso. O build local roda antes de `acquireRemoteLease` (`preview/publication.ts:122`). O journal da operação `3dec7303…` não tem nenhum checkpoint, e a ref `enois-preview-publication-lease` não existe no lançador (`gh api …/git/refs/heads/enois-preview-publication-lease` → 404). O `publicationLeaseReleased: false` do `failure.json` só quer dizer "não liberado porque não foi adquirido". Confira de novo antes do S8. Se a ref existir, pare e pergunte.
- **#806 (privado, fora do repositório):** `~/projects/enois/.local/issue806/`.
  - `HANDOFF-enois-preview.md`: banco, conta, commits e roteiro de conferência.
  - `EXECPLAN-publish-preview-806.md`: a execução anterior, com M1 a M5 concluídos e M6 falho.
  - `.preview/config.json`, `service.json` e `service-environment.json` (0600) já existem. O `setup` desse workspace usa `ENOIS_PREVIEW_HOME=~/projects/enois/.local/issue806/.preview/installation`.
  - O backend local da #806 está parado.
  - Commits: frontend `595914bd` (worktree `fix/806-mobile-price-title-squeeze`, igual ao upstream do fork), backend `a3a6da97`, design system `68f08d0`.
- **Evidências:** `$EV` = `~/projects/enois/.local/preview-typescript-evidence/node24-consolidation`. Grave em `$EV/release-0.3.9/`. As pastas anteriores são só leitura.
- **Modelo do ciclo:** `.agent/execplans/release-0-3-8-sanitizer-columns.md` (S5, S6 e S10), para comandos de merge, tag, release e leitura de volta.

**Autorização:**
- **Concedida:**
  - commit (`lc`), push (`lp`) e PR;
  - merge pelo `luna` só por fast-forward, com fallback por git ff;
  - criar e enviar a tag `v0.3.9`;
  - `gh release create v0.3.9` com upload;
  - instalação real pelo `install.sh`;
  - no lançador, mudar só o pin, com `lc` e `lp` na branch `codespaces-demo`;
  - na config da #806, mudar só o `toolCommit`;
  - `enois-preview setup` e `publish` da #806, sem `--refresh-data`;
  - excluir a branch já incorporada.
- **Exige parar e perguntar:**
  - force push;
  - reescrever a `main` ou tags;
  - editar releases anteriores;
  - conta, plano pago, Worker novo ou segredo;
  - `wrangler deploy` manual;
  - tocar nas aplicações, nos bancos, nos workspaces `public-walkthrough-*` ou na config padrão;
  - apagar dado, catálogo ou histórico;
  - `publish --refresh-data`;
  - postar qualquer coisa no PR da #806.

## Decisions

- **O `StrictMediaSanitizer` continua.** O sanitizador do backend não cobre a fronteira da demo, em que visitantes anônimos compartilham contas e enviam arquivos:
  - ele devolve os bytes originais para tipos sem limpeza definida e para arquivo vazio;
  - ele não confere a assinatura contra o MIME declarado;
  - ele não decodifica o conteúdo inteiro;
  - ele não tem o teto de 20 MiB.

  Remover a classe tiraria essas recusas do preview público. A alternativa descartada foi justamente apagar o arquivo e usar só o backend.
- **Adaptar ao construtor novo, sem compatibilidade com o antigo.** O construtor passa a ser `StrictMediaSanitizer(MediaFfmpegRunner ffmpeg, MediaTemporaryFiles temporaryFiles)`, que chama `super(ffmpeg, temporaryFiles)`. O Spring injeta os dois beans. O restante da classe não muda.
  - Alternativas descartadas:
    - reflexão para aceitar os dois construtores, que acoplaria ainda mais a receita a detalhes internos;
    - ficar no backend antigo, contra a decisão do usuário.
  - **Consequência:** a 0.3.9 só compila backends que contêm o `1a3f9964`. Um backend anterior falha no `localImage`, antes de efeitos remotos. O CHANGELOG e o `RECIPES.md` dizem isso.
- **O build da imagem roda a suíte completa do backend, com as restrições da demo abertas só nos testes** (decisão do usuário em 2026-11-13, depois do green bloqueado do S2).
  - O `recipe/Dockerfile` troca a lista de cinco classes por `./mvnw -B test`, com a saída gravada em `/build/backend-tests.log` no estágio `backend`. O console mostra só as linhas `Tests run:` e, se falhar, a seção `Results:`. Sem isso, o BuildKit corta a saída da etapa em 2 MiB e esconde as contagens e as falhas. O `-Dsurefire.redirectTestOutputToFile=true` não bastou, porque os logs de threads em segundo plano (envio assíncrono de e-mail) continuam no console.
  - Três substituições do `recipe/prepare.ts` passam a depender de `Boolean.getBoolean("enois.preview.demo")`: o teto de 20 MiB em `MediaService`, a recusa `MEDIA_SIZE_MISMATCH` no `MediaStorageProxyController` e o `JavaMailSender` sem efeito no `EmailService`. O `runtime/start.ts` passa `-Denois.preview.demo=true` ao iniciar o backend no Codespace. As demais substituições já dependiam do perfil `demo`.
  - Motivo: com as restrições sempre ligadas, a suíte completa no `3fe25eaf` teve 6 falhas em 2555 testes, todas causadas por elas (quatro pelo teto, duas pelo e-mail). Pular testes foi descartado pelo usuário.
  - Guarda: `scripts/validate-media-contracts.ts` passa a exigir 400 para um upload declarado com 20 MiB + 1 byte (`demoMediaCapRejected400`). Sem a flag, o backend aceitaria até 500 MiB.
  - Consequência: o build da imagem fica uns 15 minutos mais lento na máquina de quem publica. A subida do Codespace não muda.
- **Os pins do exemplo vão para o `qa` público atual.** Sem isso, o exemplo do README quebraria para todo usuário novo da 0.3.9. Os três pins (backend, frontend e design system) vão para os heads do `qa` de `Rede-ENois/*` lidos no S1, juntos, para frontend e backend combinarem. Se `observed` ou `canonicalDataSha256` do `test:example` mudarem por causa do backend novo, atualize as asserções com o valor observado e registre a causa. Não mude o `seed.sql` nem o `ExampleSeed.java` sem antes registrar por que o esquema novo exige isso.
- **A prova real é a #806, não o publish canônico dos walkthroughs.** Os walkthroughs ficam na 0.3.8 com backend `c6a6d3be`, que a 0.3.9 não compila. O S8 publica a #806 e confere o link.
- **O plano no repositório congela antes da validação final**, como na 0.3.8. Atualize o `Progress` até o S4 antes do S4. Do S5 em diante, o progresso vai para `$EV/release-0.3.9/executor-report.md`.
- **Título da release:** `0.3.9`, sem o "v".

## Risks

- **O frontend e o design system do `qa` podem não passar pela receita.** O estágio do frontend nunca rodou contra esses commits. O `test:image` com o exemplo novo é a guarda. Uma substituição do `prepare.ts` que não encontrar o texto falha com `Demo recipe does not support the captured source contract: <arquivo>`. Nesse caso, adapte só a âncora do texto, sem mudar o efeito, e registre.
- **O seed do exemplo pode não caber no esquema novo.** Migrações novas podem exigir colunas. O `test:example` é a guarda. Veja a decisão sobre `seed.sql`.
- **O `sanitizerSha256` não muda.** Este plano não toca em `recipe/SeedTool.java`.
- **A revisão da #806 muda.** O `toolCommit` entra na identidade, então a operação `3dec7303…` não é retomada. O `publish` cria uma revisão nova com os mesmos dados congelados.
- **O `setup` pode pedir de novo a confirmação interativa do plano gratuito.** Se pedir, pare e peça ao dono para rodar no terminal dele. O executor não confirma estado de cobrança no lugar do dono.
- **Testes do frontend por tempo esgotado.** Com o Maven rodando em paralelo no build, `mention-textarea.test.tsx` e `formato-unico.test.ts` estouraram o limite de 5 s uma vez. A repetição passou. Se acontecer no `publish` da #806, o `resume` único autorizado cobre.
- **Tempo:** cada `test:image` leva de 20 a 30 minutos com a suíte completa, e o `publish` da #806 leva de 20 a 40.

## Milestones

### S0. Branch e baseline
- Use o skill `create-git-branch` na pasta principal, a partir da `main` (`d2c2bbb`). Este plano vai junto.
- Confira `main` = `origin/main`, e as tags da seção Context sem mudança.
- Grave em `$EV/release-0.3.9/baseline.json`:
  - `readlink current`;
  - o pin do lançador;
  - os heads do `qa` público dos três repositórios (`git ls-remote https://github.com/Rede-ENois/<repo>.git refs/heads/qa`);
  - a confirmação de que o backend contém `1a3f9964` (`git merge-base --is-ancestor`, num clone ou fetch do upstream);
  - a ausência da ref de lease no lançador.

### S1. Exemplo no `qa` e red
1. Troque os três pins de `example/sources.json` pelos heads do S0.
2. `npm run build`, depois `ENOIS_PREVIEW_EVIDENCE=$EV/release-0.3.9/example npm run test:example`. Se só `observed` ou `canonicalDataSha256` divergirem, atualize as asserções com o valor observado e registre o antes, o depois e a causa. Qualquer outra falha é parada: registre e reporte.
3. Red: `ENOIS_PREVIEW_EXAMPLE_WORKSPACE=$EV/release-0.3.9/example/example-01 npm run test:image`. O esperado é falhar no build do backend com a mensagem do construtor citada em Purpose. Grave as linhas do erro em `red.log`. Se falhar por outro motivo antes desse (frontend, design system, `prepare.ts`), registre. Corrija primeiro só o que for âncora textual (veja Risks) e repita até ver o red do construtor.

### S2. Green
- `recipe/StrictMediaSanitizer.java`: troque o construtor sem argumentos por `public StrictMediaSanitizer(MediaFfmpegRunner ffmpeg, MediaTemporaryFiles temporaryFiles) { super(ffmpeg, temporaryFiles); javax.imageio.ImageIO.setUseCache(false); }`. Não mude `sanitize`, `signature`, `temporary`, `streamTypes`, `execute` nem `invalid`.
- `recipe/test/StrictMediaSanitizerTests.java`: construa o sanitizador com `new StrictMediaSanitizer(new MediaFfmpegRunner("ffmpeg", 2), <MediaTemporaryFiles com a pasta temporária do sistema>)`, no padrão do `MediaMetadataSanitizerTests` do backend. Não mude nenhuma asserção.
- Rode o `test:image` do S1 de novo. Ele deve passar. Grave `green-image.log` e o `local-build-proof.json`.
- `ENOIS_PREVIEW_EXAMPLE_WORKSPACE=… npm run test:media`: os contratos de upload passam pela imagem nova. Grave `green-media.log`.

### S3. Documentação e versão
- `package.json` e as duas ocorrências da raiz em `package-lock.json`: `0.3.9`.
- `CHANGELOG.md` e `docs/en/CHANGELOG.md`:
  - troque "(não publicada)"/"(unreleased)" pela data da entrega;
  - acrescente que a receita da imagem acompanha o construtor de mídia do backend a partir do `1a3f9964` (#492), que backends anteriores deixam de compilar e falham no `localImage` sem efeito remoto, e que o exemplo fictício passou a fixar o `qa` de 2026-11-13.
  - Mantenha as entradas que já existem.
- `docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`, na tabela de erros: uma linha para `Stage localImage incomplete: docker failed` com `cannot be applied to given types` no `build.log` da operação. O texto diz que o backend é anterior ao suportado por esta versão da ferramenta: use um backend do `qa` atual ou a versão anterior da ferramenta.
- `VALIDATION.md`: uma seção nova "Media sanitizer constructor for the current backend (0.3.9)" com a causa, a decisão, o red, o green e as contagens. Não reescreva seções anteriores.
- `docs/validation/media-sanitizer-qa-0.3.9/local.json`, no modelo de `docs/validation/sanitizer-columns-0.3.8/local.json`, com as contagens observadas no S4. Inclua essa entrada em `release/public-files.json`. O plano em `.agent/` não entra.

### S4. Validação final
Detalhada em Validation. Antes dela, atualize o `Progress` até o S4 e marque o S5 como "em andamento". A partir daí, este arquivo fica congelado.

### S5. Commit, PR, merge e tag
Siga o S5 da 0.3.8 com `v0.3.9`:
1. `lc`, depois `lp`.
2. PR e merge só por fast-forward pelo `luna`, com o pedido entre aspas.
3. Confira `main` = `origin/main` = SHA validado (SHA9), PR `MERGED` e `git status` limpo.
4. `git tag -a v0.3.9 -m "0.3.9" <SHA9>` e `git push origin v0.3.9`. Confira que as tags anteriores não mudaram.

### S6. Instalação e lançador
1. Instale pelo caminho público, com a CLI atual sem `install`:

   ```sh
   COMMIT=<SHA9>
   curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
   ```

   Confira:
   - `current` → SHA9;
   - o comando global aponta para `<SHA9>/dist/preview/cli.js`;
   - `install.json` tem `commit` = SHA9;
   - as instalações `d2c2bbb` e `e733eb4` continuam intactas.
2. No checkout do lançador: `git pull --ff-only`, pin SHA9 em `tool.lock.json` e na dependência `enois-preview` do `package.json`, `npm install --package-lock-only --ignore-scripts`, `npm ci --ignore-scripts && npm run build && npm test && npm run check`, depois `lc` e `lp`. O diff deve tocar só `tool.lock.json`, `package.json` e `package-lock.json`.

### S7. Release
`gh release create v0.3.9 --title 0.3.9`, com notas PT/EN:
- o instalador de um comando;
- a receita no `qa` atual e a quebra com backends anteriores ao `1a3f9964`;
- os pins novos do exemplo.

Siga o S10 da 0.3.8 para o pacote de evidências revisadas mais o `.sha256`, sem logs brutos e com marcadores no lugar dos caminhos. Baixe de volta, rode `sha256sum -c` e `cmp`, e procure `/home/`, tokens e emails (`release-readback.json`).

### S8. Publicação da #806
1. Confira de novo que a ref `enois-preview-publication-lease` não existe no lançador.
2. Na config da #806, troque só o `toolCommit` para SHA9 e confira com um diff contra uma cópia anterior.
3. `ENOIS_PREVIEW_HOME=~/projects/enois/.local/issue806/.preview/installation enois-preview setup --config ~/projects/enois/.local/issue806/.preview/config.json`. Se ele pedir a confirmação interativa, pare e peça ao dono.
4. Com o mesmo `ENOIS_PREVIEW_HOME`, rode `enois-preview publish issue-806-precos-longos`. Grave a saída em `.preview/publish-0.3.9.log` e o JSON final em `.preview/publish-result.json`. Rode em segundo plano e espere terminar. Se falhar, siga as receitas 5 e 6 (`resume`), no máximo uma vez.
5. Faça o M7 do `EXECPLAN-publish-preview-806.md` privado: conferência do link a 390 px com evidências e `.preview/PR-como-verificar.md`, sem postar.

### S9. Limpeza e registros
- Remova a branch local e a remota depois de confirmar que ela é ancestral da `main` (`cleanup.json`).
- Se o publish avançou o origin do lançador, faça ff do checkout local.
- Atualize o Progress do `EXECPLAN-publish-preview-806.md` privado com M6 e M7.
- `$EV/release-0.3.9/executor-report.md` com:
  - o estado de K1 a K5, com comando, resultado observado e artefato de cada um;
  - os desvios e as lacunas;
  - a URL e o slug da #806;
  - o aviso de que os walkthroughs continuam na 0.3.8.

## Critérios de aceitação

As fontes são:
- **[R]** `recipe/StrictMediaSanitizer.java`, `recipe/test/StrictMediaSanitizerTests.java`, `recipe/prepare.ts` e `recipe/Dockerfile` na `d2c2bbb`;
- **[B]** `MediaMetadataSanitizer.java`, `MediaFfmpegRunner.java` e `MediaTemporaryFiles.java` do `enois-backend` em `a3a6da97`, e o commit `1a3f9964`;
- **[F]** o `build.log` da operação `3dec7303…` da #806;
- **[U]** as decisões do usuário: só o `qa` atual, release 0.3.9 e lançador incluídos.

Antes da entrega, confira de novo cada expectativa contra essas fontes, **separado** de conferir se a prova a demonstra. Registre comando, resultado observado e artefato. Uma suíte verde sozinha não fecha nenhum K. Uma lacuna fica escrita como lacuna.

**K1. A imagem compila com o backend `qa`** [R, B, F]
- **Contexto:** workspace do exemplo preparado com os pins do `qa` do S0.
- **Ação:** `npm run test:image`.
- **Resultado esperado:**
  - o teste passa;
  - o `build.log` mostra `StrictMediaSanitizerTests` e `MediaMetadataSanitizerTests` executados, com 0 falhas;
  - `local-build-proof.json` tem `readiness` `UP`, 2 contas e 9 mídias.
- **Discriminação:** na `d2c2bbb`, a mesma ação falha com `constructor MediaMetadataSanitizer … cannot be applied to given types` (S1). Uma correção que apagasse o `StrictMediaSanitizer` também compilaria, mas falharia no K2.

**K2. A fronteira estrita de mídia continua** [R]
- **Contexto:** imagem do K1.
- **Ação:** `StrictMediaSanitizerTests` dentro do build, mais `npm run test:media`.
- **Resultado esperado:**
  - PNG válido continua decodificável com 16 px de largura;
  - o mesmo PNG declarado como `image/jpeg`, um corpo que não é imagem e um `%PDF-` corrompido são recusados com a mensagem que contém `invalido`;
  - um áudio WebM válido perde `private-control-marker` e continua decodificável;
  - os contratos do `test:media` passam.
- **Discriminação:** o `MediaMetadataSanitizer` do backend, sozinho, devolveria os bytes originais para tipos sem limpeza definida e não confere a assinatura. As recusas acima só passam com a subclasse ativa no perfil `demo`. Registre no relatório que a prova é o teste dentro do build e o `test:media`.

**K3. O comportamento restante não regride** [R]
- `npm test`: 123 testes, 0 fail e 0 skip. Se a contagem for outra, explique antes de seguir.
- `npm run test:install`: 8.
- `npm run test:consumer`, com a mesma contagem do `npm test`, lida do `test.log` dele.
- `npm run test:capture` com o workspace do exemplo novo.
- `npm run check`.

**K4. Entrega** [U]
- `main` = `origin/main` = `v0.3.9^{commit}` = SHA9; tags anteriores sem mudança; PR `MERGED`.
- A release `0.3.9` foi lida de volta sem vazamentos.
- `current` → SHA9 pela instalação via `install.sh`.
- O pin do lançador é SHA9, sincronizado com o origin, e o diff toca só os três arquivos.
- A branch foi removida.

**K5. A #806 publicada mostra a correção** [U]
- **Contexto:** config da #806 com `toolCommit` = SHA9, e os mesmos commits e dados da tentativa anterior.
- **Ação:** `publish issue-806-precos-longos`, depois o roteiro de conferência do handoff a 390 × 844.
- **Resultado esperado:**
  - `status: "validated"`, com `url` e slug `issue-806-precos-longos-…`;
  - só a conta fictícia da #806 com login;
  - nas capturas, o título "Identidade visual completa…" com largura maior que zero e o orçamento terminando em "…";
  - `PR-como-verificar.md` escrito e não postado.
- **Discriminação:** antes da 0.3.9, a mesma publicação falhava no `localImage` (F). Um link validado sem as capturas não fecha o K5.

## Progress

- [x] S0 branch e baseline (2026-11-13): branch `fix/media-sanitizer-qa-backend`. O `qa` do backend já tinha avançado para `3fe25eaf` (contém `1a3f9964`); frontend `35e498b3`, design system `ecb8545`. Lease ausente (404). `$EV/release-0.3.9/baseline.json`.
- [x] S1 exemplo no `qa` e red (2026-11-13): pins trocados. `test:example` divergiu só no `canonicalDataSha256` (`0fd5764b…` → `8e66e081…`), por causa das migrações `V236__media_dimensions` e `V238__profile_appearance`; `observed` igual. Asserção atualizada, causa em `example-hash-change.json`. Red do construtor confirmado em `red.log`.
- [x] S2 green (2026-11-13). Primeiro bloqueio: com o construtor novo, `StrictMediaSanitizerTests` (2), `MediaMetadataSanitizerTests` (7), `DemoLocalStorageTests` (4) e `BlogFlowTests` (3) passam, mas `MediaStorageProxyTests.arquivoGrandeAcimaDoLimiteEmMemoriaTambemChegaAoBucket` falha (`Status expected:<201> but was:<400>`, `MEDIA_TOO_LARGE`). O teste do backend envia 41 MiB de áudio para cobrir o caminho acima de `MAX_IN_MEMORY` (40 MiB), e `recipe/prepare.ts:19` baixa `MAX_MEDIA_BYTES` para 20 MiB. O teste existe assim desde antes de `a3a6da97` (a #806 também quebraria). O estágio do frontend foi cancelado de novo antes do `typecheck`. Resolvido pela decisão "suíte completa com restrições abertas só nos testes" (veja Decisions). No caminho, uma tentativa teve dois testes do frontend por tempo esgotado (5 s) com o Maven em paralelo; a repetição passou com 1380 de 1380.
  - Green final: `test:image` com a suíte completa, 2555 testes do backend em 519 classes, 0 falhas e 1 pulado pelo próprio backend; `local-build-proof.json` com `readiness` `UP`, 2 contas e 9 mídias. `test:media` passou com `demoMediaCapRejected400`. Lacuna: essa guarda não foi observada falhando numa imagem sem a flag.
- [x] S3 documentação e versão (2026-11-13): `0.3.9`, CHANGELOGs, `RECIPES.md` (linha do `localImage`), seção nova no `VALIDATION.md`, `docs/validation/media-sanitizer-qa-0.3.9/local.json` e `release/public-files.json`.
- [ ] S4 validação final (em andamento; este arquivo congela aqui)
- [ ] S5–S9: registrados em `$EV/release-0.3.9/executor-report.md`

## Validation

Rode sobre o tree exato que será commitado, já com este plano congelado. Mova qualquer tentativa que falhar para `final-attempt<N>/`, sem contá-la como aprovação.

Com `ENOIS_PREVIEW_EVIDENCE=$EV/release-0.3.9/final` e `ENOIS_PREVIEW_EXAMPLE_WORKSPACE` apontando para o workspace do exemplo preparado no S1, rode, nesta ordem, os comandos abaixo. Todos devem sair com 0:
1. `npm ci --ignore-scripts`
2. `npm run build`
3. `npm run typecheck`
4. `npm test`: 123, 0 fail, 0 skip
5. `npm run check`
6. `npm run test:install`: 8
7. `npm run test:example`, num destino novo dentro de `final/`
8. `npm run test:image` (K1, K2)
9. `npm run test:media` (K2)
10. `npm run test:capture` (K3)
11. `npm run test:consumer` (K3)

Grave `$EV/release-0.3.9/final/validation.json` com o tree antes e depois (iguais) e as contagens observadas comparadas com o `local.json`.

**Paradas:**
- o red do S1 não aparece, ou aparece com outra mensagem;
- qualquer validação falha;
- o tree muda entre a validação e o commit;
- o merge não é fast-forward;
- a ref de lease existe no lançador;
- a instalação, o `setup` ou o `publish` da #806 falham depois de no máximo um `resume`;
- qualquer necessidade de tocar nas aplicações, nos bancos, nos walkthroughs ou na config padrão.
