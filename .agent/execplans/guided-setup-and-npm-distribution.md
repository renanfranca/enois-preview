# Plano 0.5.0: setup guiado, distribuição pelo npm e CI

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Purpose and success

A fonte normativa é `.agent/specifications/guided-setup-and-npm-distribution.md` (a "especificação"). Leia a especificação inteira antes do M1. Em caso de conflito, ela prevalece sobre este plano. As seções citadas como "§" são dela.

**Problema.** Hoje um operador novo segue à mão `docs/diagnostics/installation.*.md`:

- instala um commit por `install.sh`;
- gera o lançador com `scripts/prepare-launcher.js`;
- cria o repositório privado, comita e envia;
- implanta o Worker e cadastra cinco segredos em duas plataformas;
- edita `LAUNCH_ENABLED` e envia de novo;
- refixa `tool.lock.json` e `package.json` do lançador a cada versão.

O `enois-preview setup` só confere o que já existe. As releases são manuais, com a versão digitada no `package.json`, e não existe CI.

**Sucesso (observável):**

1. `npm install -g enois-preview` seguido de `enois-preview setup` leva um operador com contas próprias a uma infraestrutura privada pronta, com uma confirmação e sem editar, comitar ou enviar nada. A única etapa manual é criar o token fine-grained no navegador.
2. O `publish` refixa sozinho a versão do enois-preview no lançador.
3. Um `feat` ou `fix` que chega à `main` com build verde vira versão no npm e release no GitHub sem versão digitada.
4. Push e pull request rodam um CI de cerca de 5 minutos.
5. O código inteiro passa no `prettier:check`, com a formatação feita num commit próprio.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, **sem worktree**.
  - A `main` está em `ebc5aed` (especificação), sobre a tag `v0.4.0` (`7a3aef5`).
  - O GitHub é **público**: não grave no repositório caminhos com nome de usuário, e-mails, segredos, IDs de conta, nomes de repositórios privados nem valores de banco. Use `~`.
- **Sem retrocompatibilidade com a 0.4.0** (§Status). Não escreva código de migração nem de adoção de configuração, journal ou lançador antigos.
- **Baseline medido no planejamento (2026-11-15, máquina de 32 núcleos, `7a3aef5`):** `npm run build` 3 s; `node --test dist/test/*.test.js` 119 de 119 em 104 s; o teste mais lento leva 21 s (`CLI resume reconciles each lost acknowledgement...`). A suíte unitária precisa de `java`, `javac`, `git`, `flock` e do driver H2 2.5.252 (`test/fixtures/h2.ts:14`, variável `ENOIS_H2_JAR`).
- **Ferramentas locais disponíveis:** Seed4J CLI `0.6.0-experimental.8` instalado globalmente (canal `experimental`). A skill do Seed4J está em `.agents/skills/seed4j-cli`, com link em `.claude/skills/seed4j-cli`. Os dois diretórios estão em `.git/info/exclude` e **não podem** entrar no repositório (§2.2).
- **Mapa do código por área:**
  - **CLI e setup:** `preview/cli.ts` (argumentos, `setup`, `install`, home), `preview/config.ts` (`captureConfig`, `validateConfig`, `KNOWN`, `prerequisites`, `warnIgnoredFields`).
  - **Identidade da ferramenta:** `preview/installation.ts` (carimbo e `verifiedCommit`), `preview/publication.ts:94` (`runningTool`, aviso `unverified-tool`), `preview/publication.ts:85-88` (registro `tool` do journal), `preview/publication.ts:148` (`toolCommit` e `toolVerified` no resultado), `preview/publication.ts:61` (recusa da 0.3.x).
  - **Lançador:** `scripts/prepare-launcher.ts` (geração), `preview/remote.ts:66-81` (`refreshCheckout` e aviso `launcher-pin`), `preview/remote.ts:176-194` (`deploy`: `npm ci --ignore-scripts`, `npm run build`, `wrangler deploy`).
  - **Instalador por commit:** `install.sh`, `scripts/install-tool.ts`, `test/integration/install-tool.test.ts`, `test/fixtures/install-driver.ts`, `test/fixtures/stamp-tool.ts`, `test/fixtures/publication-home.ts` (`unstampedPublicationHome`), `test/distribution-journey.test.ts`.
  - **User-Agent:** `preview/validation.ts:19` e `scripts/validate-media-contracts.ts:35` (`enois-preview/0.3.1`).
  - **Worker:** `src/` usa `GITHUB_TOKEN`, `CALLBACK_SECRET`, `GITHUB_OWNER`, `GITHUB_REPOSITORY` e `LAUNCH_ENABLED`. O Worker não muda (§7).
  - **Testes com comandos simulados:** `test/fixtures/infrastructure.ts` é um executável que responde como `gh`, `docker`, `npx` e outros quando colocado no `PATH`. `test/cli-journey.test.ts:89` mostra o padrão (`controlledInfrastructure`, `FIXTURE_PREFLIGHT_LOG`).
  - **Lançador consumidor:** `test/integration/consumer-build.test.ts` testa o lançador gerado com dependência `codeload`.
  - **Documentação:** `README.md`, `docs/en/README.md`, `docs/{pt-BR,en}/{TUTORIAL,RECIPES,CONCEPTS,FLOW,LLM}.md`, `docs/diagnostics/{README.md,installation.pt-BR.md,installation.en.md}`, `CHANGELOG.md`, `docs/en/CHANGELOG.md`, `release/public-files.json`.
- **Referência só de leitura:** o fluxo de release do repositório `~/projects/seed4j-cli` (`release.config.cjs`, `.github/workflows/release.yml`, `scripts/release-request.cjs`, `test/workflows/`). Use para entender ideias. **Não copie arquivos de lá** (§Status).
- **Fora do escopo:** canal experimental, Sonar, Renovate, ESLint, outros módulos do Seed4J, infraestrutura compartilhada, generalização para outros projetos, Worker lendo o catálogo em tempo de execução, rotação de segredos, a investigação do 401, `add-scenario`, `pin-scenario` e `export-public`, e as suítes de integração no CI.

## Definitions

- **Infraestrutura:** o que um operador tem uma vez: lançador privado e branch, pacote GHCR, conta e Worker da Cloudflare, origem e segredos. Fica em `infrastructure.json` (§4.1).
- **Workspace:** aplicações, H2, driver, contas, mídias e diretório de estado. Fica no `config.json` do home.
- **Versão em execução:** o campo `version` do `package.json` da ferramenta que está rodando. Num checkout é `0.0.0-SNAPSHOT`.
- **Plano do setup:** a lista de recursos com `exists`, `create` ou `update` que o `setup` imprime antes de escrever (§5.3).
- **Fake de infraestrutura:** o executável de teste que simula `gh`, `docker`, `wrangler` e `npm` com estado num arquivo JSON temporário.

## Decisions

- **Commits separados com `lc` em três momentos.** A §2.2 exige um commit só de formatação, com o SHA dele em `.git-blame-ignore-revs`. O SHA só existe depois do commit. Por isso o executor comita com `lc` em três pontos:
  1. depois do M1: `lc "commit only the formatting setup"`;
  2. depois do M2: `lc "commit exactly the formatting changes with the message: style: format with prettier"`;
  3. no fim: o resto, incluindo `.git-blame-ignore-revs` com o SHA do segundo commit.

  Alternativa descartada: um commit só, que impede registrar o SHA. Consequência: ❗️ o PR **precisa** ser integrado com merge commit (como o PR #10). Squash ou rebase trocam o SHA e invalidam o `.git-blame-ignore-revs`. Isso fica registrado no Rollout.

- **Aceite real depois do merge, com autorização do mantenedor.** Os aceites 17 e 18 da §9 exigem uma release real no npm e criar repositório, Worker e segredos reais. A release só acontece com build verde na `main`, e o `setup` recusa criar lançador com versão não publicada (§5.5). O executor entrega tudo verificado de forma automatizada e deixa esses dois aceites como **não verificados**, com o roteiro no Rollout. Consequência: o plano termina com dois critérios explicitamente pendentes.
- **Medida local do CI em 4 núcleos.** O tempo do `ubuntu-latest` só aparece quando o PR rodar. O executor mede localmente com `taskset -c 0-3` como estimativa e registra as duas medidas separadas (planejada e observada). Se a estimativa passar de 5 minutos, para e consulta o mantenedor antes de cortar testes (§2).
- **O código do lançador vira um módulo da CLI.** A geração sai de `scripts/prepare-launcher.ts` e vai para `preview/launcher.ts`, usado pelo `setup` (criação) e pelo `publish` (refixação). Consequência: o script avulso sai (§3.2), e os dois comandos compartilham uma única definição do formato §5.5.

## Risks

- **`prettier-plugin-organize-imports` remove ou reordena imports.** Imports de efeito colateral ou só de tipo podem quebrar. Controle: o M2 só fecha com `typecheck` e `npm test` verdes no próprio commit de formatação.
- **Diff de formatação enorme** (146 arquivos medidos). Controle: commit isolado, feito antes de qualquer outra mudança.
- **Resolução de `wrangler` e `playwright` numa instalação global.** Hoje a CLI roda `npx --no-install wrangler` com `cwd` na raiz do pacote (`preview/config.ts:94`). Numa instalação global, as dependências ficam dentro do pacote. Controle: o teste de pacote do M6 roda `--version` e `--help` de uma instalação global num prefixo temporário. O M9 deve provar que o `setup` encontra o `wrangler` a partir de uma instalação empacotada.
- **Vazamento de segredo.** `run()` grava stdout e stderr em `logPath` (`preview/state.ts:23-62`). Controle: segredos só passam por `input` (stdin), nunca por argumento. Um teste do M9 procura o valor do segredo simulado em toda saída, log, journal e `infrastructure.json`, e falha se encontrar.
- **Fatos externos não confirmados** (§"External prerequisites"). Se um deles tornar impossível um contrato da especificação, o executor para e volta ao mantenedor (o M0 verifica primeiro).
- **`prepare: husky` em contextos sem Git.** Controle: o teste de pacote do M6 roda `npm pack` e a instalação a partir do tarball. O CI roda `npm ci`.
- **Hook `pre-commit` do husky no `lc`.** O `lc` roda num agente que comita. O hook roda `lint-staged`, que precisa do `node_modules`. Se o hook falhar, corrija a causa; nunca use `--no-verify`.

## Milestones

Cada marco termina com as validações dele verdes. Atualize o `Progress` nas fronteiras.

### M0. Baseline e fatos externos (só leitura)

- Rode `npm ci`, `npm run typecheck` e `npm test` e registre as contagens no `Progress`.
- Confirme na documentação oficial, sem nenhuma escrita remota:
  1. se o npm aceita configurar Trusted Publishing antes de o pacote existir;
  2. se existe API para liberar um pacote GHCR de conta pessoal aos Codespaces de um repositório;
  3. se uma conta Cloudflare nova precisa registrar o subdomínio `workers.dev` antes do primeiro deploy, e como o `wrangler` se comporta;
  4. os escopos do `gh` e os endpoints para segredos de Codespaces do usuário (`/user/codespaces/secrets`), incluindo como restringir a um repositório;
  5. se o token do `gh` com `write:packages` serve para `docker login ghcr.io`;
  6. como `wrangler secret list` e `wrangler secret put` se comportam com um Worker que ainda não existe.
- Registre cada resposta, com a URL da fonte, numa seção nova `## Lessons learned` no fim deste plano. Se alguma resposta tornar impossível um contrato, pare e consulte o mantenedor.
- **Aceite:** baseline verde registrado e as seis respostas com fonte.

### M1. Configuração da formatação gerada pelo Seed4J (§2.2)

- Gere num diretório vazio fora do repositório (por exemplo, `$CLAUDE_JOB_DIR/tmp` ou `mktemp -d`):
  `seed4j apply init --no-commit --project-path <vazio> --project-name "Enois Preview" --base-name enoisPreview --node-package-manager npm`,
  e depois `seed4j apply prettier --no-commit --project-path <vazio>`. Confira antes que `seed4j --version` é do canal `experimental` e a mais nova (`npm view seed4j-cli dist-tags.experimental`).
- Copie para o repositório: `.editorconfig`, `.gitattributes`, `.npmrc`, `.prettierrc`, `.prettierignore`, `.lintstagedrc.cjs` e `.husky/pre-commit`.
- Ajustes obrigatórios:
  - `.prettierignore`: acrescente `dist` e `docs/validation`;
  - `.lintstagedrc.cjs`: inclua `ts`, `js`, `cjs` e `mjs`;
  - `package.json`: mantenha todo o conteúdo e acrescente só as `devDependencies` geradas e os scripts `prettier:check`, `prettier:format` e `prepare`, com as versões exatas geradas.
- Nunca rode `seed4j apply` dentro do repositório. Não copie `.seed4j/`.
- `npm install` para atualizar o `package-lock.json`.
- **Validação:** `npx --no-install prettier --version` imprime a versão gerada; `git status` lista só os arquivos acima, `package.json` e `package-lock.json`; `git check-ignore .agents .claude` confirma que continuam ignorados.
- **Commit:** `lc "commit only the formatting setup"`.

### M2. Formatação do repositório inteiro

- `npm run prettier:format`.
- `npm run typecheck` e `npm test` devem passar. Se o `organize-imports` quebrar algo, ajuste só o necessário para compilar sem mudar comportamento, e registre o caso em `Lessons learned`.
- `npm run prettier:check` deve sair com 0.
- **Commit:** `lc "commit exactly the formatting changes with the message: style: format with prettier"`. Confira com `git show --stat HEAD` que só há formatação e que a mensagem é exatamente essa.
- Crie `.git-blame-ignore-revs` com o SHA completo desse commit e um comentário de uma linha. Ele entra no commit final.

### M3. Versão em execução e identidade da ferramenta (§1.1, §3.3)

- `package.json` e `package-lock.json` em `0.0.0-SNAPSHOT`.
- Novo módulo compartilhado com a versão lida do `package.json` da raiz do pacote e a constante `USER_AGENT = enois-preview/<versão>`. Use nos dois lugares que hoje dizem `0.3.1`.
- `enois-preview --version` imprime a versão e sai com 0.
- O journal grava `tool: { version }`. O resultado final traz `toolVersion` no lugar de `toolCommit` e `toolVerified`.
- `journalRecord` recusa journal sem `toolVersion` com a mensagem exata da §3.3. A recusa da 0.3.x (`inputs.toolCommit`) é absorvida por essa regra.
- **Testes:** `--version` imprime `0.0.0-SNAPSHOT` num checkout; o User-Agent observado por um servidor de teste é `enois-preview/0.0.0-SNAPSHOT`; um journal sem `toolVersion` recusa com a mensagem exata; um publish novo grava `toolVersion`.
- **Validação:** `npm run typecheck`, `npm test`.

### M4. Remoção do instalador por commit (§3.2)

- Remova `install.sh`, `scripts/install-tool.ts`, o comando `install` de `preview/cli.ts` (ajuda e validação de argumentos), `preview/installation.ts`, o uso de `verifiedCommit` e `runningTool` com o aviso `unverified-tool`, e `tar` das dependências se ficar sem uso.
- Remova ou reescreva os testes e fixtures ligados: `test/integration/install-tool.test.ts`, `test/fixtures/install-driver.ts`, `test/fixtures/stamp-tool.ts`, os trechos de `test/distribution-journey.test.ts`, `test/publication-journey.test.ts`, `test/remote-publication.test.ts` e `test/fixtures/publication-home.ts` que dependem do carimbo. O script `test:install` sai do `package.json`.
- Atualize `release/public-files.json` para não citar arquivos removidos.
- **Testes:** `enois-preview install x` responde que o comando não existe, com a ajuda; `--help` não cita `install`; nenhuma saída de publish traz `unverified-tool`.
- **Validação:** `npm run typecheck`, `npm test`, e `git grep -n "install-tool\|verifiedCommit\|unverified-tool\|install.json"` sem resultados fora de `.agent/` e `docs/validation/`.

### M5. Pacote npm (§3.1)

- Tire `"private": true`. Acrescente `prepack` que roda `npm run build`.
- `wrangler` e `playwright` vão para `dependencies`. `typescript`, `esbuild`, `miniflare` e o ferramental de release ficam em `devDependencies`.
- `files` vira a lista exata da §3.1, com exclusão de `dist/test`.
- Novo teste de pacote (script `test:package`) que:
  1. roda `npm pack` num diretório temporário;
  2. instala o tarball com `npm install -g --prefix <temporário>`;
  3. roda `enois-preview --version` e `--help` desse prefixo;
  4. compara a lista empacotada com a lista permitida e falha se faltar arquivo de execução (por exemplo `dist/preview/cli.js`, `recipe/SeedTool.java`, `runtime/DemoCredentials.java`) ou se aparecer caminho excluído (`test/`, `dist/test/`, `docs/validation/`, `VALIDATION.md`, `.agent/`, `.github/`).
- **Validação:** `npm run test:package` sai com 0. Prove que o teste falha: com `VALIDATION.md` incluído de propósito, ele falha; desfaça.

### M6. Configuração separada (§4)

- `infrastructure.json` em `~/.config/enois-preview-ts/` (modo `0600`, `format`, campos `repository`, `branch`, `registry`, `worker`, `origin` e `cloudflareAccountId`), com `ENOIS_PREVIEW_INFRASTRUCTURE` para outro caminho.
- O `config.json` do home guarda só o workspace. `publish`, `resume` e `source-digest` combinam os dois.
- Sem `infrastructure.json`: `Infrastructure missing. Run enois-preview setup first.`, sem criar nada.
- Campos que o contrato do workspace não define, inclusive os de infraestrutura, geram uma vez o aviso `ignored-config-fields`.
- Ajuste `KNOWN` e `validateConfig` em `preview/config.ts` e a carga em `preview/cli.ts`.
- **Testes:** publish sem `infrastructure.json` sai com 1, mensagem exata, e não cria `state`; um workspace com `repository` gera `ignored-config-fields` citando `repository` e usa o valor do `infrastructure.json`; o arquivo é criado com modo `0600`.
- **Validação:** `npm run typecheck`, `npm test`.

### M7. Lançador no formato novo e refixação automática (§5.5, §6.1)

- `preview/launcher.ts` gera o formato da §5.5: `enois-preview` na versão exata em execução, `wrangler` na versão exata da dependência da ferramenta, lockfile com `--ignore-scripts`, sem `tool.lock.json` e sem script que compile o enois-preview. Ele também detecta "outro formato".
- Uma consulta `npm view enois-preview@<versão> version` decide se a versão está publicada. Sem publicação, a mensagem é exatamente a da §5.5.
- `preview/remote.ts`:
  - `refreshCheckout` recusa lançador em outro formato, antes de qualquer escrita;
  - antes do deploy, dentro do lease, refixa dependência e lockfile num commit da ferramenta, registrado como intent do journal para o `resume` reconciliar;
  - `deploy` não roda mais `npm run build` do lançador, só `npm ci --ignore-scripts` e o `wrangler deploy`;
  - o aviso `launcher-pin` sai.
- Remova `scripts/prepare-launcher.ts` e reescreva `test/integration/consumer-build.test.ts` para o formato novo (dependência de tarball local gerado por `npm pack`, `npm ci --ignore-scripts` e `wrangler deploy --dry-run`).
- **Testes:** lançador fixado em outra versão recebe um único commit da ferramenta com a versão nova antes do deploy; um `resume` depois de interrupção entre o commit e o deploy não cria segundo commit; um lançador com `tool.lock.json` faz o publish parar antes de qualquer push; versão `0.0.0-SNAPSHOT` para com a mensagem exata antes de qualquer escrita no lançador.
- **Validação:** `npm run typecheck`, `npm test`, `npm run test:consumer` (integração local, fora do CI).

### M8. Setup guiado (§5)

- **Fake de infraestrutura com estado:** amplie `test/fixtures/infrastructure.ts` (ou crie um fixture novo ao lado) para simular, com estado num JSON temporário, `gh` (`api user`, `repo view`, `repo create`, `api` de segredos de Codespaces, `auth status`, `auth token`), `git push` para o repositório simulado, `docker login`, `wrangler` (`whoami`, `deploy`, `secret list`, `secret put` lendo stdin), `npm view` e `playwright install`. Ele registra cada chamada num log para as asserções.
- **Interface §5.1:** flags, padrões derivados do login, `--account` obrigatório com várias contas, flag que contradiz `infrastructure.json` para o setup.
- **Plano e consentimento §5.3:** logins antes do plano, cada um com a própria confirmação e sem efeito do `--yes`; plano no stderr; confirmação única; `--yes`; sem terminal e sem `--yes`, sai com 1, com a mensagem exata, e sem escrever nada; prompts de segredo exigem terminal mesmo com `--yes`.
- **Etapas §5.4 na ordem:** logins, lançador (criação ou conferência, outro formato para), Worker com `LAUNCH_ENABLED=false` e origem, segredos, ativação, sem exigir GHCR, gravação local sob o lock e aviso `free-plan`. Chromium depois da confirmação; falha vira `browser-missing`.
- **Segredos §5.6:** nunca sobrescrever; incluir o lançador nos repositórios selecionados de um segredo existente sem regravar o valor; `GITHUB_TOKEN` por prompt oculto, verificado listando os Codespaces do lançador antes de gravar, nunca o token do `gh`; segredo de callback com o arquivo pendente `0600` e as três situações da §5.6; valores sempre por stdin.
- **Saída §5.7:** JSON com `status: "configured"`, campos de infraestrutura, `created`, `updated` e `warnings`; gates exatamente os listados; interrupção pelo contrato atual.
- Para testes que precisam de terminal, use `script --return --quiet --command` como `test/cli-journey.test.ts:202` já faz.
- **Validação:** `npm run typecheck`, `npm test`. Cada aceite de 1 a 9 da §9 tem um teste (ver `Validation`).

### M9. Acesso do GHCR aos Codespaces e regra de compatibilidade (§6.2, §6.3)

- Conforme o M0: se houver API, o `publish` libera o pacote ao lançador depois do primeiro push; se não houver, emite `registry-codespaces-access` com a URL e a ação, só quando o pacote foi criado nesta operação.
- Escreva a regra da §6.3 na seção do mantenedor (M12).
- **Teste:** com o fake de registro sem o pacote, o primeiro publish emite o aviso (ou faz a chamada da API); um segundo publish com o pacote já existente não emite.
- **Validação:** `npm test`.

### M10. Release (§1)

- `release.config.cjs` (ou equivalente) com `branches: ['main']`, `tagFormat: 'v${version}'`, preset `conventionalcommits`, regra do patch manual, gerador de notas, publicação npm e release do GitHub. Sem `@semantic-release/git` e sem Release Drafter.
- Scripts de qualificação e recuperação testáveis por `node --test`, sem rede: versão estável, `main` atual, build verde de push, head já marcado (manda usar `recover`), evento ou branch errados, fork, pedido de recuperação válido e inválido.
- `.github/workflows/release.yml` com os jobs `qualify`, `publish` e `recover`, `permissions: {}` no topo, `id-token: write` só em `publish` e `recover`, guarda `github.repository == 'renanfranca/enois-preview'`, concorrência sem cancelamento, `NPM_CONFIG_PROVENANCE=true` e `npm version <versão> --no-git-tag-version` só no checkout efêmero.
- `commitlint.config.cjs` com `@commitlint/config-conventional` e limites de tamanho desligados. Dependências exatas (`.npmrc` com `save-exact=true` já veio no M1).
- **Validação:** `npm run test:release` (novo script) sai com 0; `npx --no-install commitlint --from v0.4.0 --to HEAD` passa nos commits deste trabalho.

### M11. CI (§2)

- `.github/workflows/build.yml` (nome `build`) em push e PR para `main` e `workflow_dispatch`, `contents: read`, `persist-credentials: false`, `timeout-minutes: 15`, com os passos da §2 na ordem:
  1. `actionlint` de versão exata com sha256 conferido;
  2. Node na versão exata da família de `.nvmrc` e Java 25 Temurin;
  3. `npm ci` e `prettier:check`;
  4. `commitlint` no intervalo;
  5. `typecheck`;
  6. `npm test` com o H2 2.5.252 baixado do Maven Central com sha256 conferido e passado por `ENOIS_H2_JAR`;
  7. `test:release` e `test:workflows`;
  8. `test:package`.
- Script `test:workflows` com a política da §2.1: actions fixadas por SHA completo, permissões explícitas mínimas, `id-token: write` só em `publish` e `recover`.
- Um script local que roda `actionlint` igual ao CI (por exemplo `tests-ci/lint-workflows.sh`).
- **Medida:** rode a sequência do CI (`npm ci` até `test:package`) com `taskset -c 0-3` e registre o tempo como estimativa. Acima de 5 minutos, pare e consulte o mantenedor (§2).
- **Validação:** script de `actionlint` sai com 0; `npm run test:workflows` sai com 0; prove que a política falha com uma action fixada por tag (por exemplo `@v4`) num arquivo temporário de teste.

### M12. Documentação (§1.4, §8)

- **Changelog:** nota no topo de `CHANGELOG.md` e `docs/en/CHANGELOG.md` apontando para as releases do GitHub; histórico intacto abaixo.
- **README e guias em pt-BR e en:** instalação por `npm install -g enois-preview`; `setup` guiado com o plano, `--yes`, as flags e os padrões; separação entre infraestrutura e workspace; criação manual do token com as permissões exatas; os casos em que o setup para com instruções; remoção de `install.sh`, `enois-preview install`, `prepare-launcher`, `tool.lock.json` e `launcher-pin`. Os nomes contratuais aparecem exatamente: `infrastructure.json`, `ENOIS_PREVIEW_INFRASTRUCTURE`, `toolVersion`, `--yes`, `ignored-config-fields`, `browser-missing`, `registry-codespaces-access`.
- **`docs/diagnostics/installation.*`:** o procedimento manual vira o setup guiado.
- **Seção do mantenedor** (por exemplo em `docs/{pt-BR,en}/RELEASING.md` ou numa seção do README): Conventional Commits, a tabela da §1.2, release automática e manual, `recover`, configuração única do Trusted Publisher, regra de compatibilidade da §6.3, e o PR integrado com merge commit por causa do `.git-blame-ignore-revs`.
- **Validação:** `git grep -n "install.sh\|enois-preview install\|tool.lock\|launcher-pin\|prepare-launcher\|codeload" -- '*.md' ':!.agent' ':!docs/validation' ':!CHANGELOG.md' ':!docs/en/CHANGELOG.md'` sem resultados; links relativos dos arquivos tocados resolvem; nenhum caminho com nome de usuário, e-mail ou ID de conta (`git grep -nE "/home/|@gmail|[a-f0-9]{32}" -- '*.md' ':!docs/validation'`).

### M13. Validação final e auditoria

- Rode a validação final completa (`Validation`).
- Para cada critério da tabela de aceite, registre no `Progress` o comando, o resultado observado e o teste que prova o critério. Marque como não verificado o que não foi provado (no mínimo os aceites 17 e 18 e a medida real do CI).
- Releia a especificação e confira cada MUST e MUST NOT contra o workspace final, inclusive as proibições: nada de `.seed4j/`, `.agents/` ou `.claude/` no Git; nenhum segredo em log, journal ou `infrastructure.json`; nenhum arquivo copiado do `seed4j-cli`.
- Grave a evidência sanitizada em `docs/validation/guided-setup-0.5.0/local.json` (contagens, tempos, estimativa do CI e aceites verificados).
- **Commit final:** `lc`, depois `lp` (conforme o handoff).

## Progress

- [x] M0 baseline e fatos externos (2026-11-15): `npm ci`, `typecheck` e `npm test` verdes, 119 de 119 em 107 s. Seis respostas em `Lessons learned`.
- [x] M1 configuração da formatação (commit 1 `d8d89e3`): Seed4J `0.6.0-experimental.8` (mais nova do `experimental`), prettier 3.9.10, husky 9.1.7, lint-staged 17.6.0. `husky` fora do Git imprime `.git can't be found` e sai com 0.
- [x] M2 formatação (commit 2 `f0d5740`, `style: format with prettier`, 135 arquivos): `typecheck`, `npm test` (119 de 119) e `prettier:check` verdes nesse commit. `.git-blame-ignore-revs` criado com o SHA completo; entra no commit final.
- [x] M3 versão em execução e `toolVersion`: `preview/version.ts` (`VERSION`, `USER_AGENT`); `--version`; journal `tool: { version }`; resultado `toolVersion`; journal sem `tool.version` (inclusive 0.3.x e 0.4.0) recusa com a mensagem exata da §3.3. O aviso `launcher-pin` saiu aqui, porque dependia do commit da ferramenta. Testes: `--version prints the running version...`, `independent HTTP sessions ... User-Agent headers`, `CLI resume of a journal without toolVersion...`, `publish and resume record the running toolVersion...`. Suíte 119 de 119.
- [x] M4 remoção do instalador por commit: `install.sh`, `scripts/install-tool.ts`, `preview/installation.ts`, comando `install`, `test:install` e fixtures removidos; `install` vira `Unknown command install. Choose setup, publish, resume or source-digest. Run enois-preview --help.` `tar` continua, porque `publication.ts` extrai `git archive`. Suíte 116 de 116; `git grep` só acha documentação (M12).
- [x] M5 pacote npm e `test:package`: sem `private`, `prepack`, `wrangler` e `playwright` em `dependencies`, `files` igual à §3.1. `npm run test:package` sai com 0 (instalação global num prefixo temporário, `--version`, `--help`, lista permitida); com `VALIDATION.md` incluído de propósito, falha com `excluded paths present in the package` (desfeito). O teste antigo do `cli-journey` deixou de empacotar.
- [x] M6 configuração separada: `preview/infrastructure.ts` (`infrastructure.json`, `ENOIS_PREVIEW_INFRASTRUCTURE`, campos da §4.1 com `worker`); `publish`, `resume` e `source-digest` param com `Infrastructure missing. Run enois-preview setup first.` antes de ler o workspace; campos fora do contrato do workspace geram `ignored-config-fields`, e a infraestrutura sempre vence. Fixture: `test/fixtures/operator.ts` grava um `infrastructure.json` por processo de teste. Suíte 118 de 118. O modo `0600` é provado pelo setup (M8).
- [x] M7 lançador novo e refixação automática: `preview/launcher.ts` (geração da §5.5, `launcherVersion`, `requirePublished`, `repinLauncher`). `Publisher.checkLauncher` roda antes do build e do lease (outro formato e versão não publicada param sem nenhuma escrita no lançador, nem o lease); `Publisher.pinLauncher` roda dentro do lease, antes de registro, configuração e deploy, com intent `launcherPin` no journal. O deploy só roda `npm ci --ignore-scripts` e `wrangler deploy`. `scripts/prepare-launcher.ts` saiu; `test:consumer` reescrito e verde (pacote local por `npm pack`, `npm ci --ignore-scripts`, `wrangler deploy --dry-run`).
- [x] M8 setup guiado: `preview/setup.ts` (etapas da §5.4, plano no stderr, consentimento, segredos da §5.6 por stdin, arquivo pendente `0600`), flags da §5.1 no CLI, `validateWorkspace` e `workspacePrerequisites` em `config.ts` (o setup não exige mais o pacote GHCR). Fake com estado em `test/fixtures/infrastructure.ts` (`gh api -i`, `gh secret set`, `docker login`, `wrangler`, `npm`, `playwright`, `git` registrado). Jornada `test/setup-journey.test.ts` com 16 testes, incluindo os aceites 1 a 7, 8c e 9 e os dois testes de interrupção portados do `cli-journey`. Suíte 132 de 132. ❗️ Neste marco o código de produção foi escrito antes da primeira execução vermelha dos testes; os testes partem de estados que distinguem o erro plausível (segredos pré-existentes, lado único sem arquivo pendente, token rejeitado três vezes).
- [x] M9 acesso do GHCR: sem API (M0.2), o `Publisher.registry` consulta o pacote antes do primeiro push, grava `packageCreated` no intent e emite `registry-codespaces-access` com a URL de configurações e a ação exata depois da confirmação. Testes no `remote-publication`: pacote criado nesta operação emite um aviso; pacote existente não emite. A regra da §6.3 entra na documentação do mantenedor (M12). Suíte 133 de 133.
- [x] M10 release: `scripts/release-policy.ts` (funções puras `stableVersion`, `releaseType`, `qualify`, `recoveryRequest` e modo CLI `qualify`/`recover` com `git` e `gh`, saída em `$GITHUB_OUTPUT`), `release.config.cjs` (`main`, `v${version}`, `conventionalcommits`, regra de `revert`, patch forçado por `ENOIS_FORCE_PATCH`, npm, `@semantic-release/exec` com `test:package` e `npm pack --dry-run`, GitHub sem comentários; sem `@semantic-release/git`), `commitlint.config.cjs`, `.github/workflows/release.yml` (`qualify`, `publish`, `recover`; `permissions: {}`; guarda do repositório; concorrência `release` sem cancelamento). `npm run test:release` 10 de 10, incluindo a tabela da §1.2 passada pelo `commit-analyzer` real (falhou sem a regra de `revert`). `commitlint --from v0.4.0 --to HEAD` sai com 0. ❗️ Primeira publicação: ver Rollout 3.
- [x] M11 CI: `.github/workflows/build.yml` na ordem da §2, `scripts/workflow-policy.ts` e `test/workflows/workflow-policy.test.ts` (4 testes; falhou com um workflow temporário em `actions/checkout@v4`), `tests-ci/lint-workflows.sh` (actionlint 1.7.12 com sha256) sai com 0. Medida com `taskset -c 0-3`: 123 s no total (`npm test` 97 s), abaixo de 5 minutos; estimativa local com cache quente.
- [x] M12 documentação: README e guias pt-BR e en (instalação pelo npm, setup guiado, `infrastructure.json`, `ENOIS_PREVIEW_INFRASTRUCTURE`, `toolVersion`, `--yes` e flags, `ignored-config-fields`, `browser-missing`, `registry-codespaces-access`, nota de remoção), `docs/diagnostics/installation.*` reescritos, `docs/{pt-BR,en}/RELEASING.md` (tabela, CI, release automática e manual, `recover`, primeira versão e Trusted Publisher, regra da §6.3, merge commit e `.git-blame-ignore-revs`), nota no topo dos dois CHANGELOGs. `example/prepare.ts` não grava mais campos de infraestrutura. Links relativos conferidos (só duas âncoras antigas no histórico congelado). Grep de privacidade sem caminho de usuário, e-mail ou ID de conta novos.
- [x] M13 validação final (2026-11-15): todos os comandos de `Validation` saíram com 0 (`npm test` 133 de 133; `test:consumer` 2 de 2 depois de tirar dotfiles do `release/public-files.json`, que o exportador recusa). Evidência em `docs/validation/guided-setup-0.5.0/local.json`. Auditoria: nada de `.seed4j/`, `.agents/` ou `.claude/` no Git; `infrastructure.json` só com os seis campos da §4.1; versão `0.0.0-SNAPSHOT`; nenhum arquivo copiado do `seed4j-cli`. Aceites 1 a 14 e 16 cobertos pelos testes citados nos marcos; **não verificados:** 15 (tempo real do CI), 17 e 18 (dependem do merge e da primeira release).

## Validation

### Validação final (obrigatória antes do commit final)

Todos devem sair com 0:

```sh
npm ci
npm run prettier:check
npm run typecheck
npm test
npm run test:release
npm run test:workflows
npm run test:package
./tests-ci/lint-workflows.sh
npx --no-install commitlint --from v0.4.0 --to HEAD
npm run test:consumer
git status --porcelain --untracked-files=all
```

O último deve listar só as mudanças deste trabalho. `.agents/`, `.claude/` e `.seed4j/` não podem aparecer.

### Obrigações do executor

- **Expectativa e prova são verificações separadas.** Para cada critério, confira primeiro se a expectativa está certa contra a seção citada da especificação. Depois confira se o teste distingue o resultado certo de um errado plausível. Exemplo: o teste de "não sobrescreve segredo" precisa começar com um segredo existente e provar que nenhum `secret put` desse nome aconteceu; um teste sem segredo prévio passaria de qualquer jeito.
- **Registre evidência por critério:** comando, resultado observado e o teste ou artefato. Uma suíte verde sozinha não prova cada critério.
- **Antes da entrega,** registre lacunas de cobertura, verificações que falharam e critérios não verificados. Não apresente como satisfeito um critério com lacuna.

### Critérios de aceite (planejados; nada aqui foi observado ainda)

| #   | Fonte      | Contexto → ação → resultado esperado                                                                                                                                                                                              | Verificação planejada                                                    | Evidência esperada                                                           |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | §5.4, §5.6 | Fake vazio e terminal → `setup`, responder sim e informar um token válido → repositório, arquivos do lançador, Worker, cinco segredos e `LAUNCH_ENABLED=true`, nessa ordem; `infrastructure.json` sem valores de segredo          | Novo teste no M8 com o log de chamadas do fake                           | Ordem das chamadas no log; arquivo sem o valor do segredo                    |
| 2   | §5.2       | Infraestrutura completa → `setup` de novo → nenhuma escrita remota e todos os recursos `exists`                                                                                                                                   | Novo teste no M8                                                         | Log sem `repo create`, `secret put`, `deploy` ou push                        |
| 3   | §5.3       | Sem terminal e sem `--yes`, faltando recursos → `setup` → saída 1 com a mensagem exata, nada escrito localmente ou remotamente                                                                                                    | Novo teste no M8                                                         | stderr exato; log sem escritas; nenhum arquivo novo no home                  |
| 4   | §5.3       | `--yes`, sem terminal, `GITHUB_TOKEN` ausente → `setup` → para antes de qualquer escrita, citando `GITHUB_TOKEN`                                                                                                                  | Novo teste no M8                                                         | Log sem escritas; mensagem cita o nome                                       |
| 5   | §5.6       | `CALLBACK_SECRET` já existe e um segredo de Codespaces existe sem o lançador → `setup` → nenhum `secret put` desses nomes; o lançador é incluído na seleção sem regravar o valor                                                  | Novo teste no M8                                                         | Log com a inclusão do repositório e sem gravação de valor                    |
| 6   | §5.6       | (a) interrupção depois do lado do Worker, com arquivo pendente → novo `setup` completa o outro lado com o mesmo valor e apaga o arquivo; (b) um lado só, sem arquivo pendente → para com a orientação e nomeia o segredo a apagar | Dois testes no M8                                                        | (a) valores iguais no fake e arquivo ausente; (b) mensagem e log sem escrita |
| 7   | §5.6       | Token que falha na listagem de Codespaces → não é gravado                                                                                                                                                                         | Novo teste no M8                                                         | Log sem `secret put GITHUB_TOKEN`                                            |
| 8   | §4.2, §5.4 | (a) publish sem `infrastructure.json` → para e não cria nada; (b) workspace com `repository` → `ignored-config-fields`; (c) setup num lançador com `tool.lock.json` → para sem escrever                                           | Testes no M6 e no M8                                                     | Mensagens exatas; ausência de escritas                                       |
| 9   | §5.1       | (a) duas contas Cloudflare sem `--account` → para listando as contas; (b) `--launcher` diferente do `infrastructure.json` → para citando os dois valores                                                                          | Testes no M8                                                             | Mensagens exatas                                                             |
| 10  | §6.1, §5.5 | (a) lançador em outra versão → um commit da ferramenta com a versão nova antes do deploy, e `resume` depois de interrupção não duplica; (b) versão não publicada → para antes de qualquer escrita no lançador                     | Testes no M7                                                             | Um commit no repositório simulado; mensagem exata                            |
| 11  | §3.3       | Publish novo grava `toolVersion`; resume de journal sem `toolVersion` para com a mensagem exata                                                                                                                                   | Testes no M3                                                             | Campo no journal e no JSON; stderr exato                                     |
| 12  | §1.1, §3.3 | `--version` imprime a versão; o User-Agent recebido por um servidor de teste é `enois-preview/<versão>`                                                                                                                           | Testes no M3                                                             | stdout; cabeçalho capturado                                                  |
| 13  | §2.1       | Política de release e de workflows aceita o certo e recusa cada caso errado listado                                                                                                                                               | `test:release` e `test:workflows` (M10, M11)                             | Casos de recusa com mensagens                                                |
| 14  | §3.1       | Tarball instalado num prefixo temporário roda `--version` e `--help`; lista de arquivos igual à permitida; falha com caminho proibido                                                                                             | `test:package` (M5)                                                      | Saída 0 e prova da falha com `VALIDATION.md`                                 |
| 15  | §2         | CI verde na `main` com `prettier:check` e tempo registrado                                                                                                                                                                        | Estimativa local com `taskset -c 0-3` (M11); medida real no PR (Rollout) | Tempo estimado e, depois, o real                                             |
| 16  | §2.2       | Commit de formatação só com formatação, listado no `.git-blame-ignore-revs`, com `typecheck` e `npm test` verdes                                                                                                                  | M2 com `git show --stat`                                                 | SHA no arquivo; suíte verde naquele commit                                   |
| 17  | §9         | Release real pela `main` com provenance e notas geradas                                                                                                                                                                           | Depois do merge (Rollout)                                                | **Não verificável pelo executor**                                            |
| 18  | §9         | Instalação pelo npm, `setup` do zero e `publish` do exemplo com `status: "validated"`, com nomes novos                                                                                                                            | Depois da primeira release (Rollout)                                     | **Não verificável pelo executor**                                            |

## Documentation

O M12 cobre a documentação. A auditoria final confere que os guias citam exatamente os identificadores contratuais: `infrastructure.json`, `ENOIS_PREVIEW_INFRASTRUCTURE`, `toolVersion` (no lugar de `toolCommit` e `toolVerified`), `--yes`, `--launcher`, `--branch`, `--registry`, `--worker`, `--account`, `ignored-config-fields`, `browser-missing`, `registry-codespaces-access` e a mensagem `Infrastructure missing. Run enois-preview setup first.`.

## Rollout and recovery

Etapas depois que o executor entrega a branch. **Cada uma exige autorização explícita do mantenedor na hora.**

1. **PR e CI:** abrir o PR, conferir o `build` e registrar o tempo real (critério 15). Acima de 5 minutos, decidir com o mantenedor antes de cortar testes.
2. **Merge com merge commit.** Squash ou rebase trocam o SHA do commit de formatação e invalidam o `.git-blame-ignore-revs`. Se isso acontecer por engano, atualize o arquivo com o SHA novo num commit `chore:`.
3. **Primeira versão e Trusted Publisher:** ❗️ corrigido no M10. Sem Trusted Publisher, o `@semantic-release/npm` 13.2.0 cai no caminho de token e falha no `verifyConditions`, antes de criar a tag; o primeiro run automático depois do merge falha sem publicar nada. Roteiro (em `docs/{pt-BR,en}/RELEASING.md`): o mantenedor cria e envia a tag `v0.5.0` no head verde da `main`, publica de um checkout limpo da tag (`npm ci`, `npm version 0.5.0 --no-git-tag-version`, `npm run test:package`, `npm publish` com 2FA, sem provenance), configura o Trusted Publisher (`renanfranca/enois-preview`, `release.yml`) e roda `recover` com `version=0.5.0` para a release do GitHub. A provenance começa na versão seguinte.
4. **Primeira release:** o merge com `feat` dispara a release. Conferir no npm a versão com provenance e no GitHub a release `v0.5.0` com notas (critério 17). Se falhar no meio, `workflow_dispatch` com `operation=recover` e `version=0.5.0`.
5. **Aceite real (critério 18):** com nomes novos de lançador e Worker, `npm install -g enois-preview`, `enois-preview setup`, depois o exemplo fictício (`node <prefixo>/lib/node_modules/enois-preview/dist/example/prepare.js <workspace>`, `setup --config`, `publish`) até `status: "validated"`. Registrar evidência sanitizada.
6. **Recuperação de uma release ruim:** `npm deprecate enois-preview@<versão> "<motivo>"` e um `fix` novo. Não use `npm unpublish`.
7. **Infraestrutura antiga do mantenedor:** fica intacta, e os links antigos continuam enquanto o Worker e o lançador antigos existirem. Nada neste plano os altera.

## Lessons learned

- **M10, `revert` sem rodapé.** Com o preset `conventionalcommits`, `revert: x` sem "This reverts commit" não gera versão no `commit-analyzer` (a regra padrão exige `commit.revert`). `release.config.cjs` acrescenta `{ type: 'revert', release: 'patch' }`; o teste `the semantic-release configuration follows the same version table...` passa a tabela da §1.2 pelo analisador real e falhou sem essa regra.
- **M10, primeira publicação.** Sem Trusted Publisher, o `@semantic-release/npm` 13.2.0 exige token no `verifyConditions` e para antes da tag. O passo 3 do Rollout foi corrigido.
- **M12, exemplo fictício.** `example/prepare.ts` ainda gravava `repository`, `branch`, `registry`, `origin` e `cloudflareAccountId` no workspace; com a configuração separada isso geraria `ignored-config-fields` no tutorial. Os campos saíram do exemplo.
- **M12, checagem de grep.** O `VALIDATION.md` é o registro histórico de evidências por versão (como o CHANGELOG) e ficou fora da checagem. As linhas restantes com `tool.lock.json` e `codeload` descrevem como reconhecer um lançador antigo (a mensagem de parada do setup cita os dois), e a nota de remoção do README cita os itens removidos, como o M12 pede. Nenhuma instrução obsoleta sobrou. Duas âncoras da receita antiga ficaram quebradas dentro do histórico congelado da 0.4.0 nos CHANGELOGs, que a §1.4 manda manter intacto.

- **M2, SVG de mídia.** O `@prettier/plugin-xml` reformata `*.svg`. Os SVG de `example/media` e `test/fixtures/images` são dados com hash conferido (`frozen image GET and HEAD preserve literal MIME...` falhou). O commit de formatação restaurou esses bytes e acrescentou `*.svg` ao `.prettierignore`.
- **M0.1 npm Trusted Publishing antes de o pacote existir.** A documentação configura o publisher nas configurações de um pacote existente e diz que uma configuração nova precisa de uma publicação em 2 dias; não há "publisher pendente". Conclusão: a primeira versão sai por `npm publish` manual do mantenedor (Rollout, passo 3). Fonte: https://docs.npmjs.com/trusted-publishers
- **M0.2 acesso do GHCR aos Codespaces por API.** Não existe endpoint REST nem GraphQL para "Manage Codespaces access" (ou "Manage Actions access") de um pacote; só a página de configurações do pacote. Conclusão: o `publish` emite `registry-codespaces-access` (§6.2, M9). Fontes: https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility e https://github.com/orgs/community/discussions/188574
- **M0.3 subdomínio `workers.dev`.** Uma conta sem subdomínio registrado não publica em `workers.dev`; o `wrangler` pede o registro (interativo nas versões novas) ou falha. O `setup` lê a URL `https://<worker>.<subdomínio>.workers.dev` da saída do deploy e, sem ela, para com a instrução de registrar o subdomínio no painel (Workers & Pages). Fonte: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- **M0.4 segredos de Codespaces do usuário.** Endpoints `GET /user/codespaces/secrets`, `GET|PUT /user/codespaces/secrets/{name}/repositories` e `PUT /user/codespaces/secrets/{name}/repositories/{repository_id}` (inclui um repositório sem regravar o valor); escopo `codespace` (ou `codespace:secrets`). A gravação do valor usa `gh secret set NAME --user --app codespaces --repos OWNER/REPO`, que cifra com a chave pública e lê o valor do stdin. Fonte: https://docs.github.com/en/rest/codespaces/secrets
- **M0.5 `docker login ghcr.io` com o token do `gh`.** O GHCR aceita um token OAuth com `write:packages` (`gh auth refresh -s write:packages`), passado por `--password-stdin`. Fonte: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- **M0.6 `wrangler secret list|put` com Worker inexistente.** `secret list` falha (Worker não encontrado) e `secret put` oferece criar um Worker rascunho. Por isso o `setup` faz o deploy do Worker (etapa 3) antes de qualquer segredo (etapa 4) e só usa `secret list` depois que o Worker existe; o valor vai por stdin. Fonte: https://developers.cloudflare.com/workers/wrangler/commands/#secret
