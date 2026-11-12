# Plano 0.3.8: sanitizador reconhece as colunas novas do backend

## Purpose and success

Em 11 de novembro de 2026, a primeira captura de um H2 real do `enois-backend` (branch `qa`, commit `81c1ac02`) parou no sanitizador, antes de qualquer publicação:

```
java.lang.IllegalStateException: Unrecognized authentication or integration column: CALENDAR_SUBSCRIPTIONS.TOKEN_HASH; extend the reviewed sanitizer before capture
```

O sanitizador (`recipe/SeedTool.java`) recusa, de propósito, qualquer coluna com cara de credencial que ele ainda não conhece. Esse bloqueio é a proteção certa e continua. O que falta é a decisão revisada para as duas colunas novas do backend:

| Coluna | Origem no backend | O que guarda |
|---|---|---|
| `CALENDAR_SUBSCRIPTIONS.TOKEN_HASH` | migração V272, de 2026-11-11 | hash SHA-256 do token do link `.ics` da agenda; o token é a única credencial da rota, que responde sem sessão |
| `MESSAGES.ENCRYPTED_KEYS` | migração V244, de 2026-11-05 | JSON com uma cópia cifrada da chave AES da mensagem para cada participante (E2E por mensagem); `NULL` nas mensagens antigas |

O usuário decidiu corrigir isso numa release 0.3.8 com o ciclo completo da 0.3.7, **sem** publicar o cenário `issue-727`.

**Sucesso:**
- Uma captura cujo H2 tem `CALENDAR_SUBSCRIPTIONS` termina, e a cópia sanitizada não tem nenhuma linha nessa tabela nem o valor do token.
- Uma captura cujo H2 tem `MESSAGES.ENCRYPTED_KEYS` termina, preserva as mensagens com o conteúdo e deixa `ENCRYPTED_KEYS` como `NULL` em todas as linhas.
- Uma coluna nova e desconhecida, com cara de credencial, continua sendo recusada com a mesma mensagem e sem promover dados.
- O ciclo completo é refeito, como na 0.3.7:
  - tag, release, instalação real, `toolCommit` nas 4 configs e pin do lançador;
  - ciclo real do service por `current/`;
  - publish e resume canônicos (o catálogo vai de 13 para 14);
  - preservação lógica.

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Context and limits

- **Repositório:** `~/projects/enois-preview`. A branch nova sai da `main`, com `main` = `origin/main` = `v0.3.7` = `c52d80ec2c1c3d761a37103b6d6f9f3e7c933d37`.
  - Este plano é a única mudança pendente e vai no commit.
  - A branch `docs/operator-documentation` (3 commits de documentação à frente da `main`, sem PR) **não** entra nesta release. Não faça merge, rebase nem cherry-pick dela.
  - O GitHub é **público**: não escreva no plano nem nos documentos caminhos absolutos com o nome do usuário, segredos, emails nem valores de banco. Use `~`.
- **Tags que não mudam:** `v0.3.7` = `c52d80e`, `v0.3.6` = `4e81e92`, `v0.3.5` = `f2d9197`, `v0.3.4` = `5076258`.
- **Instalação:** `~/.local/share/enois-preview/current` → `c52d80e…`.
- **As 4 configs do ciclo**, todas com `toolCommit` `c52d80e…`:
  - `.preview/config.json` e `.preview/installation/config.json`;
  - em `~/projects/enois/.local/public-walkthrough-ts-{pt,en}`.
- **Fora do escopo, não toque:**
  - `~/.config/enois-preview-ts/config.json` (a instalação privada padrão) e `~/projects/enois/.local/issue-727-preview/`, ambos com `toolCommit` `c52d80e…`. Eles são do cenário `issue-727`, que o usuário vai publicar depois.
  - Consequência esperada: depois do S6, um `publish` com essa config é recusado porque a instalação verificada pertence a outro commit. Isso não é falha desta release. Registre isso no relatório, no texto do S11.
  - Os três repositórios das aplicações em `~/projects/enois/` e o H2 deles.
- **Lançador:** `~/projects/enois/.local/render-demo/launcher`, branch `codespaces-demo`. O local é igual ao origin, sem mudanças, e o pin é `c52d80e` (`tool.lock.json` e a dependência `enois-preview` no `package.json`). O catálogo tem 13 entradas.
- **Workspaces:** nenhum `restoration.json` nos workspaces PT, EN e `issue-727`.
- **Evidências:** `$EV` = `~/projects/enois/.local/preview-typescript-evidence/node24-consolidation`. Grave tudo em `$EV/release-0.3.8/`.
  - As pastas `release-0.3.2/` a `release-0.3.7/` são só leitura.
  - As ferramentas de `$EV/release-0.3.7/tools/` podem ser copiadas: `run-final.mjs`, `operations.mjs`, `service-path.mjs`, `preservation.mjs`, `compare.mjs`, `config-path.mjs` e `install-hash.cjs`.
- **Modelo do ciclo:** `.agent/execplans/release-0-3-7-exit-window.md` (S5 a S11). Ele remete a `~/.claude/plans/release-0-3-6-plan.md` (S7, S9, S10 e S11) e este a `~/.claude/plans/release-0-3-4-plan.md` para os comandos exatos.
- **Registros privados:** `$EV/EXECPLAN.md` e `$EV/acceptance.md`.
- **Sem worktree:** use a pasta principal.

**Código atual do sanitizador** (`recipe/SeedTool.java`, na `c52d80e`, ação `sanitize`):
1. Lê o esquema de todas as tabelas `PUBLIC`.
2. Pula as tabelas do conjunto `DROP` e a `USER_CREDENTIALS`.
3. Nas outras, aceita só duas exceções nomeadas: `PARENTAL_LINKS.TOKEN_HASH` e `CONTENT_FINGERPRINTS.TOKEN_COUNT`.
4. Qualquer outra coluna que case com `.*(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|WEBHOOK|MFA|OAUTH_GRANT|CIPHER|ENCRYPTED).*` lança `Unrecognized authentication or integration column: <TABELA>.<COLUNA>; extend the reviewed sanitizer before capture`.
5. Na transação: `DELETE FROM` em cada tabela de `DROP` que existe; `UPDATE PARENTAL_LINKS SET TOKEN_HASH=NULL` se a tabela existe; depois credenciais, emails e segundo fator.

O esquema é lido num `TreeMap`. Por isso a primeira tabela recusada, em ordem alfabética, é `CALENDAR_SUBSCRIPTIONS`, e a falha esconde a de `MESSAGES`.

O teste existente da captura sanitizada é `test/capture-journey.test.ts`, "capture restores running backend and sanitizes a real H2 copy while preserving content and relationships". Ele usa `fixture()` de `test/fixtures/h2.ts`, que cria um H2 real com o driver 2.5.252 e marcadores fictícios. Ele confere as consultas na cópia e a **ausência dos bytes** dos marcadores no `seed/rede.mv.db`.

**Observações do planejamento** (leituras feitas fora do repositório; não provam a implementação):
- No H2 do backend `qa` (`81c1ac02`), as únicas colunas recusadas pela regra atual são `CALENDAR_SUBSCRIPTIONS.TOKEN_HASH` e `MESSAGES.ENCRYPTED_KEYS`. Para isso, consultei `information_schema.columns` com o mesmo padrão e as mesmas exclusões do `SeedTool`.
- V272 cria `calendar_subscriptions(id, user_id, scope, token_hash varchar(64) not null, created_at, revoked_at)`, com índice único em `token_hash`.
- V244 faz `ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_keys TEXT NULL`.
- `USER_E2E_KEYPAIRS` e `CONVERSATION_E2E_KEYS` já estão em `DROP`.
- O `sanitizerSha256` só decide reaproveitamento dentro de uma **captura** (`preview/capture.ts:184`). Um `publish` sem `--refresh-data` reaproveita os dados congelados e não roda o sanitizador. Por isso o publish canônico do S8 não exercita a mudança.

**Autorização** (a mesma da 0.3.7):
- **Concedida:**
  - commit (`lc`), push (`lp`) e PR;
  - merge pelo `luna`, com fallback por git ff;
  - criar e enviar a tag `v0.3.8`;
  - `gh release create v0.3.8` com upload;
  - instalação real;
  - editar as 4 configs do ciclo, só o `toolCommit`;
  - commit e push do pin no lançador (`codespaces-demo`);
  - publish e resume canônicos, **sem** `--refresh-data`;
  - excluir a branch já incorporada.
- **Exige parar e perguntar:**
  - force push;
  - reescrever a `main` ou tags;
  - squash ou rebase que mude o SHA validado;
  - editar releases anteriores;
  - conta, plano pago, Worker novo ou segredo;
  - tocar nas aplicações, nos bancos originais, na config padrão ou no workspace `issue-727`;
  - apagar qualquer dado, catálogo ou histórico;
  - `publish --refresh-data`.

## Decisions

- **`CALENDAR_SUBSCRIPTIONS` entra no conjunto `DROP`.**
  - Cada linha só existe para autenticar um link sem sessão. Sem o token, `scope`, `created_at` e `revoked_at` não têm uso no preview.
  - `TOKEN_HASH` é `NOT NULL` e único, então zerar a coluna, como em `PARENTAL_LINKS`, quebraria a restrição.
  - **Consequência:** no preview, ninguém tem assinatura de agenda. A tabela continua no esquema e fica vazia, como as outras de `DROP`.
- **`MESSAGES.ENCRYPTED_KEYS` vira exceção nomeada e é zerada (`NULL`) na transação, no padrão de `PARENTAL_LINKS.TOKEN_HASH`.**
  - Alternativas descartadas:
    - **pôr `MESSAGES` em `DROP`:** apagaria todo o conteúdo das conversas, que o preview precisa mostrar;
    - **aceitar a coluna como está:** levaria as chaves cifradas para a imagem. Mesmo sem os pares de chaves, que já são descartados, isso foge da regra de que material de chave não sai da máquina.
  - **Consequência:** as mensagens E2E por mensagem já eram ilegíveis no preview, porque `USER_E2E_KEYPAIRS` é descartada, e continuam ilegíveis. As mensagens antigas, com `ENCRYPTED_KEYS` nulo, não mudam.
- **O padrão de recusa não muda.** Nenhum termo sai de `.*(PASSWORD|SECRET|TOKEN|…).*`, e nenhuma exceção é genérica: só as duas colunas, pelos nomes exatos de tabela e coluna. Uma coluna nova continua bloqueando a captura até uma revisão explícita.
- **O plano no repositório congela antes da validação final**, como na 0.3.7. Atualize o `Progress` até o S4 **antes** do S4. Depois do commit, não edite mais este arquivo. O progresso do S5 em diante vai para `$EV/EXECPLAN.md` e `release-0.3.8/executor-report.md`.
- **Título da release:** `0.3.8`, sem o "v", no padrão da 0.3.7.

## Risks

- **A mudança muda o `sanitizerSha256`.** As capturas seguintes de qualquer cenário deixam de reaproveitar dados congelados pela 0.3.7. Isso só importa com `--refresh-data`, que está fora desta release. Registre isso no CHANGELOG.
- **Uma exceção larga demais abriria um vazamento.** Por exemplo, aceitar qualquer `TOKEN_HASH` ou qualquer `ENCRYPTED_*`. O teste K3 é a guarda: uma coluna desconhecida com `TOKEN` continua recusada.
- **O teste por bytes depende de o H2 não guardar o valor antigo.** O teste atual já confere a ausência dos marcadores no `seed/rede.mv.db`, que é reescrito por `SCRIPT`/`RUNSCRIPT` e `SHUTDOWN COMPACT`. Use marcadores únicos e longos, que não apareçam por acaso.
- **O publish canônico não prova a correção.** Ele reaproveita dados congelados (veja as observações). A prova do comportamento é o `npm test` (K1 a K3) e o `test:capture`, que roda o sanitizador sobre o H2 fictício do workspace PT (K4).
- **Tempo:** o `test:capture` leva cerca de 4 minutos, e o ciclo completo, cerca de 1h30.

## Milestones

### S0. Branch e baseline
- Use o skill `create-git-branch` na pasta principal, a partir da `main` (`c52d80e`). Este plano vai junto.
- Confira `main` = `origin/main` = `v0.3.7^{commit}` = `c52d80e`.
- Copie para `$EV/release-0.3.8/configs-before/` (só para leitura):
  - as 4 configs do ciclo;
  - o `service.json` PT e EN;
  - o `readlink current`;
  - o conteúdo dos pidfiles configurados, se existirem.
- Registre, só para leitura, o `toolCommit` de `~/.config/enois-preview-ts/config.json` e da config do `issue-727`. No S11, eles precisam continuar iguais.

### S1. Red (tdd-behavior-autonomous-quiet)
Escreva os testes de K1, K2 e K3 em `test/capture-journey.test.ts`, pelo mesmo caminho público do teste existente (`captures.capture(config)` e consultas H2 na cópia). Estenda `fixture()` de `test/fixtures/h2.ts` para aceitar SQL adicional, sem mudar o que ele cria hoje. Rode na `c52d80e` com `npm run build && node --test dist/test/capture-journey.test.js` e grave em `release-0.3.8/red.log`:
- **K1** falha com `Unrecognized authentication or integration column: CALENDAR_SUBSCRIPTIONS.TOKEN_HASH`;
- **K2** falha com `… MESSAGES.ENCRYPTED_KEYS`;
- **K3** passa: é guarda, não red.

### S2. Green
- **`recipe/SeedTool.java`:**
  - acrescente `"CALENDAR_SUBSCRIPTIONS"` a `DROP`;
  - acrescente a exceção `MESSAGES`/`ENCRYPTED_KEYS` ao lado de `PARENTAL_LINKS`/`TOKEN_HASH`;
  - na transação, `UPDATE MESSAGES SET ENCRYPTED_KEYS=NULL` só se a tabela `MESSAGES` existe **e** tem a coluna `ENCRYPTED_KEYS`, para funcionar com bancos anteriores à V244.
- Não mude o padrão de recusa, a mensagem, as outras exceções, as ações `list`, `metadata` e `digest`, nem a ordem das etapas.
- **Repetições:** `node --test dist/test/capture-journey.test.js` três vezes. Grave os resultados em `green-capture.log`.

### S3. Documentação e versão
- `package.json` e as duas ocorrências da raiz em `package-lock.json`: `0.3.8`.
- `CHANGELOG.md` e `docs/en/CHANGELOG.md`: uma entrada `0.3.8` no topo, na data da entrega, dizendo que:
  - a captura aceita bancos com a agenda privada (`CALENDAR_SUBSCRIPTIONS`, esvaziada) e com E2E por mensagem (`MESSAGES.ENCRYPTED_KEYS`, zerada);
  - uma coluna desconhecida continua bloqueando a captura;
  - o `sanitizerSha256` mudou, e por isso a próxima captura com `--refresh-data` não reaproveita dados congelados por versões anteriores.
- `VALIDATION.md`: uma seção nova "Sanitizer coverage for calendar subscriptions and per-message keys (0.3.8)" com:
  - as duas colunas;
  - a decisão de cada uma;
  - o que não mudou;
  - K1 a K3 e o red observado.
  - Não reescreva seções anteriores.
- `docs/validation/sanitizer-columns-0.3.8/local.json`, no modelo de `docs/validation/exit-window-0.3.7/local.json`, com as contagens **observadas** no S4 e `productCodeChanged: true`.
- `release/public-files.json`: o `local.json` novo. O plano em `.agent/` **não** entra.
- Confira se `docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md` têm uma linha sobre a mensagem `Unrecognized authentication or integration column`.
  - Se não tiverem, acrescente uma linha nas tabelas de erros dizendo que é preciso uma versão da ferramenta que reconheça a coluna, e que a captura parou sem promover dados.
  - Não descreva como contornar a recusa.

### S4. Validação final
Detalhada em Validation. Antes dela, atualize o `Progress` deste plano até o S4 e marque o S5 como "em andamento". A partir daí, este arquivo fica congelado.

### S5. Commit, PR, merge e tag
Siga o S5 da 0.3.7, com a branch nova e `v0.3.8`:
1. `lc`, depois `lp`.
2. PR e merge **só por fast-forward** pelo `luna`, com o mesmo prompt da 0.3.7. Se o `luna` for bloqueado, faça o fast-forward com git e registre.
3. Confira que `main` = `origin/main` = SHA validado (SHA7), que o PR está `MERGED` e que o `git status` está limpo.
4. `git tag -a v0.3.8 -m "0.3.8" <SHA7>` e `git push origin v0.3.8`. Confira que as tags anteriores não mudaram (`delivery/`).

### S6. Baseline, instalação, configs e lançador
Siga o S6 da 0.3.7, com SHA7:
1. `before.json` com o `source-digest` nas 4 configs.
2. Backup dos dois `rede.mv.db` dos workspaces PT e EN em `db-backup/`, no modo 600.
3. `node dist/scripts/install-tool.js --commit <SHA7>`. Confira:
   - `current` → SHA7;
   - o global aponta para `<SHA7>/dist/preview/cli.js`;
   - as instalações anteriores continuam intactas (`install-hash.cjs`).
4. Confira que não há nenhum `restoration.json` e que as operações estão concluídas (`operations.mjs`). Se alguma operação não estiver concluída, **pare e reporte**.
5. Mude só o `toolCommit` nas 4 configs do ciclo. A comparação com `configs-before/` deve mostrar só isso (`configs/alignment.json`). Não toque na config padrão nem na do `issue-727`.
6. **Pidfiles:** com os backends parados, o `status` pelo `current/` novo responde `stopped` (`pidfiles.txt`).
7. Lançador:
   - `git pull --ff-only`;
   - pin `<SHA7>` em `tool.lock.json` e no `package.json`;
   - `npm install --package-lock-only --ignore-scripts`;
   - o consumer completo;
   - `lc` e `lp`.

### S7. Prova operacional do service por `current/`
Siga o S7 da 0.3.7 e grave `service-path.json`:
- leituras nas 4 configs;
- `source-digest` antes;
- ciclo real `start`/`ready`/`stop`/`released` na config de instalação PT;
- `source-digest` depois, com o `logicalSha256` igual;
- depois do `stop`: o pidfile no disco, `status` = `stopped`, e um segundo `start` que funciona e termina parado.

### S8. Publish e resume canônicos
Siga o S8 da 0.3.7, com `toolCommit` = SHA7 e o catálogo com as 13 entradas anteriores iguais e 14 no total (`public/comparison.json`). Cite de novo, sem caminhos locais, se o `runtime.log` da operação nova contém `Demo gateway ready` e se há registro do Codespace. Registre que esse publish reaproveita dados congelados e não exercita o sanitizador novo.

### S9. Preservação
Siga o S9 da 0.3.7:
- `after.json` com o `logicalSha256` igual ao do `before.json`;
- checks booleanos comparados com os de `release-0.3.7/final-preservation.json` (`preservation-comparison.json`).

### S10. Release
`gh release create v0.3.8 --title 0.3.8` com notas PT/EN:
- as duas colunas e a decisão de cada uma;
- a recusa de colunas desconhecidas, que continua;
- a mudança do `sanitizerSha256`;
- a lacuna `register-codespace`, que continua aberta.

Pacote de evidências revisadas mais o `.sha256`, sem logs brutos e com marcadores no lugar dos caminhos locais. Baixe de volta, rode `sha256sum -c` e `cmp`, e procure `/home/`, tokens e emails (`release-readback.json`).

### S11. Limpeza e registros
- Remova a branch local e a remota, depois de confirmar que ela é ancestral da `main` (`cleanup.json`).
- Se o publish avançou o origin do lançador, faça ff do checkout local.
- Confira que o `toolCommit` da config padrão e da config do `issue-727` continua `c52d80e…`, igual ao S0.
- `$EV/EXECPLAN.md`: seção "0.3.8 sanitizer columns".
- `$EV/acceptance.md`: seção 0.3.8 com K1–K5 e o estado de cada lacuna.
- `release-0.3.8/executor-report.md` com:
  - o estado de K1–K5, com o comando, o resultado observado e o artefato de cada um;
  - os desvios;
  - as lacunas;
  - os caminhos das evidências;
  - o próximo passo do operador para o `issue-727`: trocar o `toolCommit` dessas duas configs para SHA7, rodar `enois-preview setup` nesse workspace e depois `enois-preview publish issue-727`.

## Critérios de aceitação

As fontes são:
- **[T]** `recipe/SeedTool.java`, `test/capture-journey.test.ts` e `test/fixtures/h2.ts` na `c52d80e`;
- **[B]** as migrações do `enois-backend` `V272__calendar_subscriptions.sql` e `V244__message_encrypted_keys.sql` (branch `qa`, `81c1ac02`), e a falha real de captura de 2026-11-11 citada em Purpose;
- **[U]** a decisão do usuário: release 0.3.8 com o ciclo completo, a partir da `main`, sem o cenário `issue-727`.

Antes da entrega, confira de novo cada expectativa contra essas fontes, **separado** de conferir se a prova a demonstra. Registre a evidência de cada critério: comando, resultado observado e artefato. Uma suíte verde sozinha não fecha nenhum K. Uma lacuna de cobertura fica escrita como lacuna, não como critério cumprido.

**K1. A agenda privada não bloqueia a captura e não vaza** [T, B]
- **Contexto:** o H2 da fixture tem também `CALENDAR_SUBSCRIPTIONS(ID, USER_ID, SCOPE, TOKEN_HASH VARCHAR(64) NOT NULL UNIQUE, CREATED_AT, REVOKED_AT)`, com uma linha do `author` cujo `TOKEN_HASH` é um marcador único (por exemplo, `calendar-subscription-marker-…`).
- **Ação:** `captures.capture(config)`.
- **Resultado esperado:**
  - a captura termina;
  - `SELECT COUNT(*) FROM CALENDAR_SUBSCRIPTIONS` na cópia dá `0`;
  - o marcador não aparece nos bytes de `seed/rede.mv.db`;
  - o backend volta a `running`;
  - o banco original fica com o mesmo sha256.
- **Discriminação:** na `c52d80e`, a mesma ação rejeita com `Unrecognized authentication or integration column: CALENDAR_SUBSCRIPTIONS.TOKEN_HASH` (S1). Uma correção que só aceitasse a coluna sem esvaziar a tabela falharia na contagem e nos bytes.

**K2. As mensagens ficam, as chaves por mensagem não** [T, B]
- **Contexto:** o H2 da fixture tem também `MESSAGES(ID, SENDER_ID, CONTENT, ENCRYPTED_KEYS)`, com:
  - uma mensagem do `author` com conteúdo fictício legível e `ENCRYPTED_KEYS` igual a um marcador único;
  - uma mensagem com `ENCRYPTED_KEYS` `NULL`.
- **Ação:** `captures.capture(config)`.
- **Resultado esperado:**
  - a captura termina;
  - as duas mensagens continuam na cópia, com o conteúdo igual;
  - `SELECT COUNT(*) FROM MESSAGES WHERE ENCRYPTED_KEYS IS NOT NULL` dá `0`;
  - o marcador não aparece nos bytes de `seed/rede.mv.db`.
- **Discriminação:** na `c52d80e`, a ação rejeita com `… MESSAGES.ENCRYPTED_KEYS` (S1). Uma correção que pusesse `MESSAGES` em `DROP` falharia no conteúdo preservado; uma que só aceitasse a coluna falharia na contagem e nos bytes.
- Nesta fixture, deixe `MESSAGES` sem `CALENDAR_SUBSCRIPTIONS`. Assim, o red de K2 não fica escondido pela ordem alfabética.

**K3. Uma coluna desconhecida continua bloqueando** [T, U]
- **Contexto:** o H2 da fixture tem também uma tabela fictícia (por exemplo, `CALENDAR_FEEDS(ID, FEED_TOKEN)`) com um marcador.
- **Ação:** `captures.capture(config)`.
- **Resultado esperado:**
  - a captura rejeita com `Unrecognized authentication or integration column: CALENDAR_FEEDS.FEED_TOKEN; extend the reviewed sanitizer before capture`;
  - o backend volta a `running`;
  - não existe dado promovido em `<state>/data/`;
  - não fica `restoration.json`.
- **Discriminação:** passa antes e depois. É a guarda contra uma exceção larga demais (por exemplo, aceitar qualquer tabela que comece com `CALENDAR_` ou qualquer `*_TOKEN*`).

**K4. O comportamento da 0.3.7 continua** [T]
- O teste existente "capture restores running backend and sanitizes a real H2 copy…" e todo o `npm test` passam sem mudar as asserções existentes.
- No `test:capture`, sobre o H2 fictício do workspace PT:
  - `validOriginalLoginsBeforeCapture` = 4, `originalLoginsRejectedInSanitizedCopy401` = 4;
  - `logicalSha256` igual;
  - banco original igual;
  - durações abaixo de 600 s e 1200 s;
  - a listagem do `.preview/` do PT igual antes e depois.
- ❗️ **Lacuna de cobertura:** o H2 fictício do workspace PT pode não ter as tabelas novas, porque foi preparado com um backend mais antigo. Registre se tem ou não (consulta só de leitura ao `information_schema` de uma cópia). Se não tiver, o K4 prova a não regressão, e a prova das tabelas novas fica só em K1 e K2, por H2 real da fixture. Não use o H2 do `enois-backend` nem o do `issue-727` para isso.

**K5. Entrega**
- `main` = `origin/main` = `v0.3.8^{commit}` = SHA7, e as tags anteriores sem mudança. PR `MERGED`.
- `current` → SHA7, e as 4 configs do ciclo diferem de `configs-before/` só no `toolCommit`.
- A config padrão e a do `issue-727` continuam em `c52d80e…`.
- O pin do lançador está em SHA7, sincronizado com o origin.
- O publish e o resume foram validados, e o catálogo tem 13 entradas iguais e 14 no total.
- O `logicalSha256` é igual antes e depois, e os booleanos de preservação são iguais aos da 0.3.7.
- O release `0.3.8` foi lido de volta sem vazamentos, e a branch foi removida.

## Progress

- [x] S0 branch e baseline (2026-11-12). Branch `fix/sanitizer-columns`, criada a partir da `main` em `6108393`; veja o desvio 1. Cópias em `release-0.3.8/configs-before/`. O pidfile do PT aponta para um processo que não existe mais (backend parado). Nenhum `restoration.json` em PT, EN e `issue-727`. `toolCommit` da config padrão e do `issue-727`: `c52d80e…` (`configs-before/out-of-scope-toolcommits.txt`).
- [x] S1 red. K1 e K2 foram recusados com as mensagens esperadas, e K3 passou (`red.log`, `red-summary.json`); veja o desvio 2.
- [x] S2 green. `recipe/SeedTool.java` com `CALENDAR_SUBSCRIPTIONS` em `DROP` e a exceção `MESSAGES`/`ENCRYPTED_KEYS` zerada na transação. `capture-journey` passou 15 de 15 em três execuções (`green-capture.log`).
- [x] S3 documentação e versão. Versão `0.3.8`, CHANGELOG PT/EN, seção nova no `VALIDATION.md`, `docs/validation/sanitizer-columns-0.3.8/local.json`, `release/public-files.json` e uma linha nova na tabela de erros de `RECIPES.md` PT/EN.
- [ ] S4 validação final (em andamento; este arquivo congela aqui)
- [ ] S5–S11: registrados em `$EV/EXECPLAN.md` e `release-0.3.8/executor-report.md`

**Desvios registrados na execução:**
1. **A `main` não estava na `c52d80e`.** Ela estava em `6108393` = `origin/main`: os três commits de documentação da `docs/operator-documentation` já tinham entrado por fast-forward em 2026-11-11, e a branch não existe mais. O S3 depende desses arquivos (`CHANGELOG.md` e `docs/*/RECIPES.md` só existem depois deles), e o merge do S5 só é fast-forward a partir da `main`. Por isso, a branch saiu da `6108393`, e a release 0.3.8 inclui essa documentação. O sanitizador e todo o código de produção na `6108393` são iguais aos da `c52d80e`. Por isso, o red foi observado na `6108393`.
2. **Onde a mensagem de recusa aparece.** O erro que `captures.capture` lança é o genérico `Capture incomplete; backend restored to its prior state. java failed (exit 1); …`. A mensagem `Unrecognized authentication or integration column: …` vai só para o log privado `<state>/tools/sanitize.log`. Foi ali que a falha de 2026-11-11 foi lida. O K3 confere o erro lançado e a mensagem nesse log. O red de K1 e K2 foi lido no mesmo log (`red-summary.json`). O produto não mudou, como pedem as Decisions.
3. **Lacuna do K4 confirmada.** O H2 fictício do workspace PT não tem `CALENDAR_SUBSCRIPTIONS` nem `MESSAGES.ENCRYPTED_KEYS`: uma consulta numa cópia devolveu 0 linhas, e o sha256 do original não mudou (`k4-coverage.json`). O `test:capture` prova só a não regressão.

## Validation

Rode sobre o tree exato que será commitado, já com este plano congelado. Mova qualquer tentativa que falhar para `final-attempt<N>/`, sem contá-la como aprovação.

Com `ENOIS_PREVIEW_EVIDENCE=$EV/release-0.3.8/final`, rode, nesta ordem, os comandos abaixo; todos devem sair com 0:
1. `npm ci --ignore-scripts`
2. `npm run build`
3. `npm run typecheck`
4. `npm test`: 117 testes (os 114 da 0.3.7 mais K1, K2 e K3), 0 fail e 0 skip. Se a contagem for outra, explique no relatório antes de seguir.
5. `npm run check`
6. `ENOIS_PREVIEW_EXAMPLE_WORKSPACE=~/projects/enois/.local/public-walkthrough-ts-pt npm run test:capture`: K4, com o `.preview/` listado antes e depois.
7. `npm run test:consumer`: o consumer instalado com a mesma contagem do passo 4, lida do `test.log` dele, não da contagem externa.
8. `npm run test:install`

Grave `release-0.3.8/final/validation.json` com:
- o tree antes e depois (iguais);
- as contagens observadas comparadas com o `local.json`;
- o `capture-validation.json`.

**Paradas:**
- K1 ou K2 sem red na `c52d80e`, ou com outra mensagem;
- K3 falhar antes ou depois da mudança;
- algum `restoration.json` pendente ou alguma operação não concluída;
- o merge não ser fast-forward;
- a instalação, uma ação do service, o publish ou o resume falharem, depois de no máximo um `resume`;
- o `logicalSha256` divergir;
- qualquer validação falhar;
- o tree mudar entre a validação e o commit;
- qualquer necessidade de tocar na config padrão, no workspace `issue-727`, nas aplicações ou nos bancos originais.
