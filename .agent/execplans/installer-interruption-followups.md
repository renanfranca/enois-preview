# Fechar as três pendências da interrupção do instalador

## Purpose and success

O commit `c0717e2` (branch `feat/one-command-install`, já enviada a `origin`, ainda sem PR e sem release) fez o `enois-preview install` e o instalador direto obedecerem ao Ctrl+C. A revisão de 13 de novembro de 2026 achou três pendências menores, e o mantenedor pediu para fechá-las antes do PR:

1. **Mensagem cita um log que não existe.** Se a interrupção chega depois de a instalação ser criada e antes do download do Chromium (durante a troca do `current` ou o `npm link`), o instalador imprime `Chromium, used by the public validation, was not installed (see <prefixo>/logs/<commit>-browser.log). …`. Esse arquivo não existe, porque `run` (`preview/state.ts:24`) rejeita com o sinal já abortado antes de abrir o log.
2. **Ponto de entrada sem teste.** O `process.exit()` de `scripts/install-tool.ts:92`, que impede um socket abandonado de prender o processo interrompido, só foi conferido à mão. Os testes A4 e A5 usam `test/fixtures/install-driver.ts`, que chama `runInstaller` sem essa linha. Este é o caminho do `install.sh`.
3. **Retentativa do Chromium depois de SIGKILL não verificada.** O instalador mata o grupo do `npx playwright install chromium` com SIGKILL. Não se sabe na prática se a linha `retry with:` funciona logo depois.

Depois desta mudança: a mensagem do Chromium só cita um log que existe; um teste automático falha se o instalador direto ficar preso depois de SIGINT ou SIGTERM com download pendente; e há evidência registrada de que a retentativa do Chromium funciona depois da interrupção.

Sucesso: os critérios B1 a B3 têm evidência registrada em `Progress`, e a validação final passa.

## Context and limits

Fatos conferidos no planejamento, em `3453b09`:

- **Fluxo depois do ponto sem volta** (`scripts/install-tool.ts`): linha 54 `signal?.throwIfAborted()`, linha 55 `rename(root, destination)`, linhas 56 e 57 trocam o `current`, linha 58 faz o `npm link` sem sinal, linha 60 define `browserLog`, linha 61 chama `run` do `npx` com `signal`, linha 63 imprime a mensagem com `(see ${browserLog})`, linha 64 relança `signal.reason` quando abortado.
- **`run`** (`preview/state.ts:23-62`): a primeira instrução é `options.signal?.throwIfAborted()`, antes de `privateDir` e do `open` do log. Com o sinal já abortado, nada é criado nem executado. Se o aborto chegar durante o `await privateDir` ou o `await open`, o log já foi criado (truncado) quando a segunda conferência (linha 31) rejeita.
- **`listenForInterruption`** (`preview/state.ts:136`) imprime `Interrupted by <SINAL>; cancelling active work and completing required restoration.` e aborta com `PreviewError('Interrupted by <SINAL>.')`. `runInstaller` imprime a mensagem do erro sem prefixo e devolve 130 ou 143.
- **Teste existente com proxy** para o ponto de entrada: `test/integration/install-tool.test.ts:64-90` chama `dist/scripts/install-tool.js` via `command(...)` com `NODE_USE_ENV_PROXY: '1'`, `HTTPS_PROXY` e `NO_PROXY: ''`, e confere `tunnels` igual a `['codeload.github.com:443']`. O teste A2 de `test/cli-journey.test.ts` (função `installProxy('hold')`) mostra como segurar o túnel e destruir os sockets no fim.
- **Observação do planejamento (B1):** com um proxy que segura o `CONNECT`, `node dist/scripts/install-tool.js --commit bbbb…b --prefix <temp>` com `HOME` temporário recebeu SIGINT e saiu com 130 em 4 ms, `stderr` `Interrupted by SIGINT; cancelling active work and completing required restoration.\nInterrupted by SIGINT.\n`, prefixo sem sobras. O plano anterior registrou que, sem o `process.exit()`, o processo fica preso (vermelho de A2).
- **Playwright 1.64.1** (`node_modules/playwright-core/lib/coreBundle.js`), lido no planejamento:
  - `install` pega um lock em `<cache>/__dirlock` (proper-lockfile) com `retries: 20, factor: 1.27579`, cerca de 10 minutos ao todo; o padrão `stale: 1e4` torna obsoleto em 10 s um lock cujo dono morreu.
  - `downloadBrowserWithProgressBar` pula o download só se `<diretório do navegador>/INSTALLATION_COMPLETE` existir; sem o marcador, baixa de novo.
  - O download corre num processo filho (`childProcess.fork`), que fica no mesmo grupo e morre com o SIGKILL do grupo.
  - Hipótese a confirmar em B3: a retentativa funciona, talvez esperando uns 10 s pelo lock; sobra um `playwright-download-*` no diretório temporário do sistema.
- `npm test` roda `dist/test/*.test.js` (123 testes hoje). `npm run test:install` roda `dist/test/integration/install-tool.test.js` (6 testes hoje). Node 24.16.0.

Limites:

- Continuar na própria `feat/one-command-install`, sem branch nova: é a mesma tarefa, e o PR deve sair já corrigido (decisão do mantenedor em 13 de novembro de 2026).
- Não mudar `package.json` (versão `0.3.8`), `CHANGELOG.md`, `docs/en/CHANGELOG.md`, `VALIDATION.md`, `release/public-files.json`, `install.sh`, a assinatura de `run` nem o texto de `listenForInterruption`.
- Não mudar o texto da mensagem do Chromium além de omitir o trecho `(see …)` no caso de B2.
- Os testes automáticos não usam rede real nem tocam em `~/.local/share/enois-preview`, `~/.config/enois-preview-ts`, `~/.cache/ms-playwright` ou no link global do npm. `HOME`, prefixo e `NPM_CONFIG_PREFIX` são temporários.
- B3 é manual e usa rede real, num cache do Playwright isolado (`PLAYWRIGHT_BROWSERS_PATH` temporário). Se B3 mostrar que a retentativa falha, **não corrigir neste plano**: registrar a evidência em `Progress` e parar para o mantenedor decidir.
- A documentação continua válida: a receita 1 já diz que a interrupção depois de criada a instalação a deixa completa e que basta rodar o comando da mensagem. Só mudar `docs/*/RECIPES.md` se B3 revelar algo que o operador precise saber, e então nos dois idiomas, com o mesmo conteúdo.

Obrigações de quem executa, antes de entregar:

- Reconferir cada expectativa contra as fontes citadas, separadamente de conferir se o teste a demonstra.
- Ver cada teste novo falhar antes da correção, pelo motivo esperado, e registrar isso em `Progress`. Para B1, o código já está correto: remover temporariamente a linha `if (process.exitCode === 130 || process.exitCode === 143) process.exit();` de `scripts/install-tool.ts`, recompilar, ver o teste falhar por tempo esgotado e restaurar a linha.
- Registrar em `Progress`, para cada critério, o comando, o resultado observado e o teste ou procedimento que o cobre. A suíte verde sozinha não prova cada critério.
- Registrar o que ficou sem cobertura ou sem verificação. Não apresentar como satisfeito um critério com lacuna.

## Decisions

- **Interrupção antes do Chromium não roda o `npx` e não cita log.** Logo antes da chamada da linha 61, se `signal?.aborted`, imprimir `Chromium, used by the public validation, was not installed. The installation is complete; retry with: (cd <destino> && npx --no-install playwright install chromium)` e relançar `signal.reason`. Se o aborto chegar depois dessa conferência, o fluxo de hoje continua, e o log citado existe, porque `run` já o abriu (ver Context). Alternativa descartada: citar o log só se o arquivo existir. Ela citaria um log antigo do mesmo commit, deixado por uma instalação anterior que o operador apagou à mão. Consequência: a mensagem é a mesma de hoje sem o trecho `(see …)`, e a receita 1 continua correta.
- **B3 é verificação, não correção.** Pelo código do Playwright, a retentativa deve funcionar. Este plano só registra a evidência. Se ela contradisser a hipótese, a correção é decisão separada do mantenedor.

## Milestones

### M1. Teste do ponto de entrada do instalador direto (B1)

Comportamento: o `install.sh` executa `node dist/scripts/install-tool.js`; interrompido com o download pendente, esse processo devolve o terminal em poucos segundos.

Teste novo em `test/integration/install-tool.test.ts`, que roda em `npm run test:install`. Siga o padrão do teste da linha 64 (ponto de entrada real, proxy local) e do A2 de `test/cli-journey.test.ts` (proxy que segura o túnel, `child.kill(sinal)`, espera limitada, `finally` que destrói os sockets e fecha o proxy). Reaproveite `within(...)` do mesmo arquivo ou uma espera equivalente de 10 s.

- **B1.** Contexto: proxy `node:http` local que aceita o `CONNECT` e segura o socket sem responder; ambiente do filho com `HOME` temporário, `NODE_USE_ENV_PROXY: '1'`, `HTTPS_PROXY`, `https_proxy`, `NO_PROXY: ''`, `no_proxy: ''`; SHA `'b'.repeat(40)`; prefixo temporário. Ação: `node dist/scripts/install-tool.js --commit <SHA> --prefix <prefixo>`, esperar o proxy registrar o túnel, enviar o sinal. Repetir para SIGINT e SIGTERM no mesmo teste. Resultado: termina em até 10 s (senão o teste mata com SIGKILL e falha); código 130 e 143; `stdout` vazio; `stderr` exatamente `Interrupted by <SINAL>; cancelling active work and completing required restoration.\nInterrupted by <SINAL>.\n`; túneis `['codeload.github.com:443']`; o prefixo não contém `<SHA>`, `current` nem nome começado por `.staging-`. Resultado errado que o teste distingue: o processo preso pelo socket do túnel quando falta o `process.exit()`.

Edições: só o teste. Vermelho obrigatório conforme as obrigações acima.

Validação: `npm run test:install` com exit 0 e 7 testes.

### M2. A mensagem do Chromium só cita log que existe (B2)

Comportamento: interrompido depois de criada a instalação e antes do download do Chromium, o instalador sai com 130, mantém a instalação e não manda o operador a um arquivo inexistente.

Teste novo em `test/integration/install-tool.test.ts`. Base: o teste `interrupting the installer while it fetches Chromium…` (linha 230), com `npm` real para `ci` e `build`.

- **B2.** Contexto: diretório `tools` à frente do `PATH` com dois comandos falsos. Um `npm` que delega ao `npm` real para tudo, menos `link`. O caminho absoluto do `npm` real é resolvido antes de montar o `PATH`, por exemplo com `command -v npm`. No `link`, ele grava o próprio PID num arquivo e espera um arquivo `go` aparecer, consultando a cada 0,1 s, por no máximo 60 s; depois sai com 0. E um `npx` que só grava o próprio PID e sai com 0. Ação: esperar o PID do `npm link`, enviar SIGINT ao instalador, criar o arquivo `go`, esperar o fim com limite de 10 s. Resultado:
  - código 130;
  - `stdout` vazio;
  - `stderr` contém `Interrupted by SIGINT; cancelling active work and completing required restoration.` e a linha `Chromium, used by the public validation, was not installed. The installation is complete; retry with: (cd <prefixo>/<commit> && npx --no-install playwright install chromium)`; não contém `(see `;
  - `<prefixo>/logs/<commit>-browser.log` não existe;
  - o arquivo de PID do `npx` falso não existe, ou seja, o `npx` não rodou;
  - `<prefixo>/<commit>/install.json` traz o `commit`;
  - `readlinkSync(<prefixo>/current)` é o `<commit>`.

  Resultado errado que o teste distingue: hoje a linha traz `(see <prefixo>/logs/<commit>-browser.log)` e esse arquivo não existe.

Edição em `scripts/install-tool.ts`, conforme a decisão: antes da chamada `run` do `npx`, se `signal?.aborted`, imprimir a linha sem `(see …)` e relançar `signal.reason`. Manter intacto o tratamento existente da falha durante o `npx`, com `(see …)`. Para não repetir o texto, extraia a parte comum da linha numa constante ou função local.

Validação: `npm run test:install` com exit 0 e 8 testes; o teste A5 (linha 230) continua verde e continua vendo `retry with:`.

### M3. Retentativa do Chromium depois da interrupção (B3, manual)

Comportamento a verificar: depois de o instalador matar o grupo do Playwright com SIGKILL no meio do download, o comando `retry with:` instala o Chromium.

Procedimento, com rede real, na raiz do repositório (o `playwright` já está em `node_modules`). O cache fica isolado num diretório temporário `$P` e é apagado no fim:

1. `P=$(mktemp -d)`; `PLAYWRIGHT_BROWSERS_PATH=$P setsid npx --no-install playwright install chromium > $P.log 2>&1 &` e guardar o PID (é o líder do grupo).
2. Esperar aparecer em `$P` um diretório `chromium-*` ou `chromium_headless_shell-*`, ou o arquivo `$P/__dirlock`, e então `kill -KILL -- -<PID>`.
3. Registrar o conteúdo de `$P` (há `__dirlock`? há diretório sem `INSTALLATION_COMPLETE`?).
4. Rodar `PLAYWRIGHT_BROWSERS_PATH=$P npx --no-install playwright install chromium` e medir o tempo.
5. Esperado: exit 0; todo diretório `chromium*` em `$P` contém `INSTALLATION_COMPLETE`. Registrar o tempo e o que sobrou em `/tmp/playwright-download-*`.
6. Apagar `$P`, `$P.log` e as sobras `playwright-download-*` criadas por este procedimento.

Se a máquina não tiver rede, registrar B3 como não verificado. Se o passo 4 falhar, registrar a saída e parar (ver Limites).

Validação: evidência dos passos 3 a 5 em `Progress`.

## Progress

- [x] M1: B1 vermelho (sem `process.exit()`) e verde, com SIGINT e SIGTERM.
  - Teste: `the installer command interrupted while its download is pending ends promptly and leaves no partial installation` em `test/integration/install-tool.test.ts`, no ponto de entrada real `dist/scripts/install-tool.js`, com proxy que segura o `CONNECT`, para SIGINT (130) e SIGTERM (143).
  - Vermelho: com a linha `if (process.exitCode === 130 || process.exitCode === 143) process.exit();` removida temporariamente, `npm run test:install` saiu com 1, 6 de 7, e o teste novo falhou com `The interrupted installer did not end within 10 s` (10,09 s). Linha restaurada; `git diff scripts/` vazio nesse momento.
  - Verde: `npm run test:install` exit 0, 7 de 7; o teste novo levou cerca de 0,13 s para os dois sinais.
- [x] M2: B2 vermelho (linha com `(see …)`) e verde; A5 continua verde.
  - Teste: `interrupting the installer after the installation is created and before Chromium keeps the installation, skips Chromium and names no missing log`. O `npm` falso delega ao caminho absoluto do `npm` real (resolvido com `command -v npm` antes de montar o `PATH`), menos no `link`, que grava o PID e espera o arquivo `go`; o `npx` falso só grava o PID.
  - Vermelho: exit 1, 7 de 8; o `stderr` trazia `Chromium, used by the public validation, was not installed (see <prefixo>/logs/cccc…-browser.log). …`, como previsto.
  - Correção em `scripts/install-tool.ts`: função local `browserMissing(detail)` com o texto comum; antes do `run` do `npx`, se `signal?.aborted`, imprime a linha sem `(see …)` e relança `signal.reason`. A falha durante o `npx` continua citando o log.
  - Verde: `npm run test:install` exit 0, 8 de 8; A5 (`interrupting the installer while it fetches Chromium…`) verde e ainda vê `retry with:`.
- [x] M3: B3 executado e registrado (13 de novembro de 2026, rede real, Playwright 1.64.1, `PLAYWRIGHT_BROWSERS_PATH` temporário).
  - Primeira tentativa descartada: o download terminou antes do SIGKILL. Na segunda, o `kill -KILL -- -<PID>` do passo 2 falhou com `No such process`, porque o shell tinha controle de jobs e o `setsid` bifurcou; o grupo real (1439197, com `npm exec`, `playwright install` e `oopBrowserDownload.js`) foi identificado com `ps` e morto com SIGKILL quando o log mostrava 70% de 191,1 MiB. Ajuste para quem repetir: obter o PGID com `ps` em vez de usar `$!`.
  - Passo 3, depois do SIGKILL: `$P` continha `__dirlock`, `.links/…` e `chromium-1248/chrome-linux64` **sem** `INSTALLATION_COMPLETE`; sobrou `/tmp/playwright-download-Hh13y9` com 192 MB.
  - Passos 4 e 5: `PLAYWRIGHT_BROWSERS_PATH=$P npx --no-install playwright install chromium` saiu com 0 em 28,0 s (inclui a espera pelo lock obsoleto e os downloads de Chromium, FFmpeg e Headless Shell). A saída começou com `Removing unused browser at $P/chromium-1248` e baixou de novo. Depois, `chromium-1248` e `chromium_headless_shell-1248` têm `INSTALLATION_COMPLETE`, e o `__dirlock` sumiu.
  - A sobra `/tmp/playwright-download-Hh13y9` do processo morto **não** foi removida pela retentativa; é lixo no diretório temporário do sistema, sem efeito sobre a retentativa. Decisão: não mudar `docs/*/RECIPES.md`, porque a receita 1 (rodar o comando da mensagem) continua correta e a sobra não exige ação do operador.
  - Passo 6: `$P`, `$P.log` e `/tmp/playwright-download-Hh13y9` apagados; não havia `playwright-download-*` antes do procedimento.
- [x] Validação final: `npm run typecheck` exit 0; `npm test` exit 0, 123 de 123, `fail 0`; `npm run test:install` exit 0, 8 de 8, `fail 0`. `git status` lista só `scripts/install-tool.ts`, `test/integration/install-tool.test.ts` e este plano.

Sem cobertura automática: B3 continua manual e depende da rede e do CDN do Playwright; a janela em que o aborto chega durante o `await privateDir` ou o `await open` dentro de `run` (log já criado, ver Context) não tem teste próprio, mas nela o log citado existe.

Linha de base observada no planejamento, em `3453b09`: `npm run typecheck` exit 0; `npm test` 123 de 123; `npm run test:install` 6 de 6.

## Validation

| Critério | Fonte da expectativa | Prova planejada |
| --- | --- | --- |
| B1 ponto de entrada interrompido com download pendente sai com 130 e 143 em até 10 s, sem sobras | `scripts/install-tool.ts:89-93`; decisão sobre `process.exit` em `.agent/execplans/install-interruption-and-network-errors.md` | Teste novo em `test/integration/install-tool.test.ts` |
| B2 interrupção antes do Chromium não roda `npx` e não cita log inexistente | Decisão desta ExecPlan; `preview/state.ts:24` | Teste novo em `test/integration/install-tool.test.ts` |
| B3 `retry with:` funciona depois do SIGKILL do grupo do Playwright | Leitura do Playwright 1.64.1 (Context) | Procedimento manual de M3 |

Validação final, nesta ordem. O commit só acontece se as três passarem:

1. `npm run typecheck` com exit 0 e sem erros.
2. `npm test` com exit 0, `fail 0`, 123 testes.
3. `npm run test:install` com exit 0, `fail 0`, 8 testes (6 de hoje mais B1 e B2). Se a contagem for outra, registrar o número e o motivo em `Progress`.

Depois da validação, `git status --porcelain --untracked-files=all` deve listar só `scripts/install-tool.ts`, `test/integration/install-tool.test.ts` e este plano. Também `docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`, se B3 justificar a mudança prevista em Limites.

## Risks

- **B2 depende de um `npm` falso que delega ao real.** Se o `npm` real for um script que se resolve pelo `PATH`, a delegação pode chamar o falso de novo. Resolver o caminho absoluto antes de montar o `PATH` evita o laço; se ainda assim houver recursão, o teste trava e o limite de 10 s, ou o de 60 s para o PID aparecer, o derruba.
- **B3 depende da rede e do CDN do Playwright.** Uma falha de rede no passo 4 não prova defeito: repetir uma vez e, se persistir, registrar como não verificado.
- **Testes com sinal podem oscilar em máquina carregada.** O disparo espera um evento observável (túnel registrado ou arquivo de PID), nunca um tempo fixo.
