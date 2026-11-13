# Fazer a instalação obedecer ao Ctrl+C e explicar falhas de rede

## Purpose and success

O commit `c1261c2` (branch `feat/one-command-install`, ainda sem PR e sem release) trouxe o `install.sh`, o Chromium automático e o subcomando `enois-preview install <SHA>`. A revisão de 13 de novembro de 2026 achou dois defeitos nesse caminho novo, e o mantenedor pediu a correção antes do PR, porque uma instalação é imutável: o que for fixado no lançador fica com o defeito.

1. **A instalação ignora o Ctrl+C.** `enois-preview install` imprime `Interrupted by SIGINT; cancelling active work and completing required restoration.` e continua. Se o download estiver pendente, o processo fica preso. Se estiver compilando, vai até o fim, troca o `current` e sai com 0.
2. **Falha de rede vira mensagem sobre "entrada privada".** Sem rede, `enois-preview install <SHA>` responde `Installation incomplete: Invalid or unavailable private input. Run enois-preview --help.`, embora o comando não leia entrada privada nenhuma.

Depois desta mudança, quem interrompe uma instalação recebe o processo de volta em poucos segundos, com código 130 (SIGINT) ou 143 (SIGTERM), sem processos filhos órfãos e sem instalação pela metade. Quem está sem rede lê que o download falhou e que deve conferir a conexão.

Sucesso: os critérios A1 a A6 têm evidência registrada em `Progress`, e a validação final passa.

## Context and limits

Fatos conferidos no planejamento, em `c1261c2`:

- **Por que o Ctrl+C é ignorado.** `preview/cli.ts:27` chama `listenForInterruption()` (`preview/state.ts:136`), que registra um tratador de SIGINT e SIGTERM. O tratador só aborta um `AbortController`; o Node deixa de encerrar o processo sozinho. O ramo `install` (`preview/cli.ts:55-60`) chama `installTool(positionals[1] ?? '')` sem passar esse sinal, então nada reage ao aborto.
- **`installTool`** (`scripts/install-tool.ts:12`) não tem parâmetro de sinal. O `fetch` da linha 20 e as quatro chamadas a `run` (linhas 35, 36, 46 e 49) rodam sem `signal`.
- **`run` já sabe cancelar.** `preview/state.ts:23` aceita `signal`. No aborto, mata o grupo de processos do filho com SIGKILL e rejeita com `signal.reason` (linhas 46 e 54). O motivo criado por `listenForInterruption` é `new PreviewError('Interrupted by SIGINT.')` ou `'Interrupted by SIGTERM.'`.
- **No Linux, `run` cria o filho em outro grupo de processos** (`detached: platform === 'linux'`, linha 33). Por isso o Ctrl+C do terminal não chega ao `npm ci` nem ao `npm run build`.
- **O instalador direto tem o problema inverso.** `runInstaller` (`scripts/install-tool.ts:58`), usado por `node dist/scripts/install-tool.js` e pelo `install.sh`, não registra tratador. O Node morre no SIGINT, o bloco `finally` que apaga `.staging-*` não roda, e o `npm` em outro grupo continua vivo. Isto foi lido no código, não reproduzido. O teste do marco M2 precisa nascer vermelho para confirmar.
- **Códigos de saída.** O `catch` de `main` devolve `interruption.exitCode ?? 1` (`preview/cli.ts:124`), ou seja, 130 e 143. O teste existente em `test/cli-journey.test.ts:265-288` já fixa esses valores para o `setup`.
- **Mensagem de rede.** O `fetch` rejeita com `TypeError` quando não há rede. O `catch` de `main` (`preview/cli.ts:123`) troca todo erro que não é `PreviewError` por `Invalid or unavailable private input. Run enois-preview --help.` O `runInstaller` troca por `Installation failed; inspect the logs under the installation prefix.` (linha 70), que também não ajuda: nesse ponto ainda não existe log.
- **Ordem dos efeitos em `installTool`.** Até a linha 42 tudo acontece dentro de `<prefixo>/.staging-*`, apagado no `finally`. A linha 43 (`rename(root, destination)`) cria a instalação. As linhas 44 e 45 trocam o `current`. A linha 46 faz o `npm link`. A linha 49 baixa o Chromium, com limite de 1800 s, e hoje converte qualquer `PreviewError` em `browser: false`.
- **Observações do planejamento** (comandos de leitura, em diretórios temporários, com um proxy HTTP local e `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY=<proxy>`, `NO_PROXY=''`, `HOME=<temporário>`):
  - Proxy que recusa o `CONNECT` com 403: `node dist/preview/cli.js install bbbb…b` (40 letras) sai com 1 em 89 ms, pede só o túnel `codeload.github.com:443` e imprime a mensagem de "private input".
  - Proxy que aceita o `CONNECT` e não responde: depois do SIGINT o processo continua vivo por mais de 3 s, e `<HOME>/.local/share/enois-preview/.staging-*` fica no disco.
  - Instalação real isolada, com SIGINT aos 4 s: saiu com 0 e trocou o `current`.

  Isto prova que o proxy local é um ponto de observação sem rede real para A1 e A2. O teste existente `the installer command downloads only from the public codeload origin…` (`test/integration/install-tool.test.ts:35`) já usa a mesma técnica.

Limites:

- Trabalhar na própria `feat/one-command-install`, a partir de `c1261c2`, sem criar branch nova (decisão do mantenedor em 13 de novembro de 2026, para o PR sair já corrigido). A `main` ainda não tem o `install.sh`.
- Não mudar `package.json` (versão continua `0.3.8`), `CHANGELOG.md`, `docs/en/CHANGELOG.md`, `VALIDATION.md` nem `release/public-files.json`. O recurso ainda não foi lançado, então as correções não são mudança de comportamento de uma versão publicada. O texto "0.3.9" que já está nos guias e no changelog é uma decisão separada do mantenedor.
- Não mudar `install.sh`. O `trap … EXIT` dele já apaga o diretório temporário do bootstrap.
- Não mudar a assinatura de `run` nem o texto de `listenForInterruption`.
- Não adicionar `--prefix` ao subcomando `install`. Só o comentário errado em `preview/cli.ts:56` é corrigido (M1).
- Os testes não usam rede real nem tocam em `~/.local/share/enois-preview`, em `~/.config/enois-preview-ts` ou no link global do npm. Todo teste usa `HOME`, prefixo e `NPM_CONFIG_PREFIX` temporários.
- A documentação descreve só o comportamento atual (regra de `CHANGELOG.md:5`).

Obrigações de quem executa, antes de entregar:

- Reconferir cada expectativa contra as fontes citadas acima, separadamente de conferir se o teste a demonstra.
- Ver cada teste novo falhar antes da correção, pelo motivo esperado, e registrar isso em `Progress`. A1 e A2 já têm o vermelho observado no planejamento; A3 a A5 ainda não.
- Registrar em `Progress`, para cada critério, o comando, o resultado observado e o teste que o cobre. A suíte verde sozinha não prova cada critério.
- Registrar o que ficou sem cobertura ou sem verificação. Não apresentar como satisfeito um critério com lacuna.

## Decisions

- **Interrupção cancela tudo até a instalação existir; depois disso, só o Chromium é cancelável.** O ponto sem volta é o `rename(root, destination)`. Antes dele, o aborto mata o filho ativo, apaga o `.staging-*` e não deixa instalação nem `current`. Uma conferência `signal?.throwIfAborted()` fica imediatamente antes do `rename`. Depois dele, a troca do `current` e o `npm link` rodam sem sinal, porque juntos levam poucos segundos e uma instalação criada sem o comando ligado seria um estado que o instalador recusa refazer (`is already installed`). Alternativa descartada: desfazer a instalação no aborto, que exigiria restaurar o `current` e o link anteriores.
- **Interrupção durante o Chromium sai com 130 e mantém a instalação.** O download do navegador pode levar minutos, então precisa ser cancelável. A instalação já está completa nesse ponto. O instalador imprime a mesma linha `Chromium, used by the public validation, was not installed … retry with: …` e relança o motivo do aborto, em vez de devolver `browser: false` com código 0. Consequência: o JSON final não é impresso nesse caso; a linha do Chromium diz o que falta.
- **`runInstaller` passa a registrar o tratador de interrupção.** Alternativa: deixar o Node morrer no sinal, como hoje. Descartada porque deixa `npm` órfão e `.staging-*` no disco, e porque é o caminho do `install.sh`. Consequência: o instalador direto também imprime a linha `Interrupted by …` e sai com 130 ou 143.
- **Texto da falha de rede:** `Download of <URL do arquivo> failed; check the network connection and retry.` Ele cobre tanto o `fetch` que rejeita quanto o corpo que quebra no meio. A mensagem de HTTP (`failed (HTTP <status>).`) não muda. Num aborto, o motivo do aborto prevalece sobre este texto.
- **Erro inesperado no `install` do CLI usa o texto do instalador.** Para o comando `install`, o `catch` de `main` passa a usar `Installation failed; inspect the logs under the installation prefix.` no lugar de `Invalid or unavailable private input…`. Os outros comandos ficam como estão.
- **Processo interrompido encerra com `process.exit` nos pontos de entrada.** Achado na execução de A2: no aborto, o `fetch` rejeita em cerca de 1 s e `main` devolve 130, mas o socket do túnel que o proxy segura continua aberto e mantém o laço de eventos vivo; o processo não sai. Escolha: em `preview/cli.ts` e `scripts/install-tool.ts`, quando o código de saída for 130 ou 143, chamar `process.exit()` depois que `main` ou `runInstaller` terminam. Isso vale para todo comando interrompido do CLI, não só para o `install`, porque `main` já aguardou toda restauração antes de devolver. Alternativa descartada: fechar o agente HTTP global do Node, que exigiria depender de `undici` diretamente. Consequência: o teste de `main` importado no mesmo processo não é afetado, porque a saída forçada fica só no ponto de entrada.

## Milestones

### M1. `enois-preview install` cancela e explica a rede

Comportamento: critérios A1, A2 e A3.

Testes novos em `test/cli-journey.test.ts`, que roda em `npm test`. Use um proxy `node:http` local como o de `test/integration/install-tool.test.ts:39-41`, com `HOME` num diretório temporário e `NODE_USE_ENV_PROXY: '1'`, `HTTPS_PROXY`, `https_proxy`, `NO_PROXY: ''`, `no_proxy: ''` no ambiente do filho. O SHA dos exemplos é `'b'.repeat(40)`.

- **A1, falha de rede.** Contexto: o proxy responde `403` ao `CONNECT`. Ação: `node dist/preview/cli.js install <SHA>`. Resultado: código 1; `stdout` vazio; `stderr` exatamente `Installation incomplete: Download of https://codeload.github.com/renanfranca/enois-preview/tar.gz/<SHA> failed; check the network connection and retry.\n`; o proxy viu só `['codeload.github.com:443']`; `<HOME>/.local/share/enois-preview` não contém `<SHA>`, `current` nem nome começado por `.staging-`. Resultado errado plausível que o teste distingue: a mensagem de "private input" de hoje.
- **A2, interrupção com o download pendente.** Contexto: o proxy aceita o `CONNECT` e segura a conexão sem responder. Ação: esperar o proxy registrar o túnel, enviar o sinal ao filho e esperar o fim com um limite de 10 s (acima disso o teste mata com SIGKILL e falha). Repetir para SIGINT e SIGTERM. Resultado: código 130 e 143; `stderr` exatamente `Interrupted by <SINAL>; cancelling active work and completing required restoration.\nInstallation incomplete: Interrupted by <SINAL>.\n`; `stdout` vazio; nenhum `.staging-*`, `<SHA>` ou `current` no prefixo. O teste deve destruir as conexões seguradas e fechar o proxy no `finally`. Resultado errado que o teste distingue: o processo preso de hoje.
- **A3, erro inesperado.** Contexto: `<HOME>/.local` é um arquivo comum, então criar o prefixo falha com um erro que não é `PreviewError`. Ação: o mesmo comando, sem proxy. Resultado: código 1 e `stderr` exatamente `Installation incomplete: Installation failed; inspect the logs under the installation prefix.\n`. Nenhuma conexão é tentada, porque a falha vem antes do download.

Edições:

- `scripts/install-tool.ts`: `installTool` ganha um quarto parâmetro opcional `signal?: AbortSignal`. Chamar `signal?.throwIfAborted()` no início e imediatamente antes de `rename(root, destination)`. Passar `{ signal }` ao `fetch`. Envolver o `fetch` e a leitura do corpo (`response.arrayBuffer()`): se falharem com o sinal abortado, relançar `signal.reason`; se falharem por outro motivo que não seja `PreviewError`, lançar `PreviewError` com o texto da decisão. Passar `signal` aos `run` de `npm ci`, `npm run build` e do Chromium. O `run` do `npm link` continua sem sinal. No tratamento do Chromium, depois de imprimir a linha de aviso, relançar `signal.reason` quando `signal?.aborted`.
- `preview/cli.ts`: no ramo `install`, passar o sinal: `installTool(positionals[1] ?? '', undefined, undefined, signal)`. Corrigir o comentário da linha 56 para dizer que a instalação vai para o prefixo padrão `~/.local/share/enois-preview`. No `catch`, escolher o texto de reserva por comando conforme a decisão.

Validação: `npm run build && node --test dist/test/cli-journey.test.js` com exit 0.

### M2. O instalador direto, usado pelo `install.sh`, cancela e limpa

Comportamento: critérios A4 e A5.

Testes novos em `test/integration/install-tool.test.ts`, que roda em `npm run test:install`. Reaproveite `archive()`, o servidor local de arquivos e o `install()` que já existem no arquivo, com `--prefix` e `NPM_CONFIG_PREFIX` temporários. Os comandos falsos ficam num diretório `tools` posto na frente do `PATH`, como o `npx` falso da linha 82.

- **A4, interrupção durante a compilação.** Contexto: o servidor entrega um arquivo válido; um `npm` falso grava o próprio PID num arquivo e fica parado (`echo $$ > <arquivo>; exec sleep 600`). Ação: esperar o arquivo do PID existir, enviar SIGINT ao processo do instalador e esperar o fim com limite de 10 s. Resultado: código 130; `stderr` termina em `Interrupted by SIGINT.\n`; o PID do `npm` falso não existe mais ou está em estado `Z` ou `X` em `/proc/<pid>/stat`, com a mesma tolerância de `test/cli-journey.test.ts:290`; o prefixo não contém `<commit>`, `current` nem `.staging-*`. Resultado errado que o teste distingue: o `npm` órfão e o `.staging-*` deixados hoje.
- **A5, interrupção durante o Chromium.** Contexto: `npm` real, como no teste de instalação completa; um `npx` falso que grava o PID e fica parado. Ação: esperar o PID do `npx`, enviar SIGINT. Resultado: código 130; `<prefixo>/<commit>/install.json` existe e traz o `commit`; `readlinkSync(<prefixo>/current)` é o `<commit>`; `stderr` contém `Chromium, used by the public validation, was not installed` e a linha `retry with:`; `stdout` vazio; o PID do `npx` falso não está mais vivo. Este teste leva o tempo de um `npm ci` real, cerca de 12 s.
- **Controle.** O teste existente de instalação completa continua verde, com `browser: true` e código 0. Ele prova que os testes novos não passariam se o instalador recusasse tudo.

Edição em `scripts/install-tool.ts`: `runInstaller` chama `listenForInterruption()` (importar de `../preview/state.js`), passa o sinal a `installTool`, devolve `interruption.exitCode ?? 1` no `catch` e chama `interruption.dispose()` num `finally`. Para erro que não é `PreviewError`, o texto continua `Installation failed; inspect the logs under the installation prefix.`

Validação: `npm run test:install` com exit 0.

### M3. Documentar o que o operador vê

Comportamento: critério A6.

Edições na receita 1, nos dois idiomas, com o mesmo conteúdo (`docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`):

- Em **Se der errado**, uma linha nova para `Download of ... failed; check the network connection and retry.`: a máquina não alcançou `codeload.github.com`; confira a rede ou o proxy e repita. Nada foi instalado.
- Em **Atenção**, uma linha: interromper com Ctrl+C antes de a instalação ser criada não deixa nada para trás e o comando pode ser repetido; interromper durante o download do Chromium deixa a instalação completa, e basta rodar o comando que a mensagem mostra.

Não criar notas por versão. Conferir que nenhum outro guia cita as mensagens antigas: `grep -rn "private input" README.md docs` não deve achar referência ao `install`.

Validação: `npm test` com exit 0, porque a suíte pode conter conferências de documentação.

## Progress

- [x] M1: A1, A2 e A3 vermelhos antes da correção e verdes depois.
  - A1, `enois-preview install without network…` em `test/cli-journey.test.ts`. Vermelho: `stderr` era `Installation incomplete: Invalid or unavailable private input. Run enois-preview --help.`. Verde: texto `Download of https://codeload.github.com/renanfranca/enois-preview/tar.gz/<SHA> failed; check the network connection and retry.`, código 1, túneis `['codeload.github.com:443']`, prefixo sem sobras.
  - A2, `interrupting enois-preview install while the download is pending…`. Vermelho: `SIGINT did not end the installation within 10 s`. Continuou vermelho depois de passar o sinal ao `fetch`; o diagnóstico está na decisão sobre `process.exit`. Verde: 130 e 143, `stderr` exato, `stdout` vazio, prefixo sem `<SHA>`, `current` nem `.staging-*`.
  - A3, `an unexpected installation failure points at the installation logs…`. Vermelho: texto de "private input". Verde: `Installation incomplete: Installation failed; inspect the logs under the installation prefix.`, código 1.
  - `node --test dist/test/cli-journey.test.js`: 19 de 19.
- [x] M2: A4 e A5 vermelhos antes da correção e verdes depois.
  - A4, `interrupting the installer while it builds…` em `test/integration/install-tool.test.ts`. Vermelho: código `null` (o Node morreu pelo sinal, sem tratador). Verde: 130, `stderr` termina em `Interrupted by SIGINT.\n`, PID do `npm` falso encerrado, prefixo sem sobras.
  - A5, `interrupting the installer while it fetches Chromium…`. Vermelho, com o sinal já repassado mas sem o relançamento no tratamento do Chromium: código 0. Verde: 130, `stdout` vazio, linha do Chromium e `retry with:` no `stderr`, `install.json` com o `commit`, `current` apontando para `<commit>`, PID do `npx` falso encerrado.
  - Controle: o teste de instalação completa continua verde com `browser: true` e código 0.
  - `npm run test:install`: 6 de 6, exit 0.
- [x] M3: receita 1 atualizada em pt-BR e en (linha da falha de rede em **Se der errado** / **If it goes wrong** e linha do Ctrl+C em **Atenção** / **Attention**). `grep -rn "private input" README.md docs` não acha nada.
- [x] Validação final executada em 13 de novembro de 2026: `npm run typecheck` exit 0, sem erros; `npm test` exit 0, 123 de 123, `fail 0`; `npm run test:install` exit 0, 6 de 6, `fail 0`.

Linha de base observada no planejamento, em `c1261c2`: `npm test` 120 de 120; `npm run typecheck` sem erros; `node --test dist/test/integration/install-tool.test.js` 4 de 4.

Sem cobertura ou sem verificação:

- O ensaio manual `curl … | bash` com Ctrl+C num terminal real não foi feito. A4 cobre o instalador que o `install.sh` executa.
- A6 foi conferido por leitura dos dois arquivos, sem teste automático.
- Não há teste para SIGTERM no instalador direto nem para interrupção durante `npm ci` com download pendente pelo instalador direto; os dois usam o mesmo caminho de A2 e A4.
- A introdução de `docs/*/RECIPES.md` (linha 5) cita só `Publication incomplete:` e `Source digest incomplete:` como prefixos; `Installation incomplete:` do `enois-preview install` não aparece ali. Ficou fora do escopo deste plano.

## Validation

Critérios e a prova de cada um:

| Critério | Fonte da expectativa | Prova planejada |
| --- | --- | --- |
| A1 falha de rede com texto de download | Decisão "Texto da falha de rede" | Teste novo em `test/cli-journey.test.ts` |
| A2 SIGINT e SIGTERM com download pendente saem com 130 e 143, sem `.staging-*` | `preview/cli.ts:124`; `test/cli-journey.test.ts:288` | Teste novo em `test/cli-journey.test.ts` |
| A3 erro inesperado sem citar entrada privada | Decisão sobre o texto de reserva | Teste novo em `test/cli-journey.test.ts` |
| A4 SIGINT na compilação mata o `npm` e limpa o prefixo | Decisão sobre o ponto sem volta | Teste novo em `test/integration/install-tool.test.ts` |
| A5 SIGINT no Chromium sai com 130 e mantém a instalação | Decisão sobre o Chromium | Teste novo em `test/integration/install-tool.test.ts` |
| A6 a receita 1 nomeia a mensagem de rede e o efeito do Ctrl+C | M3 | Leitura dos dois arquivos |

Validação final, nesta ordem. O commit só acontece se as três passarem:

1. `npm run typecheck` com exit 0 e sem erros.
2. `npm test` com exit 0, `fail 0`, e 123 testes (120 de hoje mais A1, A2 e A3). Se a contagem for outra porque casos foram reunidos ou separados, registrar o número e o motivo em `Progress`.
3. `npm run test:install` com exit 0, `fail 0`, e 6 testes (4 de hoje mais A4 e A5).

Depois da validação, `git status --porcelain --untracked-files=all` deve listar só `scripts/install-tool.ts`, `preview/cli.ts`, `test/cli-journey.test.ts`, `test/integration/install-tool.test.ts`, `docs/pt-BR/RECIPES.md`, `docs/en/RECIPES.md` e este plano.

Sem cobertura automática, por escolha: o caminho completo `curl … | bash` com Ctrl+C num terminal real. A4 cobre o instalador que o `install.sh` executa. Quem executa deve registrar em `Progress` se fez ou não esse ensaio manual.

## Risks

- **`NODE_USE_ENV_PROXY` depende da versão do Node.** Funcionou no Node 24.16.0 usado no planejamento, e o projeto exige `>=24 <25`. Se um Node 24 mais antigo ignorar a variável, A1 e A2 tentariam a rede real. A asserção sobre os túneis vistos pelo proxy faz o teste falhar nesse caso, em vez de passar por engano.
- **Testes com sinal podem oscilar em máquina carregada.** Os limites de espera são de 10 s e o disparo espera um evento observável (túnel registrado ou arquivo de PID), nunca um tempo fixo.
- **Instalação criada e comando não ligado.** Se o `npm link` falhar por conta própria depois do `rename`, o estado continua como já era antes desta mudança. Este plano não piora nem resolve isso.
