# Plano 0.3.7: timer do teste, texto das lacunas e a janela de saída do backend

## Purpose and success

A revisão da 0.3.6 (11 de novembro de 2026) deixou três pontos, e o usuário decidiu corrigir os três numa release 0.3.7 com o ciclo completo:

1. **O teste do J1 deixa um timer pendurado.** Em `test/service-journey.test.ts`, o `Promise.race([exited, delay(75_000)…])` não cancela o `delay`. O arquivo leva cerca de 79 s, e os quatro testes somam cerca de 9 s.
2. **O `VALIDATION.md` diz que a rota `ready` do gateway continua aberta.** Ela foi fechada pela publicação canônica da 0.3.6. A linha "Open:", logo depois de "Accepted limits", precisa dizer isso, e o `register-codespace` continua aberto.
3. **O `status` e o `start` ainda podem responder "Backend ownership mismatch" durante a saída do backend.** No meio da saída, o kernel já liberou a memória (a `cmdline` fica vazia) e o `cwd`, mas o processo ainda não virou zumbi. O `stop` não é afetado, porque espera a identidade que sinalizou. O `capture` é afetado, porque espera `status` = `stopped` (`preview/capture.ts:62` e `:149`).

**Sucesso:**
- `node --test dist/test/service-journey.test.js` termina em menos de 30 s, sem perder a guarda de 75 s do J1.
- O `VALIDATION.md` registra a rota `ready` como fechada pela evidência da v0.3.6, e o `register-codespace` como a única lacuna aberta.
- Um processo do pidfile que já está saindo (flag `PF_EXITING`) conta como parado na checagem de dono. Um processo vivo e estranho que não está saindo continua dando o mismatch.
- O ciclo completo é refeito, como na 0.3.6:
  - tag, release, instalação real, `toolCommit` nas 4 configs e pin do lançador;
  - ciclo real do service por `current/`;
  - publish e resume canônicos (o catálogo vai de 12 para 13);
  - preservação lógica.

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, na `main` limpa, com `main` = `origin/main` = `v0.3.6` = `4e81e92a3b5cbccc89ede98d553b61dd6e65e9cc`.
  - Este plano é a única mudança pendente e vai no commit.
  - O GitHub é **público**: não escreva no plano nem nos documentos caminhos absolutos com o nome do usuário, segredos ou emails. Use `~`.
- **Tags que não mudam:** `v0.3.6` = `4e81e92`, `v0.3.5` = `f2d9197`, `v0.3.4` = `5076258`, `v0.3.3` = `e104881` e `v0.3.2` = `5421768` (a `v0.3.2` continua sem release).
- **Instalação:** `~/.local/share/enois-preview/current` → `4e81e92…`. As 4 configs estão com `toolCommit` `4e81e92…`:
  - `.preview/config.json` e `.preview/installation/config.json`;
  - em `~/projects/enois/.local/public-walkthrough-ts-{pt,en}`.
- **Lançador:** `~/projects/enois/.local/render-demo/launcher`, branch `codespaces-demo`. O local é igual ao origin `8f9451a`, e o pin é `4e81e92`.
- **Workspaces:**
  - nenhum `restoration.json` e nenhuma `host-capture-*`;
  - o PT tem `.preview/backend.pid` no formato novo, com um PID morto, e o `status` responde `stopped`;
  - o EN não tem pidfile.
- **Evidências:** `$EV` = `~/projects/enois/.local/preview-typescript-evidence/node24-consolidation`. Grave tudo em `$EV/release-0.3.7/`.
  - As pastas `release-0.3.2/` a `release-0.3.6/` são só leitura.
  - As ferramentas de `$EV/release-0.3.6/tools/` podem ser copiadas: `run-final.mjs`, `operations.mjs`, `service-path.mjs`, `preservation.mjs`, `compare.mjs`, `config-path.mjs` e `install-hash.cjs`.
- **Plano anterior, que é o modelo do ciclo:** `~/.claude/plans/release-0-3-6-plan.md`, etapas S6, S7, S8.1, S8.2 e S9 a S13. Ele remete ao `~/.claude/plans/release-0-3-4-plan.md` (S8 a S13) para os comandos exatos.
- **Registros privados:** `$EV/EXECPLAN.md` e `$EV/acceptance.md`.
- **Sem worktree:** use a pasta principal (memória `no-worktree-single-folder`).

**Código atual da checagem de dono** (`preview/service.ts`, na `4e81e92`):
- `processStat(pid)` lê `/proc/<pid>/stat` e devolve o estado (campo 3) e o `starttime` (campo 22).
- `alive(record)` devolve a identidade, ou `undefined` se o processo sumiu, é `Z`/`X` ou tem outro `starttime`.
- `ownedPid` faz o seguinte:
  1. lê o pidfile e chama `alive`;
  2. compara a `cmdline` (o `jar` e a URL do datasource) e o `realpath` do `cwd`;
  3. se a comparação falha (inclusive por `ENOENT`), chama `alive` de novo: se o processo continua vivo, lança "Backend ownership mismatch; no process was signalled."
- **A janela:** no kernel, `do_exit` liga `PF_EXITING` e depois libera a memória (`exit_mm`, que deixa a `cmdline` vazia) e o `cwd` (`exit_fs`). O estado só vira `Z` no `exit_notify`. Nesse intervalo, o processo está saindo, mas ainda aparece vivo e estranho.

**Observações do planejamento** (leituras e protótipos fora do repositório; não provam a implementação):
- `node --test dist/test/service-journey.test.js` na `4e81e92`: 4 de 4 passaram, com 4,3 + 2,2 + 0,1 + 2,4 s e `duration_ms` 79338. É o timer de 75 s.
- **Protótipo de saída retida** (um processo com socket TCP em `SO_LINGER` e envio pendente, depois `_exit`): o `/proc/<pid>/stat` mostrou estado `Z`, flags `0x40804c`, bit `0x4` ligado, `cmdline` vazia e `cwd` com `ENOENT`.
  - Isso confirma que o campo 9 (índice 6 depois do `)` + 2) traz as flags e que o `PF_EXITING` aparece.
  - Mas o processo já estava zumbi: o linger não reteve a saída antes do `exit_notify`.
- **Protótipo de corrida:** `service(config,'status')` em laço, dentro do processo, enquanto o `java` falso saía após SIGTERM. Deu 0 mismatches em 20 ciclos.
- **Conclusão:** a janela do ponto 3 não é reproduzível de forma determinística nem frequente por caminho público neste ambiente (WSL2 6.18). Não há CI no repositório.
- **Evidência do ponto 2:** o `runtime.log` da operação canônica `345a2be6…` (workspace PT) contém "Demo gateway ready".
  - O `register-codespace` só roda com `CODESPACES=true` (`runtime/start.ts:56`).
  - A evidência não mostra o registro.

**Autorização** (a mesma da 0.3.6, sem a limpeza de workspace):
- **Concedida:**
  - commit (`lc`), push (`lp`) e PR;
  - merge pelo `luna`, com fallback por git ff;
  - criar e enviar a tag `v0.3.7`;
  - `gh release create v0.3.7` com upload;
  - instalação real;
  - editar as 4 configs, só o `toolCommit`;
  - commit e push do pin no lançador (`codespaces-demo`);
  - publish e resume canônicos, **sem** `--refresh-data`;
  - excluir a branch já incorporada.
- **Exige parar e perguntar:**
  - force push;
  - reescrever a `main` ou tags;
  - squash ou rebase que mude o SHA validado;
  - editar releases anteriores;
  - conta, plano pago, Worker novo ou segredo;
  - tocar nas aplicações ou nos bancos originais fora do S9 e do S10;
  - apagar qualquer dado, catálogo ou histórico;
  - `publish --refresh-data`.

## Decisions

- **Ponto 3: `PF_EXITING` decide só a divergência de dono.**
  - O `processStat` passa a devolver também as flags (campo 9 de `/proc/<pid>/stat`).
  - Em `ownedPid`, quando a comparação de `cmdline`/`cwd` falha, o processo conta como **parado** se sumiu, se é `Z`/`X`, se tem outro `starttime` ou se tem `flags & 0x4` (`PF_EXITING`, `include/linux/sched.h`). Só um processo vivo, com a mesma identidade e **sem** `PF_EXITING`, lança o mismatch.
  - O caminho positivo não muda: um processo saindo com a `cmdline` ainda dona responde `running`.
  - O `alive()` usado pelo `stop` **não** muda. O `stop` continua esperando o processo sumir ou virar zumbi, para não sair antes de o processo soltar os arquivos e para não mudar o `released`.
  - Alternativas descartadas:
    - **Tratar `cmdline` vazia como parada:** também casaria com um processo estranho que zera o próprio `argv`. Esse caso passaria de mismatch para `stopped`, e o `start` poderia ligar uma segunda JVM.
    - **Ligar `PF_EXITING` no `alive()`:** mudaria o fim do `stop`.
  - **Consequência:** a correção fica **fechada por construção, não observada**, como a janela do `rm` da 0.3.6. O VALIDATION.md diz isso assim. J3 e J4 continuam como a guarda contra uma correção larga demais.
- **Ponto 1: cancelar o timer, não remover a guarda.** Use um `AbortController` cujo sinal vai para `delay(75_000, undefined, { signal })`, e aborte logo depois do `race`, tratando o `AbortError`. Assim, a falha por tempo continua possível, e o processo não fica preso. `{ ref: false }` também serve, se for mais simples. Registre a escolha.
- **O plano no repositório congela antes da validação final.** O tree validado é o tree commitado, e este plano faz parte dele.
  - Atualize o `Progress` até o S5 **antes** do S5.
  - Depois do commit, não edite mais este arquivo. O progresso do S6 em diante vai para `$EV/EXECPLAN.md` e `release-0.3.7/executor-report.md`.
- **Título da release:** `0.3.7`, sem o "v", no padrão de 0.3.3 a 0.3.5. O título "v0.3.6" fica como está; editar releases anteriores exige perguntar.

## Risks

- **`/proc/<pid>/stat` com `)` no nome do comando:** o parse já usa `lastIndexOf(')')`. Mantenha isso para as flags.
- **Flags como número:** o campo 9 cabe em `Number` (é unsigned de 32 bits). Use `(flags & 0x4) !== 0` depois de `Number(...)` e confirme que não é `NaN`. Se for `NaN`, o processo **não** conta como saindo, e o mismatch continua, que é o lado seguro.
- **Sem red observável para o ponto 3:** um teste verde não prova a correção. Não apresente como prova observada.
- **Tempo:** o `test:capture` leva cerca de 4 minutos, e o ciclo completo, cerca de 1h30.

## Milestones

### S0. Branch e baseline
- Use o skill `create-git-branch` na pasta principal. Este plano vai junto.
- Copie para `$EV/release-0.3.7/configs-before/` (só para leitura):
  - as 4 configs;
  - o `service.json` PT e EN;
  - o `readlink current`;
  - o conteúdo dos pidfiles configurados, se existirem.

### S1. Red (tdd-behavior-autonomous-quiet)
Rode na `4e81e92` e grave em `release-0.3.7/red.log`:
- **K1:** `npm run build && node --test dist/test/service-journey.test.js`. O red esperado é `duration_ms` acima de 70000, com os 4 testes passando.
- **K3:** registre que não há red por caminho público, citando as observações do planejamento. Se quiser repetir o protótipo de corrida, ele vai em `release-0.3.7/dev/`, nunca no repositório.

### S2. Green
- **`test/service-journey.test.ts`:** cancele o timer do J1 (Decisions). Não mude as asserções do J1.
- **`preview/service.ts`:** aplique a regra do `PF_EXITING`, conforme Decisions.
  - Não mude o `alive()` do `stop`, o formato do pidfile, as mensagens nem o código de saída.
- **Repetições:** `node --test dist/test/service-journey.test.js` cinco vezes. Grave as cinco `duration_ms` em `green-service.log`.

### S3. Documentação e versão
- `package.json` e as duas ocorrências da raiz em `package-lock.json`: `0.3.7`.
- `VALIDATION.md` (não reescreva seções anteriores):
  - **A linha "Open:", depois de "Accepted limits" (ponto 2):** diga que a rota `ready` do gateway foi fechada pela publicação canônica da v0.3.6 (o `runtime.log` da operação contém `Demo gateway ready`) e que o `register-codespace` continua aberto, porque só roda com `CODESPACES=true`. Sem caminhos locais.
  - **Uma seção nova "Ownership check during backend exit (0.3.7)":**
    - a janela (`PF_EXITING` antes da liberação da `cmdline` e do `cwd`, e `Z` só no `exit_notify`);
    - a regra nova e o que não mudou (`stop`, `alive`, caminho positivo, formato e mensagens);
    - "closed by construction, not observed", com os dois protótipos sem red;
    - J3 e J4 como guarda;
    - o timer do J1 corrigido.
- `docs/validation/exit-window-0.3.7/local.json`, no modelo de `docs/validation/orphan-stop-0.3.6/local.json`, com as contagens **observadas** no S4 e `productCodeChanged: true`.
- `release/public-files.json`: o `local.json` novo. O plano em `.agent/` **não** entra: ele não é fonte pública exportada.

### S4. Validação final
Detalhada em Validation. Antes dela, atualize o `Progress` deste plano até o S4 e marque o S5 como "em andamento". A partir daí, este arquivo fica congelado.

### S5. Commit, PR, merge e tag
Siga o S6 da 0.3.6, com a branch nova e `v0.3.7`:
1. `lc`, depois `lp`.
2. PR e merge **só por fast-forward** pelo `luna`, com o mesmo prompt da 0.3.6. Se o `luna` for bloqueado, faça o fast-forward com git e registre.
3. Confira que `main` = `origin/main` = SHA validado (SHA7), que o PR está `MERGED` e que o `git status` está limpo.
4. `git tag -a v0.3.7 -m "0.3.7" <SHA7>` e `git push origin v0.3.7`. Confira que as tags anteriores não mudaram (`delivery/`).

### S6. Baseline, instalação, configs e lançador
Siga o S7 da 0.3.6, com SHA7:
1. `before.json` com o `source-digest` nas 4 configs.
2. Backup dos dois `rede.mv.db` em `db-backup/`, no modo 600.
3. `node dist/scripts/install-tool.js --commit <SHA7>`. Confira:
   - `current` → SHA7;
   - o global aponta para `<SHA7>/dist/preview/cli.js`;
   - as instalações anteriores continuam intactas (`install-hash.cjs`).
4. Checagem de que não há nenhum `restoration.json` e de que as operações estão concluídas (`operations.mjs`, como o S8.1 da 0.3.6). Se alguma operação não estiver concluída, **pare e reporte**.
5. Mude só o `toolCommit` nas 4 configs. A comparação com `configs-before/` deve mostrar só isso (`configs/alignment.json`).
6. **Pidfiles:** com os backends parados, o `status` pelo `current/` novo responde `stopped` (`pidfiles.txt`).
7. Lançador:
   - `git pull --ff-only`;
   - pin `<SHA7>` em `tool.lock.json` e no `package.json`;
   - `npm install --package-lock-only --ignore-scripts`;
   - o consumer completo;
   - `lc` e `lp`.

### S7. Prova operacional do service por `current/`
Siga o S9 da 0.3.6 e grave `service-path.json`:
- leituras nas 4 configs;
- `source-digest` antes;
- ciclo real `start`/`ready`/`stop`/`released` na config de instalação PT;
- `source-digest` depois, com o `logicalSha256` igual;
- depois do `stop`: o pidfile novo no disco, `status` = `stopped`, e um segundo `start` que funciona e termina parado.

### S8. Publish e resume canônicos
Siga o S10 da 0.3.6, com `toolCommit` = SHA7 e o catálogo com as 12 entradas anteriores iguais e 13 no total (`public/comparison.json`). Cite de novo, sem caminhos locais, se o `runtime.log` da operação nova contém `Demo gateway ready` e se há registro do Codespace.

### S9. Preservação
Siga o S11 da 0.3.6:
- `after.json` com o `logicalSha256` igual ao do `before.json`;
- checks booleanos comparados com os de `release-0.3.6/final-preservation.json` (`preservation-comparison.json`).

### S10. Release
`gh release create v0.3.7 --title 0.3.7` com notas PT/EN:
- os três pontos;
- a correção fechada por construção;
- a lacuna `register-codespace`.

Pacote de evidências revisadas mais o `.sha256`, sem logs brutos e com marcadores no lugar dos caminhos locais. Baixe de volta, rode `sha256sum -c` e `cmp`, e procure `/home/`, tokens e emails (`release-readback.json`).

### S11. Limpeza e registros
- Remova a branch local e a remota, depois de confirmar que ela é ancestral da `main` (`cleanup.json`).
- Se o publish avançou o origin do lançador, faça ff do checkout local.
- `$EV/EXECPLAN.md`: seção "0.3.7 exit window and closure".
- `$EV/acceptance.md`: seção 0.3.7 com K1–K5 e o estado de cada lacuna.
- `release-0.3.7/executor-report.md` com:
  - o estado de K1–K5, com o comando, o resultado observado e o artefato de cada um;
  - os desvios;
  - as lacunas;
  - os caminhos das evidências.

## Critérios de aceitação

As fontes são:
- **[S]** `preview/service.ts` e `test/service-journey.test.ts` na `4e81e92`;
- **[V]** `VALIDATION.md` na `4e81e92`: a seção "Orphan stop and pidfile ownership (0.3.6)" e a linha "Open:" de "Accepted limits";
- **[K]** o kernel Linux: `PF_EXITING` = `0x00000004` em `include/linux/sched.h`; a ordem em `kernel/exit.c` `do_exit` (`exit_signals` antes de `exit_mm`/`exit_fs`, e estes antes de `exit_notify`); o campo 9 `flags` em proc(5);
- **[E]** a evidência da v0.3.6 (`$EV/release-0.3.6/public/`, o `runtime.log` da operação `345a2be6…` e `executor-report.md`);
- **[R]** a revisão de 11 de novembro de 2026 e a decisão do usuário de corrigir os pontos 1, 2 e 3 com o ciclo completo.

Antes da entrega, confira de novo cada expectativa contra essas fontes, **separado** de conferir se a prova a demonstra. Registre a evidência de cada critério: comando, resultado observado e artefato. Uma suíte verde sozinha não fecha nenhum K. Uma lacuna de cobertura fica escrita como lacuna, não como critério cumprido.

**K1. O J1 não segura o processo e mantém a guarda** [S, R]
- **Contexto:** o build da branch.
- **Ação:** `node --test dist/test/service-journey.test.js`.
- **Resultado esperado:**
  - 4 de 4 passam;
  - `duration_ms` < 30000 nas cinco repetições do S2 e na final;
  - o J1 continua falhando se o `stop` não sair em 75 s: o `race` ainda resolve para `'timeout'`, e o `assert.equal(code, 0, …)` falha.
- **Discriminação:** na `4e81e92`, a mesma ação dá cerca de 79000 ms (S1). A guarda se confirma pela leitura do teste: o `race` continua com dois ramos e a asserção do código de saída fica igual. Registre o trecho.

**K2. O texto das lacunas corresponde à evidência** [V, E]
- **Resultado esperado:**
  - a linha "Open:" depois de "Accepted limits" não diz mais que a rota `ready` está aberta;
  - ela diz que a rota foi fechada pela publicação canônica da v0.3.6 e que o `register-codespace` continua aberto;
  - a seção de 0.3.5 e as anteriores ficam iguais (`git diff 4e81e92 -- VALIDATION.md` só toca a linha "Open:" e acrescenta a seção nova);
  - `grep -n '/home/' VALIDATION.md` não acha nada novo.
- **Discriminação:** o `git diff` mostra a linha antiga removida.

**K3. O processo saindo conta como parado; o estranho estável continua protegido** [S, K, R]
- **Expectativa:**
  - com o pidfile nomeando o próprio backend e ele já com `PF_EXITING` (a `cmdline` vazia ou o `cwd` com `ENOENT`), o `status` responde `stopped`, sem erro;
  - o `start` liga um backend novo depois que o antigo some;
  - um processo vivo, com a mesma identidade, sem `PF_EXITING` e sem o `jar`/datasource/`cwd`, continua com `status`/`stop` saindo 1 e "Backend ownership mismatch; no process was signalled.", sem sinal.
- **Verificação planejada:**
  - J3 e J4 de `test/service-journey.test.ts` continuam verdes (guarda contra correção larga demais);
  - a leitura do diff confirma que `alive()`, o caminho positivo, o formato do pidfile e as mensagens não mudaram.
- ❗️ **Lacuna de cobertura:** a janela não tem red observável (protótipos do planejamento: o linger já virou `Z`; o laço deu 0 em 20). Registre "closed by construction, not observed", como na 0.3.6. Não acrescente um teste que injete `/proc` nem um modo de teste no produto.

**K4. O comportamento da 0.3.6 continua** [V]
- J1 a J4 em `npm test`.
- J5 e J6 no `test:capture`:
  - `orphanStop.codes` = `[0]`;
  - `pidfilePointsToLiveJvm` = true;
  - `logicalSha256` igual;
  - banco original igual;
  - durações abaixo de 600 s e 1200 s;
  - a listagem do `.preview/` do PT igual antes e depois.

**K5. Entrega**
- `main` = `origin/main` = `v0.3.7^{commit}` = SHA7, e as tags anteriores sem mudança. PR `MERGED`.
- `current` → SHA7, e as 4 configs diferem de `configs-before/` só no `toolCommit`.
- O pin do lançador está em SHA7, sincronizado com o origin.
- O publish e o resume foram validados, e o catálogo tem 12 entradas iguais e 13 no total.
- O `logicalSha256` é igual antes e depois, e os booleanos de preservação são iguais aos da 0.3.6.
- O release `0.3.7` foi lido de volta sem vazamentos, e a branch foi removida.

## Progress

- [x] S0 branch `fix/backend-exit-window` (main = origin/main = v0.3.6 = 4e81e92) e `configs-before/`: 4 configs com `toolCommit` 4e81e92, `service.json` PT/EN, `current.readlink` = 4e81e92, pidfile PT `{"pid":1086910,"starttime":5782540}` (PID morto), EN ausente; nenhum `restoration.json`. Ferramentas copiadas da 0.3.6 para `release-0.3.7/tools/`.
- [x] S1 red (`red.log`): K1 na 4e81e92 com 4 de 4 passando e `duration_ms` 79353. K3 sem red por caminho público, registrado com as observações do planejamento; o protótipo não foi repetido.
- [x] S2 green: timer do J1 cancelado por `AbortController` (sinal no `delay`, `abort()` logo depois do `race`; a rejeição vira `'cancelled'`, que não pode vencer o `race`). `preview/service.ts`: `processStat` lê as flags (campo 9) e `ownedPid` usa `stoppedOrExiting` só no ramo da divergência; `alive()` igual. `green-service.log`: 4 de 4 em 5 repetições, `duration_ms` 9122, 9342, 9089, 8966 e 9013.
- [x] S3 versão 0.3.7, linha "Open:" (rota `ready` fechada pela v0.3.6, `register-codespace` aberto), seção "Ownership check during backend exit (0.3.7)", `docs/validation/exit-window-0.3.7/local.json` e `release/public-files.json`. Pré-checagem em `dev/`: build, typecheck, `npm test` 114/114 e `check` com exit 0. O `run-final.mjs` copiado lê o `local.json` novo e roda o `service-journey` mais uma vez no build final (K1).
- [ ] S4 validação final: em andamento a partir daqui; este arquivo congela.
- [ ] S5 em andamento depois da validação. S5–S11: registrados em `$EV/EXECPLAN.md` e `release-0.3.7/executor-report.md`

## Validation

Rode sobre o tree exato que será commitado, já com este plano congelado. Mova qualquer tentativa que falhar para `final-attempt<N>/`, sem contá-la como aprovação.

Com `ENOIS_PREVIEW_EVIDENCE=$EV/release-0.3.7/final`, rode, nesta ordem, os comandos abaixo; todos devem sair com 0:
1. `npm ci --ignore-scripts`
2. `npm run build`
3. `npm run typecheck`
4. `npm test`: 114 testes, 0 fail e 0 skip. Registre também a `duration_ms` do `service-journey` (K1).
5. `npm run check`
6. `ENOIS_PREVIEW_EXAMPLE_WORKSPACE=~/projects/enois/.local/public-walkthrough-ts-pt npm run test:capture`: K4, com o `.preview/` listado antes e depois.
7. `npm run test:consumer`: o consumer instalado com 114 testes, lidos do `test.log` dele, não da contagem externa (erro do `final-attempt1` da 0.3.6).
8. `npm run test:install`

Grave `release-0.3.7/final/validation.json` com:
- o tree antes e depois (iguais);
- as contagens observadas comparadas com o `local.json`;
- o `capture-validation.json`.

**Paradas:**
- K1 sem red na `4e81e92`;
- J3 ou J4 falharem;
- algum `restoration.json` pendente ou alguma operação não concluída;
- o merge não ser fast-forward;
- a instalação, uma ação do service, o publish ou o resume falharem, depois de no máximo um `resume`;
- o `logicalSha256` divergir;
- qualquer validação falhar;
- o tree mudar entre a validação e o commit.
