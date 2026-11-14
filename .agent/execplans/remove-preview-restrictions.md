# Plano 0.4.0: tirar as restrições do enois-preview

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Purpose and success

A fonte normativa é `.agent/specifications/remove-preview-restrictions.md` (a "especificação"). Leia a especificação inteira antes do S1. Em caso de conflito, ela prevalece sobre este plano.

**Problema.** Cada versão recente existiu só para acompanhar mudanças das aplicações do Énóis:
- a 0.3.8 por causa de colunas novas;
- a 0.3.9 por causa de um construtor do backend, de um teste do backend de 41 MiB e de testes do frontend.

Mesmo assim, a #806 ainda falhou com `Detected resolved migration not applied to database: 277`, porque o perfil `demo` recusa migrações fora de ordem. O operador é dono do banco H2 local, que é descartável. A ferramenta deixa de impor política a ele.

**Sucesso:**
- o operador publica commits atuais das aplicações e um banco local real sem editar este repositório, sem repinar o lançador, sem parar o backend e sem responder prompts;
- toda checagem relaxada continua visível como aviso no array `warnings` do JSON final e numa linha `warning:` no stderr;
- só param a publicação o que impede o app de funcionar, o que impede a ferramenta de identificar a revisão e a falha de login das contas selecionadas.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, sem worktree.
  - A `main` está em `b41202c`. Ela contém os commits da 0.3.9 (`f42003a` e `b41202c`), que nunca recebeu tag nem release.
  - O `package.json` diz `0.3.9`.
  - O GitHub é **público**: não grave no repositório caminhos absolutos com nome de usuário, e-mails, segredos, IDs de conta nem valores de banco. Use `~`.
- **Pendências que entram nesta branch:** a especificação e este plano.
- **Baseline conhecido:** na 0.3.9, `npm test` passou com 123 testes e `test:install` com 8 (`docs/validation/media-sanitizer-qa-0.3.9/local.json`). As contagens finais vão mudar, porque testes de comportamento removido saem. Registre as contagens observadas.
- **Mapa do código por área da especificação:**
  - **Build:** `recipe/Dockerfile`, `recipe/prepare.ts`, `recipe/StrictMediaSanitizer.java`, `recipe/test/` (os dois arquivos Java), `recipe/application-demo.properties` e `runtime/start.ts:45` (flag `-Denois.preview.demo=true`).
  - **Upload:**
    - `src/upload-transport.ts:7` (`20_971_520`);
    - `runtime/upload-transport.ts:128` (`total>20_971_520`);
    - `recipe/java/DemoLocalStore.java:13-14` (`FILE_LIMIT` de 20 MiB, `TOTAL_LIMIT` de 256 MiB e `reserve`, chamado hoje pelo patch do controller em `recipe/prepare.ts:21`).
  - **Gateway:** `runtime/gateway.ts:11-16` (`demoBlocked`) e `:76`.
  - **Captura:**
    - `preview/capture.ts` (stop e start do serviço, `restoration.json`, `fuser`, `recover`, `sourceDigest`);
    - `preview/config.ts` (`captureConfig`, `validateConfig`, `installed`, `prerequisites`);
    - `recipe/SeedTool.java:98-99` (aborta em coluna desconhecida);
    - `shared/accounts.ts` (`@enois.invalid` e o limite de 1 a 20 contas);
    - `preview/cli.ts:11-25` (seleção interativa);
    - `preview/capture.ts:5-17` (`commits()` recusa repositório sujo).
  - **Identidade:**
    - `preview/publication.ts:81-95` (`toolCommit` e `verifyJournal`), `:165` (`toolCommit` em `Inputs`) e `:71` (`journalRecord` exige `toolCommit`);
    - `preview/installation.ts`;
    - `preview/remote.ts:63-75` (`refreshCheckout`, que confere o pin do lançador), `:165` (`deploy` roda `test` e `check`) e `:189-212` (lease).
  - **Setup:** `preview/cli.ts:90-110` (confirmação do plano gratuito e registro `installation`) e `preview/config.ts:44-50` (`installed`).
  - **Validação:**
    - `preview/validation.ts:69-137` (`validate`);
    - `preview/build.ts:7-37` (`verifyImage`) e `:68-98` (`validateLocal`);
    - `src/scenario.ts:176` (`machine.cpus !== 2`).
  - **Processo:** `test/integration/example.test.ts` (`canonicalDataSha256`), `example/prepare.ts` (gera config com `service`, `toolCommit` e `expectedIdentity`), `CHANGELOG.md`, `docs/en/CHANGELOG.md` e os guias em `README.md`, `docs/en/` e `docs/pt-BR/`.
- **Testes que falam de comportamento removido** e precisam ser reescritos ou removidos:
  - **Captura:** `test/capture-journey.test.ts` (restauração, serviço, coluna desconhecida, domínio `@enois.invalid`), `test/source-digest.test.ts` (recusa backend rodando), `test/fixtures/service-recorder.ts`, `test/fixtures/h2.ts`, `scripts/validate-capture.ts` e `scripts/validate-capture-recovery.ts` (`test:capture`).
  - **CLI:** `test/cli-journey.test.ts` (setup financeiro interativo, repositório sujo).
  - **Publicação:** `test/publication-journey.test.ts` (checkout de desenvolvimento recusado, instalação diferente recusada, restauração do backend).
  - **Validação e Worker:** `test/public-validation.test.ts` (a linha 111 diz que permissões, cookies e mídia impedem a validação), `test/scenario-journey.test.ts:79` (`machine:{cpus:4}` recusado).
  - **Upload:** `test/upload-transport.test.ts` e `test/integration/worker-upload.test.ts` (20 MiB).
  - **Mídia:** `scripts/validate-media-contracts.ts` e `test/integration/media-contracts.test.ts` (recusas estritas e o teto de 20 MiB + 1).
  - **Navegador:** `scripts/validate-example-browser.ts:26,67` usa `data-demo-ready`, que deixa de existir.
  - **Fluxos:** `test/integration/application-flows.test.ts:24` (`signupBlocked`; o signup continua desligado pelo backend).
- **Fora do alcance do executor.** A autorização é branch, `lc` e `lp`. Não faça nada disto, que fica para o operador depois do merge (veja Rollout and recovery):
  - merge, tag, release ou instalação;
  - mudanças no lançador privado (`~/projects/enois/.local/render-demo/launcher`);
  - mudanças na config da #806 (`~/projects/enois/.local/issue806/`);
  - publicações reais.
- **Não toque** nas aplicações (`~/projects/enois/*`), nos bancos delas, nos workspaces `public-walkthrough-*` nem em evidências anteriores.
- **Evidências:** `$EV` = `~/projects/enois/.local/preview-typescript-evidence/node24-consolidation`. Grave em `$EV/release-0.4.0/`.

## Decisions

- **As provas públicas K1 (#806 `validated`) e K5 (50 MB no link público) ficam com o operador, depois do merge.**
  - Elas exigem tag, instalação, repin único do lançador e publish real, e nada disso está autorizado aqui.
  - Substitutos locais: o K1L é uma migração fora de ordem sintética no build da imagem do exemplo; o K5L é um upload de 50 MB pela imagem local e pelo Worker do `miniflare`.
  - Consequência: a entrega do executor registra K1 e K5 como **não verificados publicamente**.
- **A prova da migração fora de ordem usa uma migração sintética só no teste.**
  - Na cópia de trabalho do backend fictício do exemplo, dentro do workspace de teste, entra uma migração `V<menor>__preview_out_of_order.sql` que cria uma tabela trivial. A versão fica abaixo da última versão aplicada no banco congelado.
  - Sem `out-of-order`, o boot falha com `Detected resolved migration not applied`. Com a configuração, ele sobe e a tabela existe.
  - Alternativa descartada: usar o banco privado da #806 no teste, que tocaria dados privados.
- **O que sai junto com o comportamento:** os testes e scripts que só provam a orquestração do serviço (`scripts/validate-capture-recovery.ts` e os casos de restauração em `test/capture-journey.test.ts` e `test/publication-journey.test.ts`).
  - Os que provam comportamento mantido ficam: lease de processo, integridade dos insumos congelados, reconciliação de ack remoto e cancelamento por sinal.
  - O `preview/service.ts` fica como ajudante do exemplo, e nenhum comando central depende dele.
- **O repin único do lançador para a 0.4.0 é obrigatório na implantação**, e a especificação não proíbe isso. As mudanças do Worker em `src/` só valem depois do repin: o limite de upload e o aviso de CPU. O que a especificação rejeita é o repin **automático**.

## Risks

- **O teto da Cloudflare é uma premissa.** A especificação assume 100 MB como teto do corpo de requisição no plano gratuito.
  - No S3, confira na documentação atual da Cloudflare e registre a URL e a data em `$EV/release-0.4.0/cloudflare-limit.md`.
  - Se o valor for outro, use o valor confirmado e registre o desvio na seção Progress.
- **`DemoLocalStore` sem reserva.** Sem o patch do controller, a reserva por upload some. O armazenamento precisa continuar correto com uploads simultâneos: sem arquivo parcial visível e sem contador negativo.
- **Login antes da hidratação.** Sem `data-demo-ready`, o `validate-example-browser` e a validação podem clicar antes do React hidratar. Troque a espera por um sinal observável do app, como o formulário responder ou a rede ficar ociosa. Não volte a aplicar o patch no frontend.
- **Cobertura perdida por engano.** A reescrita de testes grandes pode apagar casos de comportamento mantido. Antes de remover um teste, classifique-o em "comportamento removido pela especificação" ou "mantido". Registre a lista em `$EV/release-0.4.0/removed-tests.md`.
- **O boot do Codespace pode ficar mais lento** com migrações fora de ordem. É aceito pela especificação. Registre o tempo de readiness do `test:image`.
- **Revisões da 0.3.x** não têm garantia de `resume` (decisão da especificação). Não gaste esforço com compatibilidade de journal.

## Milestones

Siga TDD comportamental: para cada critério K abaixo, primeiro o teste no ponto público (CLI, gateway HTTP, Worker, imagem), depois o código.

### S0. Baseline
- **Ações:**
  - confira `git log -1` = `b41202c` na base da branch;
  - `npm ci --ignore-scripts && npm run build && npm test`;
  - grave a contagem e a duração em `$EV/release-0.4.0/baseline.json`.
- **Aceite:** baseline registrado.

### S1. Build da imagem sem testes e sem patches de restrição (K1L, K7)
- **Arquivos:**
  - `recipe/Dockerfile`: design system com build e pack, frontend com build e backend com `-DskipTests package`, como na especificação, seção 1;
  - `recipe/prepare.ts`: remova os patches listados na especificação e a cópia de `recipe/test`;
  - apague `recipe/StrictMediaSanitizer.java` e `recipe/test/`;
  - `recipe/application-demo.properties`: acrescente `spring.flyway.out-of-order=true` e `spring.flyway.validate-on-migrate=false`;
  - `runtime/start.ts`: tire `-Denois.preview.demo=true`.
- **Testes:**
  - `test/integration/image.test.ts`: a migração sintética do K1L, mais a asserção do K7 de que o `build.log` não executa testes;
  - `scripts/validate-example-browser.ts`: espera sem `data-demo-ready`.
- **Comando:** `ENOIS_PREVIEW_EXAMPLE_WORKSPACE=<workspace novo do test:example> npm run test:image`.
  - Esperado: passa.
  - O `build.log` não tem `Tests run:`, `vitest` nem `test:dist`.
  - A tabela da migração sintética existe no banco do container.
- **Red esperado do K1L antes da mudança nas propriedades:** `Detected resolved migration not applied to database`. Grave em `red-k1l.log`.

### S2. Avisos (infraestrutura)
- **O que muda:**
  - um coletor de avisos `{code, message}` por operação;
  - o campo `warnings` (sempre presente) no JSON final de `publish`, `resume`, `setup` e `source-digest`;
  - uma linha `warning: <message>` no stderr na hora em que o aviso surge.
- O formato vem da especificação, seção "Principle". Os códigos são estáveis, em kebab case.
- **Teste:** em `test/cli-journey.test.ts`, um comando sem nada a avisar devolve `warnings: []`.

### S3. Upload: um limite em todas as camadas, sem total compartilhado (K5L)
- **Confirmação primeiro:** confira o teto da Cloudflare (Risks).
- **Arquivos:**
  - `src/upload-transport.ts` e `runtime/upload-transport.ts`: o limite confirmado;
  - `recipe/java/DemoLocalStore.java`: o mesmo limite por arquivo, sem `TOTAL_LIMIT`, e funcionando sem a chamada de `reserve` do controller.
- As partes continuam com 8 MiB.
- **Testes:**
  - `test/upload-transport.test.ts`: um upload acima de 20 MiB e abaixo do limite atravessa as partes e chega a um único upload no backend; um acima do limite recebe 413;
  - `npm run test:worker-upload`: um upload de 50 MB pelo Worker nativo, pelo gateway e pelo armazenamento Java.

### S4. Gateway sem bloqueio de rotas do app (K6)
- **Arquivo:** `runtime/gateway.ts`. Remova `demoBlocked`. Mantenha a recusa de caminho com `;` e a reserva de `/__demo/`.
- **Teste:** numa suíte existente do gateway, como os casos do gateway de produção em `test/upload-transport.test.ts`, um `GET /api/support/x` chega ao backend falso, que responde com o próprio status. `/__demo/qualquer` continua 403.
- **Fluxos:** `test:flows` continua passando; o `signupBlocked` agora vem do backend.

### S5. Captura sem orquestração e contas relaxadas (K2, K3, K8)
- **Arquivos:**
  - `preview/capture.ts` e `preview/config.ts`: sem `service`, `expectedIdentity`, `restoration.json` e `fuser`;
  - avisos para arquivo em uso, `rede.lock.db` presente e arquivo que mudou durante a cópia;
  - o `sourceDigest` passa a funcionar com o backend rodando;
  - o lease de processo da captura fica;
  - `recipe/SeedTool.java`: a coluna desconhecida vira linha `warning\tTABLE.COLUMN` na saída. O `capture.ts` transforma essa linha em aviso, e a captura segue;
  - `preview/capture.ts:commits()`: repositório sujo vira aviso dizendo que só o `HEAD` entra;
  - `shared/accounts.ts`: pelo menos 1 conta, `email` opcional com geração de `account<N>@enois.invalid` e qualquer e-mail válido aceito;
  - `preview/cli.ts`: `--accounts ID[,ID...]` em `publish`. Sem terminal e sem contas, a mensagem cita `--accounts`;
  - espaço insuficiente vira aviso;
  - `example/prepare.ts`: a config gerada sai sem `service`, `expectedIdentity` e `toolCommit`.
- **Testes:** `test/capture-journey.test.ts`, `test/source-digest.test.ts`, `test/cli-journey.test.ts` e `test/publication-journey.test.ts`. Remova os casos de comportamento removido (Risks) e acrescente K2, K3 e K8.
- **Capture:** `npm run test:capture` passa depois de adaptar `scripts/validate-capture.ts` e remover `scripts/validate-capture-recovery.ts`.

### S6. Identidade, lançador, lease e setup (K4, K9)
- **Arquivos:**
  - `preview/publication.ts`: `toolCommit` fora da config obrigatória e de `Inputs` (identidade). O journal e o resultado registram o commit da ferramenta em execução, ou `null`;
  - um checkout de desenvolvimento publica com aviso;
  - `preview/remote.ts`: pin do lançador diferente vira aviso nomeando os dois commits. As checagens de `wrangler.jsonc` e do repositório continuam gates. O `deploy` roda só `npm ci --ignore-scripts` e `npm run build`;
  - `--force-lease` em `publish` e `resume`: apaga o lease de outra operação, registra isso no journal e em `warnings`. Sem a flag, nada muda;
  - `preview/cli.ts` e `preview/config.ts`:
    - o `setup` imprime o aviso do plano gratuito e não grava `installation`;
    - o `publish` não exige `setup` interativo;
    - `fuser` sai dos pré-requisitos;
    - lançador ou GHCR que não sejam privados viram aviso;
    - uma config 0.3.x carrega, com um aviso que lista os campos ignorados.
- **Testes:** `test/publication-journey.test.ts`, `test/cli-journey.test.ts` e `test/remote-publication.test.ts`.

### S7. Validação com gate mínimo (K6V)
- **Arquivos:**
  - `preview/validation.ts`: os gates são readiness `UP`, a identidade da revisão (`/__demo/runtime` e `/__demo/revision`) e o login de cada conta, com `/api/me`;
  - viram aviso, mas continuam rodando e indo para o registro: hash, bytes e MIME de mídia; decodificação no Chromium, pulada com aviso se faltar Chromium; permissões; cookies; leituras externas;
  - `preview/build.ts:verifyImage`: licenças, inventário de seed e mídia e design system viram aviso;
  - `src/scenario.ts`: CPUs diferentes de 2 registram log e não recusam.
- **Testes:**
  - `test/public-validation.test.ts`: reescreva o caso da linha 111. A permissão diferente, o cookie ausente e a mídia divergente produzem avisos e `validated`. Readiness diferente de `UP`, revisão errada e login falho continuam falhando;
  - `test/scenario-journey.test.ts:79`: a máquina com 4 CPUs registra.

### S8. Exemplo, contratos de mídia, versão e documentação
- **Testes de integração:**
  - `test/integration/example.test.ts`: tire `canonicalDataSha256` e mantenha as contagens;
  - `scripts/validate-media-contracts.ts` e `test/integration/media-contracts.test.ts`: tire as recusas estritas (`declaredAndActualSizeMismatchRejected400`, `typeMismatchRejected400`, `demoMediaCapRejected400`) e o teto de 20 MiB + 1. Mantenha os formatos aceitos e a recusa de travessia de caminho, que é do backend e do gateway;
  - acrescente o K5L local: 50 MB de áudio válido pela imagem.
- **Versão:** `package.json` e as duas ocorrências da raiz em `package-lock.json` passam a `0.4.0`.
- **Changelogs** (`CHANGELOG.md` e `docs/en/CHANGELOG.md`):
  - a seção `## 0.3.9 (2026-11-13)` vira `## 0.4.0 (<data da entrega>)`;
  - mantenha os itens que continuam verdadeiros: instalador de um comando, `enois-preview install`, Chromium no instalador, caminho manual e a mensagem de config ausente;
  - troque os itens da 0.3.9 sobre sanitizador, suíte completa e flag pelo que a especificação manda;
  - diga explicitamente que a `v0.3.9` nunca foi lançada.
- **Guias:** `README.md`, `docs/en/README.md` e, em `docs/en` e `docs/pt-BR`, os arquivos `TUTORIAL`, `RECIPES`, `CONCEPTS`, `FLOW` e `LLM`.
  - Descreva o comportamento novo e remova os remédios de recusas que deixaram de existir.
  - Cite pelo nome os campos ignorados (`service`, `toolCommit`, `installation`), as flags novas (`--accounts`, `--force-lease`) e o formato `warnings: [{code, message}]`.
- **Sem seção nova** no `VALIDATION.md` e sem `docs/validation/*/local.json` (especificação, seção 6).
- **Teste de distribuição:** confira se `release/public-files.json` lista algum arquivo removido e ajuste a lista. Esse arquivo é usado pelo teste de distribuição.

### S9. Validação final
- Detalhada em Validation.
- Antes dela, atualize Progress até o S9. A partir daí, este arquivo congela, e o relatório vai para `$EV/release-0.4.0/executor-report.md`.

## Critérios de aceitação

Fontes:
- **[S]** a especificação, nas seções citadas;
- **[F]** a falha real da #806 descrita no Purpose;
- **[B]** `application-qa.properties`, `application-hml.properties` e `application-prd.properties` do backend em `a3a6da97`, que têm `spring.flyway.out-of-order=true` e `spring.flyway.validate-on-migrate=false`.

Para cada K, o executor confere **separadamente**:
1. se a expectativa está correta frente às fontes;
2. se a verificação a demonstra.

Registre comando, resultado observado e artefato em `executor-report.md`. Uma suíte verde sozinha não fecha nenhum K. Lacuna fica escrita como lacuna.

**K1L. Migração fora de ordem sobe** [S §1, F, B]
- **Contexto:** imagem do exemplo cuja fonte do backend tem uma migração com versão abaixo da última aplicada no banco congelado.
- **Ação:** `npm run test:image`.
- **Esperado:** readiness `UP` e a tabela da migração sintética presente.
- **Discriminação:** sem as duas propriedades, o mesmo teste falha com `Detected resolved migration not applied` (`red-k1l.log`).
- **K1 público (#806 `validated`):** fica com o operador (Rollout).

**K2. Coluna de credencial avisa** [S §2, cenário 2]
- **Contexto:** banco de teste com `EXAMPLE_TOKEN` numa tabela que não é esvaziada.
- **Ação:** captura pelo CLI.
- **Esperado:** dado promovido e `warnings` com `TABLE.EXAMPLE_TOKEN`.
- **Discriminação:** na base `b41202c`, o mesmo caso falha com `Unrecognized authentication or integration column` (`test/capture-journey.test.ts:121`).

**K3. Captura com o backend rodando** [S §2, cenário 3]
- **Contexto:** config sem `service`, com um processo segurando o arquivo H2 aberto.
- **Esperado:**
  - o processo continua vivo e não recebeu sinal;
  - `warnings` traz o aviso de arquivo em uso;
  - a publicação segue.
- **Discriminação:** o processo continua vivo, então uma implementação que ainda chamasse `stop` seria detectada.

**K4. Config 0.3.9 carrega** [S §3, cenário 4]
- **Contexto:** config com `service`, `toolCommit` e `installation`.
- **Esperado:** o `publish` roda sem `setup` e emite um único aviso listando os três campos.
- **Discriminação:** na base, o `publish` exige o registro `installation` válido.

**K5L. Upload de 50 MB** [S §5, cenário 5]
- **Testes:**
  - `test:worker-upload`, pelo Worker nativo, o gateway e o armazenamento Java;
  - `test:media`, pela imagem local.
- **Esperado:** arquivo armazenado e legível.
- **Discriminação:** na base, 50 MB é recusado com `Limite de 20 MiB por arquivo.` (413) no Worker.
- **K5 público:** fica com o operador.

**K6. Rota antes bloqueada chega ao backend** [S §5, cenário 6]
- **Contexto:** gateway real com um backend falso.
- **Esperado:** `GET /api/support/x` recebe a resposta do backend, e `/__demo/x` recebe 403.
- **Discriminação:** na base, o gateway responde 403 com `Operação desabilitada na demonstração.` e não chama o backend. O teste conta as chamadas recebidas pelo backend falso.

**K6V. Gate mínimo da validação** [S §4]
- **Esperado:**
  - permissão diferente, cookie ausente e mídia divergente produzem avisos e o sucesso;
  - readiness diferente de `UP`, revisão errada e login falho continuam falhando.
- **Discriminação:** os dois lados são testados no mesmo arquivo.

**K7. Nenhum teste das aplicações roda no build** [S §1, cenário 7]
- **Esperado:** o `build.log` do `test:image` não tem `Tests run:`, `vitest` nem `test:dist`.
- **Verificação extra:** com um teste do backend que sempre falha, acrescentado só no workspace de teste, a imagem ainda monta.
- **Discriminação:** na base, a suíte do backend roda e derruba o build.

**K8. Seleção sem terminal** [S §2, cenário 8]
- **Ação:** `publish SCENARIO --accounts A,B` com stdin que não é TTY.
- **Esperado:** as contas A e B com logins gerados e distintos.
- **Discriminação:** na base, esse caso falha com a mensagem de terminal interativo.

**K9. `--force-lease`** [S §3, cenário 9]
- **Contexto:** lease de outra operação.
- **Esperado:**
  - com a flag, o lease é removido, o journal e `warnings` registram a tomada, e a publicação segue;
  - sem a flag, o comportamento atual fica igual: espera e recusa (`test/remote-publication.test.ts:51` continua passando).

**K10. Nada regride no que foi mantido** [S, "Unchanged behavior"]
- `npm test` passa.
- Ficam verdes os casos mantidos de lease de processo, integridade de insumos congelados, reconciliação de ack remoto e cancelamento por sinal.
- Os testes removidos estão listados e classificados em `removed-tests.md`.

## Progress

- [x] S0 baseline: 123 testes, 122 passaram e 1 falhou (`a service answer arriving after its timeout cannot promote a capture`, instável sob carga; passou 3 de 3 isolado). Evidência em `baseline.json` e `baseline.log`.
- [x] S1 build da imagem: red em `red-k1l.log` (`Detected resolved migration not applied to database: 1.5.`, zero marcadores de teste no `build.log`, imagem montada apesar do teste Java que sempre falha); green no `test:image`.
- [x] S2 avisos: `preview/warnings.ts`; `warnings` sempre presente no JSON final.
- [x] S3 upload: 100 MB confirmado em https://developers.cloudflare.com/workers/platform/limits/ (registro em `cloudflare-limit.md`). `DemoLocalStore` grava num arquivo temporário e move atomicamente, sem reserva nem total.
- [x] S4 gateway.
- [x] S5 captura.
- [x] S6 identidade, lançador, lease e setup.
- [x] S7 validação; o Worker registra máquinas sem 2 CPUs com log.
- [x] S8 exemplo, mídia, versão e documentação. Classificação dos testes removidos em `removed-tests.md`.
- [ ] S9 validação final: este arquivo congelou aqui, antes da validação. O resultado de cada comando, a comparação de contagens e cada K estão em `$EV/release-0.4.0/executor-report.md` e `$EV/release-0.4.0/final/validation.json`.

Desvios registrados no fim do S8:
- **TDD:** em S2, S3, S4 e no K9 do S6, o código de produção foi escrito antes de observar o red do teste novo; o teste do K9 passou na primeira execução. A discriminação desses K é provada rodando os testes novos contra a base `b41202c` num clone local, com o resultado em `executor-report.md`.
- **`test:capacity` removido:** `test/integration/capacity.test.ts`, `scripts/validate-capacity.ts` e o script do `package.json` saíram, porque só provavam o limite compartilhado de 256 MiB, que a especificação remove. A entrada histórica `docs/validation/typescript-0.2.0/public-capacity.json` fica intocada.
- **Documentação além da lista:** `docs/diagnostics/README.md` e `docs/diagnostics/installation.{en,pt-BR}.md` também mandavam preservar `restoration.json`, preencher `toolCommit` e fazer a confirmação inicial; foram corrigidos.
- **`test:effects` removido:** `test/integration/application-effects.test.ts`, `scripts/validate-delivery.ts` e `scripts/DeliveryProbe.java` provavam que o patch do `EmailService` trocava o envio dentro do processo (`demoTransportCalls` igual a 0). A especificação remove esse patch, e o e-mail fica desligado só por `spring.mail.*`, então o teste falharia por design. A frase correspondente saiu de `docs/diagnostics/README.md`.

## Validation

Rode sobre o tree exato que será commitado, já com este plano congelado. Use `ENOIS_PREVIEW_EVIDENCE=$EV/release-0.4.0/final` e `ENOIS_PREVIEW_EXAMPLE_WORKSPACE` apontando para o workspace preparado pelo passo 7.

Todos devem sair com 0, nesta ordem:
1. `npm ci --ignore-scripts`
2. `npm run build`
3. `npm run typecheck`
4. `npm test`: 0 fail e 0 skip. Registre a contagem e compare com o baseline do S0, explicando a diferença pelos testes removidos e acrescentados.
5. `npm run check`
6. `npm run test:install`
7. `npm run test:example`, num destino novo dentro de `final/`
8. `npm run test:image` (K1L e K7)
9. `npm run test:media` (K5L)
10. `npm run test:worker-upload` (K5L)
11. `npm run test:flows`
12. `npm run test:capture` (K3)
13. `npm run test:layers`
14. `npm run test:consumer`

Grave `$EV/release-0.4.0/final/validation.json` com o tree antes e depois (iguais), as contagens observadas e, para cada K, o comando, o resultado e o artefato.

Uma tentativa que falhar vai para `final-attempt<N>/` e não conta como aprovação. Se a causa estiver fora deste plano, pare e reporte.

**Paradas:**
- um red esperado (`red-k1l.log`) não aparece, ou aparece com outra mensagem;
- qualquer validação falha;
- o tree muda entre a validação e o commit;
- é preciso tocar nas aplicações, nos bancos, no lançador, na config da #806 ou nos workspaces `public-walkthrough-*`.

## Rollout and recovery

Isto **não** é trabalho do executor. São os passos do operador depois do merge, nesta ordem:
1. tag `v0.4.0` e release, com um changelog curto;
2. instalação pelo `install.sh` da tag;
3. **repin único** do lançador para a 0.4.0. Sem ele, o Worker continua com o limite de 20 MiB e a recusa de CPU;
4. publish da #806 para fechar K1 (`validated`) e K5 (50 MB no link público).

**Voltar atrás:** reinstalar a 0.3.8 (`e733eb4`) e repinar o lançador nela. As configs da 0.4.0 continuam válidas para a 0.3.8 só se ainda tiverem `service`, `toolCommit` e `installation`, porque a 0.4.0 ignora esses campos, mas não os apaga.
