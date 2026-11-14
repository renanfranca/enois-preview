# Ajustes da revisão da 0.4.0, antes do merge

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Purpose and success

A revisão do commit `093f958` (branch `feat/remove-preview-restrictions`, ainda sem merge) achou três pontos. Este plano corrige os três na mesma branch, antes do merge da 0.4.0.

1. **Mensagem enganosa para revisões antigas.** `enois-preview resume <REVISION>` de uma revisão criada pela 0.3.x falha com `Journal revision identity mismatch; restore the original record.`. A mensagem sugere arquivo corrompido, mas o journal está íntegro e só pertence a outra versão.
   - **Sucesso:** a recusa continua, porque a especificação não garante `resume` de revisões da 0.3.x. A mensagem passa a dizer que a revisão foi criada por uma versão anterior e manda rodar `publish` de novo.
2. **Uma garantia mantida ficou sem teste.** "Um upload com corpo incompleto não deixa objeto utilizável" perdeu o teste Java junto com `recipe/test/`.
   - **Sucesso:** um teste pela imagem real, por HTTP, prova a garantia de ponta a ponta. O upload interrompido não fica legível, e um upload novo seguinte funciona.
3. **Script de navegador frágil e fora do papel da ferramenta.** `scripts/validate-example-browser.ts` testa a interface do Énóis num Chromium: login pelo formulário, 8 posts, imagens do feed, menu "Ver meu perfil", texto "Cidade das Ideias, BA" e ausência de rolagem horizontal no celular. Para esperar a hidratação, ele lê uma propriedade interna do React (`__reactProps$`).
   - Ele não participa do `publish`.
   - É o mesmo tipo de acoplamento que quebrou na 0.3.9.
   - **Sucesso:** o script e os usos dele saem, e o resto dos testes continua verde.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, sem worktree.
  - **Fique na branch atual, `feat/remove-preview-restrictions`.** O trabalho entra no PR da 0.4.0, que ainda não teve merge.
  - Não crie outra branch.
  - O GitHub é público: nada de caminhos absolutos com nome de usuário, e-mails ou segredos no repositório.
- **Ponto 1:**
  - **Onde a mensagem nasce:** `preview/publication.ts`, `journalRecord`, na condição longa que começa com `if (canonical(inputs) !== canonical(raw) …`. A recusa acontece porque o `inputs` cru tem o campo `toolCommit` (formato da 0.3.x) e o `Inputs` atual não tem, então `canonical(inputs) !== canonical(raw)`.
  - **Formato antigo:** na base `b41202c`, `Inputs` tinha `toolCommit: string` com 40 hex (`git show b41202c:preview/publication.ts`).
  - **Cobertura existente:** `test/cli-journey.test.ts` já tem "historical scenario pointers and operation journals are refused by the CLI before creating locks or changing records". Os casos novos entram ali.
- **Ponto 2:**
  - O backend (`MediaStorageProxyController`, sem patch na 0.4.0) lê o corpo e só então chama `DemoLocalStore.write`. Um corpo incompleto pode ser barrado no backend ou no `DemoLocalStore`.
  - **O contrato observável é o mesmo nos dois casos:** nada legível no `cdnUrl` e nenhum bloqueio para o upload seguinte.
  - **Pontos de observação:** a imagem real, pelo gateway local, via `scripts/validate-media-contracts.ts` e `test/integration/media-contracts.test.ts` (`npm run test:media`). Esse script já tem o upload de 50 MB e devolve um objeto de prova (`proof`) que o teste confere.
- **Ponto 3: quem usa o script de navegador.**
  - `test/integration/application-flows.test.ts`: o segundo teste ("actual desktop and mobile emulation authenticate through the hydrated form …") só existe para chamá-lo;
  - `scripts/validate-example.ts`: o primeiro boot chama o script e grava `example-browser.json`. O resto do arquivo (reinício e recriação) não depende dele;
  - `scripts/validate-public-example.ts`: chama o script e grava `browser.json`. A mensagem final ainda cita "disposable media at the exact 20 MiB boundary", que é resto da 0.3.x;
  - `release/public-files.json`: lista `scripts/validate-example-browser.ts`.
  - **O que fica:** o Chromium e o `playwright` continuam necessários para `scripts/validate-decoding.ts`, que a validação da publicação usa. Não mexa nessa dependência.
- **Perda aceita no ponto 3:** sai a única prova num navegador real de que a adaptação de mídia na mesma origem (`src/lib/api/media.ts`) faz o frontend carregar as imagens do próprio preview. Se o texto âncora sumir do frontend, a receita continua falhando alto no `prepare` (`Demo recipe does not support the captured source contract: media.ts`).
- **Evidências:** `$EV` = `~/projects/enois/.local/preview-typescript-evidence/node24-consolidation`. Grave em `$EV/release-0.4.0/review-followups/`.
- **Não toque** nas aplicações, nos bancos, no lançador, na config da #806, nos workspaces `public-walkthrough-*` nem nas evidências anteriores.

## Milestones

### R0. Baseline
- Confira a branch `feat/remove-preview-restrictions`, o `HEAD` em `093f958` e que a única pendência é este plano.
- Rode `npm ci --ignore-scripts && npm run build && npm test`. O esperado é 118 passando.
- Grave em `review-followups/baseline.json`.

### R1. Mensagem para revisões da 0.3.x (critério A1)
- **Teste primeiro**, em `test/cli-journey.test.ts`, no teste de journals históricos ou num teste vizinho:
  - **Contexto:** um journal válido no formato atual, mais o campo `inputs.toolCommit` com 40 hex.
  - **Ação:** `enois-preview resume <revision>`.
  - **Esperado:**
    - saída 1;
    - stderr com `created by an earlier enois-preview version` e `enois-preview publish`;
    - stderr **sem** `restore the original record`;
    - o journal fica igual byte a byte;
    - nenhum lock nem operação é criado.
- **Red esperado:** a mensagem atual, `Journal revision identity mismatch; restore the original record.` Grave em `red-a1.log`.
- **Código:** em `journalRecord`, antes da comparação canônica, quando `raw` (o `inputs` cru) tiver a propriedade `toolCommit`, lance `PreviewError` com esta mensagem:

  `Revision REVISION was created by an earlier enois-preview version and cannot be resumed by this version. Run enois-preview publish SCENARIO to create a new revision, or resume it with the version that created it.`

  Troque `REVISION` e `SCENARIO` pelos valores do journal, mas só depois de validar o formato deles, usando as mesmas regex que já existem. Se não forem válidos, use os textos genéricos `this revision` e `the scenario`.
- **O que não muda:** um journal sem `toolCommit` e com inventário adulterado continua recebendo `Journal revision identity mismatch; restore the original record.` Rode o teste existente de adulteração (`test/publication-journey.test.ts`, "CLI resume refuses tampered frozen inputs …") para conferir.
- **Documentação:** em `docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`, onde a tabela de erros cita revisões da 0.3.x ou `resume`, acrescente uma linha com a mensagem nova e o remédio (`publish`). Na seção `## 0.4.0` do `CHANGELOG.md` e do `docs/en/CHANGELOG.md`, no item "Configuração da 0.3.x", diga que o `resume` de uma revisão da 0.3.x responde com essa mensagem.

### R2. Upload com corpo incompleto não deixa objeto (critério A2)
- **Teste primeiro**, em `scripts/validate-media-contracts.ts` (função `check`), com a asserção em `test/integration/media-contracts.test.ts`:
  1. o autor fictício aloca um upload `audio/wav` de 45 000 000 bytes, acima do limite em memória de 40 MiB do backend, para passar pelo caminho de arquivo temporário;
  2. o script envia `PUT` para o `uploadUrl` com `Content-Length: 45000000` e interrompe a conexão depois de cerca de 10 MB. Use `node:http` ou `node:net` direto contra a origem local, porque o `Session` envia o corpo inteiro;
  3. `GET` no `cdnUrl` desse upload **não** responde 200. Aceite 404, ou outro 4xx que o backend der, e registre o status;
  4. um **novo** upload `audio/wav` válido, do mesmo tamanho e com corpo completo, é aceito e fica legível (`HEAD` ou `GET` com `RIFF` no início, como no caso de 50 MB que já existe).
- **Prova:** grave `incompleteBody: { declaredBytes, sentBytes, readAfterAbortStatus, freshUploadReadable }`. O teste confere:
  - `readAfterAbortStatus !== 200`;
  - `freshUploadReadable === true`;
  - `sentBytes < declaredBytes`.
- **Discriminação:**
  - um armazenamento que gravasse o corpo parcial faria o `GET` do passo 3 responder 200;
  - um que deixasse a chave presa em `writing` ou travasse o espaço faria o passo 4 falhar;
  - se o passo 4 usasse um tamanho pequeno, não detectaria espaço preso, por isso o tamanho é o mesmo.
- **Red:** não se espera red, porque a garantia já existe no código. Registre em `a2-note.md` que a prova é de cobertura. Para mostrar que a asserção distingue os casos, rode uma vez com o passo 3 trocado para esperar 200 e veja falhar. Não commite essa variação.
- **Comando:** `ENOIS_PREVIEW_EXAMPLE_WORKSPACE=<workspace novo do test:example> npm run test:media`.

### R3. Tirar o script de navegador (critério A3)
- **Arquivos:**
  - apague `scripts/validate-example-browser.ts`;
  - em `test/integration/application-flows.test.ts`, remova o teste "actual desktop and mobile emulation authenticate through the hydrated form …". Os outros dois testes do arquivo ficam;
  - em `scripts/validate-example.ts`, remova a chamada ao script e a gravação de `example-browser.json`. O resto do primeiro boot fica igual (`exercise`, credenciais, órfão, reinício);
  - em `scripts/validate-public-example.ts`:
    - remova a chamada e o `browser.json`;
    - tire `browser` do `validation.json`;
    - troque a mensagem final por `Public fictional example verified: entry accounts, blog distribution/ownership and disposable media.`, sem citar navegador nem 20 MiB;
  - em `release/public-files.json`, remova a entrada do script.
- **Conferências:**
  - `grep -rn "validate-example-browser\|hydrationRequiredBeforeLogin\|nativeFallbackKeepsPasswordOutOfUrl\|__reactProps" --include=*.ts --include=*.json --include=*.md . | grep -v node_modules | grep -v '^./dist' | grep -v '^./docs/validation' | grep -v '^./.agent/'` não devolve nada;
  - se algum guia (`README.md`, `docs/en`, `docs/pt-BR`, `docs/diagnostics`) citar a verificação de login no navegador do exemplo, ajuste o texto. `VALIDATION.md` e `docs/validation/` são histórico e ficam como estão;
  - o `playwright` continua no `package.json`, e o `scripts/validate-decoding.ts` fica intacto.
- **Changelog:** no item "Exemplo" da seção `## 0.4.0` dos dois changelogs, acrescente: o verificador de navegador do exemplo (`scripts/validate-example-browser.ts`) foi removido, porque testava a interface das aplicações e dependia de um detalhe interno do React. A validação da publicação continua decodificando as imagens congeladas no Chromium.
- **Distribuição:** `npm test`, que inclui o teste de distribuição em `test/distribution-journey.test.ts`, precisa passar com a lista nova.

### R4. Validação final
- Detalhada em Validation.
- Antes dela, atualize Progress até o R4. A partir daí, este arquivo congela, e o relatório vai para `review-followups/executor-report.md`.

## Critérios de aceitação

Fontes:
- **[R]** a revisão de `093f958` (os três pontos do Purpose);
- **[S]** `.agent/specifications/remove-preview-restrictions.md`, onde "Revisions created by 0.3.x have no guaranteed resume" e onde a garantia de "unchanged behavior" mantém o armazenamento correto;
- **[B]** `b41202c:preview/publication.ts`, que tem o `Inputs` com `toolCommit`.

Para cada critério, o executor confere **separadamente**:
1. se a expectativa está correta frente às fontes;
2. se a verificação a demonstra.

Registre comando, resultado observado e artefato em `executor-report.md`. Uma suíte verde sozinha não fecha nenhum critério.

**A1. Revisão da 0.3.x recebe mensagem certa** [R, S, B]
- **Contexto:** journal com `inputs.toolCommit`.
- **Ação:** `resume`.
- **Esperado:**
  - saída 1 com a mensagem nova;
  - sem `restore the original record`;
  - journal intacto;
  - nada criado.
- **Discriminação:**
  - o red mostra a mensagem antiga;
  - o teste de adulteração prova que a mensagem antiga continua para corrupção de verdade, então trocar a mensagem em todos os casos seria detectado.

**A2. Corpo incompleto não deixa objeto** [R, S]
- **Contexto:** imagem do exemplo, autor fictício e um upload de 45 MB interrompido.
- **Esperado:** o `GET` depois da interrupção não responde 200, e um upload completo novo do mesmo tamanho fica legível.
- **Discriminação:** a variação local que espera 200 falha, e o tamanho igual detecta espaço ou chave presos.

**A3. Script de navegador removido sem regressão** [R]
- **Esperado:**
  - o `grep` da R3 não devolve nada;
  - `test:flows` passa com 2 testes;
  - `test:media` e `npm test` passam;
  - `release/public-files.json` não lista o script;
  - `scripts/validate-decoding.ts` fica intacto (`git diff --stat` não o mostra).

## Progress

- [x] R0 baseline: `HEAD` em `093f958`, só este plano pendente, 118 de 118 testes (`review-followups/baseline.json`).
- [x] R1 mensagem para revisões da 0.3.x: red com a mensagem antiga (`red-a1.log`), depois verde. O caso entrou em `test/publication-journey.test.ts`, e não em `cli-journey`, porque só ali existe o fixture `prepared()`, que gera um journal real no formato atual. A observação continua pela CLI.
- [x] R2 corpo incompleto: `readAfterAbortStatus` 404 e upload novo de 45 MB legível. A variação que espera 200 falhou (`a2-note.md`, `a2-discrimination.log`).
- [x] R3 tirar o script de navegador: script, teste, chamadas e entrada da distribuição removidos. Nenhum guia citava a verificação. `test:flows` passa com 2 testes.
- [x] R4 validação final iniciada; este arquivo congela aqui. O resultado está em `review-followups/executor-report.md`.

## Decisions

- **Controle da mensagem antiga no próprio teste de A1.** O teste de adulteração citado em R1 não chega a `Journal revision identity mismatch`: os cinco casos dele param antes, em `Frozen input integrity failure`, `Symlinks are not allowed` ou `Frozen data manifest identity mismatch`. Por isso ele não detectaria uma troca da mensagem em todos os casos. O teste novo acrescenta um controle: um campo desconhecido em `inputs` que não é `toolCommit` continua recebendo a mensagem antiga. Consequência: a discriminação de A1 depende desse controle, não do teste de adulteração.
- **Filtros do `grep` de R3.** Neste ambiente, o `grep -rn ... .` devolve os caminhos sem o prefixo `./`, então os filtros `grep -v '^./...'` do plano não excluem nada. A conferência usa os mesmos filtros sem o `./`.

## Validation

Rode sobre o tree exato que será commitado, já com este plano congelado. Use `ENOIS_PREVIEW_EVIDENCE=$EV/release-0.4.0/review-followups/final` e `ENOIS_PREVIEW_EXAMPLE_WORKSPACE` apontando para o workspace preparado pelo passo 6.

Todos devem sair com 0, nesta ordem:
1. `npm ci --ignore-scripts`
2. `npm run build`
3. `npm run typecheck`
4. `npm test`: 0 fail e 0 skip. Registre a contagem: o esperado é 118 mais o caso de A1, se ele entrar como teste novo.
5. `npm run check`
6. `npm run test:example`, num destino novo dentro de `final/`
7. `npm run test:image`, que também gera o recibo da imagem usado pelo `test:flows`
8. `npm run test:media` (A2)
9. `npm run test:flows` (A3): 2 testes
10. `npm run test:consumer`

Grave `final/validation.json` com o tree antes e depois (iguais), as contagens e, para cada critério, o comando, o resultado e o artefato.

Uma tentativa que falhar vai para `final-attempt<N>/` e não conta. Se a JVM cair com `SIGSEGV` no JIT, como aconteceu na validação da 0.4.0, repita o comando uma vez e registre. Se cair de novo, pare e reporte.

**Paradas:**
- o red de A1 não aparece;
- a variação de A2 que espera 200 não falha;
- qualquer validação falha;
- o tree muda entre a validação e o commit;
- é preciso tocar nas aplicações, nos bancos, no lançador ou na config da #806.
