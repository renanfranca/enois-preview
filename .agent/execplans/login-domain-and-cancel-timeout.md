# Documentar o domínio obrigatório dos logins e dar folga ao teste de cancelamento

## Purpose and success

Duas mudanças pequenas, pedidas pelo mantenedor em 13 de novembro de 2026, entregues como commit na `main` por uma branch, sem versão nova, sem tag e sem release.

1. **Documentação do domínio dos logins.** A receita 8 (`docs/pt-BR/RECIPES.md:168` e `docs/en/RECIPES.md:168`) mostra `conta@enois.invalid` / `account@enois.invalid` como exemplo, sem dizer que o domínio é obrigatório, em que etapa a regra é aplicada nem por quê. Quem configura `accounts` com um email comum descobre a regra só pela mensagem de erro. Depois desta mudança, quem lê a receita 8 sabe, antes de rodar o `setup`: que o email precisa ser `<parte local>@enois.invalid`; quais caracteres a parte local aceita; quando a ferramenta confere isso; o que acontece com as contas não selecionadas; e por que a regra existe.
2. **Teste de cancelamento com folga.** O teste `interrupted image inspection and local verification clean their own containers even before creation acknowledgement` (`test/image-security.test.ts:76`) mata o processo filho com SIGKILL depois de 2000 ms (`test/image-security.test.ts:83`). Com a máquina carregada, iniciar o Node e carregar `preview/build.js` já passou disso (máximo observado: 2443 ms). O teste fica vermelho sem defeito no produto, e foi o que derrubou a primeira tentativa do consumer na 0.3.8 (116 de 117). Depois desta mudança, o limite é 15000 ms. A proteção contra travamento continua, e o tempo normal do teste não muda, porque o limite só é gasto quando estoura.

Sucesso: os critérios A1 a A6 abaixo têm evidência registrada em `Progress`, e a validação final passa.

## Context and limits

Fatos conferidos no planejamento (leitura, na `main` em `e733eb4`):

- **Onde a regra do domínio é aplicada.** O padrão é `^[a-z0-9._-]+@enois\.invalid$` em todos os pontos:
  - `shared/accounts.ts:7`, função `accounts()`. Ela é chamada por `validateConfig` e `captureConfig` em `preview/config.ts:40` sempre que a configuração privada é lida (no `setup` e em todo comando que lê a config), quando `accounts` não está vazio. A mensagem é `Accounts require stable id, label and disposable @enois.invalid email.` A mesma função recusa emails repetidos com `Select distinct accounts and demo logins.` e exige de 1 a 20 contas.
  - `recipe/SeedTool.java:116`, durante a sanitização da cópia do H2. Ali o email selecionado é gravado em `USER_CREDENTIALS.EMAIL` e `USERS.EMAIL`. Antes disso, as linhas 109 e 110 trocam o email de **todas** as contas para `<id>@disabled.enois.invalid`, e a linha 107 desativa todas as senhas. Só as contas selecionadas recebem o email escolhido e uma senha nova a cada boot.
  - `src/contracts.ts:12`, `src/catalog.ts:10` e `scripts/add-scenario.ts:16` repetem a checagem no Worker, no catálogo e no script do lançador.
- **Contas geradas pela CLI.** Com `accounts` vazio, o primeiro `publish` pergunta os IDs no terminal e gera `account1@enois.invalid`, `account2@enois.invalid`, e assim por diante (`preview/cli.ts:22`). Um `--refresh-data` posterior reaproveita a seleção anterior (`preview/capture.ts:162`).
- **Email na demo.** Não existe Mailpit no projeto. `recipe/application-demo.properties:42-47` aponta o SMTP para `127.0.0.1:9`, sem autenticação. A validação T9 (`VALIDATION.md:25`) registrou zero envios reais da demo.
- **Motivo da regra, confirmado pelo mantenedor em 13 de novembro de 2026.** `.invalid` é um domínio de topo reservado (RFC 2606 e RFC 6761) que nunca resolve. Por isso: (1) nenhum email enviado pela demo chega a uma pessoa real; (2) o login exibido na página de entrada do link público não expõe o email verdadeiro de ninguém. A documentação deve dar esses dois motivos e nenhum outro.
- **Cobertura existente.** Nenhum teste prova que a leitura da config recusa um email fora de `@enois.invalid` (`grep -rn "disposable @enois" test` sem resultado). Por isso o marco M1 cria um.
- **Teste do timeout.** O limite fica dentro do `spawnSync` (`timeout:2000,killSignal:'SIGKILL'`). Ele é independente do timeout do `node --test`. O docker falso fica parado de propósito (`FIXTURE_DOCKER_HOLD`), então, se a limpeza quebrar, só esse limite impede o teste de travar.

Limites:

- Não mudar código de produção: `shared/`, `preview/`, `src/`, `recipe/`, `runtime/` e `scripts/` ficam como estão. A regra já existe; aqui ela só é documentada e provada.
- Não mudar `package.json` (versão), `CHANGELOG.md`, `VALIDATION.md` nem `release/public-files.json`. Não há versão nova, e o CHANGELOG registra só versões lançadas.
- Não tocar nos workspaces de `~/projects/enois/.local/`, em instalações nem no lançador.
- A documentação descreve só o comportamento atual, sem notas por versão (regra de `CHANGELOG.md:5`).
- Não citar nomes, emails ou dados reais do Énóis. Os exemplos usam emails inventados.

## Decisions

- **Entrega como commit na `main`, sem release 0.3.9.** Alternativa: o ciclo completo da 0.3.8 (versão, tag, consumer, instalação e publicação canônica). Escolhido pelo mantenedor porque o produto não muda: só um teste e a documentação. Consequência: o próximo ciclo de release levará as duas mudanças. `CHANGELOG.md` só ganhará uma linha quando houver versão.
- **15000 ms no limite do `spawnSync`, sem mexer no `--test-timeout` global.** Alternativas: apagar o teste (perde a proteção contra container órfão) ou trocar a estratégia por uma faxina de containers etiquetados (código novo no produto). Escolhido porque mantém a garantia e só muda a duração do caso que já é uma falha real. Consequência: se a limpeza quebrar, o teste leva até cerca de 30 s para falhar (duas operações de 15 s), em vez de cerca de 4 s.
- **Explicação completa na receita 8, uma frase com link no CONCEPTS.** O assunto tem um único dono, a receita 8 (PT e EN). Em `CONCEPTS.md`, a entrada "Dados congelados e captura" ganha uma frase curta com link para a receita, sem repetir a regra.

## Milestones

### M1. Provar a recusa na leitura da configuração

Comportamento provado: a configuração privada com um email fora de `@enois.invalid` é recusada antes de qualquer captura, com a mensagem atual. O mesmo email com `@enois.invalid` é aceito.

Edição: em `test/capture-journey.test.ts`, que já importa `captureConfig` de `../preview/config.js`, criar um teste com o nome `operator configuration refuses a login outside the reserved @enois.invalid domain`. Ele parte de uma config válida que já exista na suíte (use o fixture que o arquivo usa para `captureConfig`; não crie um fixture novo se um existente servir) e verifica:

- **Exemplo de recusa.** `accounts: [{ id: 'author', email: 'author@example.com', label: 'Author' }]` → `captureConfig` lança `PreviewError` com a mensagem exata `Accounts require stable id, label and disposable @enois.invalid email.`
- **Exemplo de recusa por caractere.** `Author@enois.invalid` (maiúscula) → a mesma mensagem.
- **Exemplo de controle.** `author@enois.invalid` → a config é aceita e `accounts[0].email === 'author@enois.invalid'`. O controle mostra que o teste não passaria se a função recusasse tudo.

Expectativa de TDD: a regra já existe, então este teste nasce verde. Ele é um teste de caracterização. Para provar que ele discrimina, rode-o uma vez com `example.com` no exemplo de controle e confirme que falha. Desfaça antes de seguir e registre isso em `Progress`. Não mude `shared/accounts.ts`.

Validação: `npm run build && node --test dist/test/capture-journey.test.js` com exit 0. A contagem total da suíte passa de 117 para 118.

### M2. Dar folga ao teste de cancelamento

Comportamento: o teste de cancelamento continua provando a limpeza do container, mas não falha só porque a máquina está lenta.

Edição: em `test/image-security.test.ts:83`, trocar `timeout:2000` por `timeout:15000`. Manter `killSignal:'SIGKILL'`, as asserções e o resto do teste. Nenhum outro arquivo muda.

Validação: `npm run build && node --test dist/test/image-security.test.js` com exit 0. `grep -n "timeout:15000" test/image-security.test.ts` mostra uma linha só, a 83, e `grep -n "timeout:2000" test/image-security.test.ts` não mostra nada.

### M3. Documentar a regra na receita 8 e no glossário (PT e EN)

Edições, com o mesmo conteúdo nos dois idiomas:

1. `docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`, receita 8, lista "Regras de cada campo" / equivalente em inglês. Logo depois do item sobre `media`, um item novo sobre `accounts`, que diga:
   - o `email` de cada conta é obrigatório no formato `<parte local>@enois.invalid`, e a parte local aceita só letras minúsculas, números, `.`, `_` e `-`;
   - use um email inventado, nunca o email real da pessoa; ele vira o login mostrado na página de entrada do link;
   - a ferramenta confere a regra ao ler a configuração (no `setup` e em todo comando que lê a config) e de novo ao sanitizar a cópia do H2, quando grava o email nas tabelas `USER_CREDENTIALS` e `USERS`;
   - as contas não selecionadas ficam com `<id>@disabled.enois.invalid` e sem login;
   - o porquê: `.invalid` é reservado (RFC 2606 e RFC 6761) e nunca resolve, então nenhum email enviado pela demo chega a uma pessoa e o login exibido no link público não expõe o email verdadeiro de ninguém.

   O item existente sobre `accounts` vazio passa a dizer também que, nesse caso, a ferramenta gera os logins `account1@enois.invalid`, `account2@enois.invalid` e assim por diante.
2. Mesma receita, bloco "Se der errado" / "If it goes wrong": acrescentar a mensagem `Accounts require stable id, label and disposable @enois.invalid email.`, com a ação "troque o email da conta para `<algo>@enois.invalid`".
3. `docs/pt-BR/CONCEPTS.md` e `docs/en/CONCEPTS.md`, entrada "Dados congelados e captura" / "Frozen data and capture", parágrafo da linha 65: depois de "só as contas selecionadas continuam com login" / "only the selected accounts keep a login", uma frase curta dizendo que esses logins usam emails inventados em `@enois.invalid`, com link para a receita 8 (`RECIPES.md#8-usar-meus-próprios-dados` em PT; confira o slug real do título em EN antes de linkar).

Não citar Mailpit. O SMTP da demo pode ser citado só como fato (`127.0.0.1:9`, sem envio real) se couber numa oração. Ele não é o motivo da regra.

Validação: os comandos 5 e 6 de `Validation` com exit 0, mais a leitura das jornadas J1 e J2.

## Progress

- [x] M1 teste de recusa da config (com a prova de discriminação). Teste `operator configuration refuses a login outside the reserved @enois.invalid domain` em `test/capture-journey.test.ts:239`, usando o fixture `fixture()` de `test/fixtures/h2.js`. Nasceu verde: `node --test dist/test/capture-journey.test.js` exit 0, 16 de 16. Prova de discriminação: só a linha do controle trocada para `author@example.com` → `node --test --test-name-pattern="reserved @enois"` exit 1, `Error: Accounts require stable id, label and disposable @enois.invalid email.`; controle restaurado → pass 1, fail 0. Nota: uma primeira restauração por `sed` também trocou o exemplo de recusa para `@enois.invalid`. O `npm test` pegou o erro (117 de 118, `Missing expected exception`), a linha foi corrigida e a prova foi refeita mexendo só na linha 248.
- [x] M2 timeout de 15000 ms. `grep -n "timeout:15000" test/image-security.test.ts` → só a linha 83, com `killSignal:'SIGKILL'`; `grep -n "timeout:2000"` → nada. O teste passou em 642 ms na suíte completa. Lacuna aceita: não há vermelho reproduzível. A evidência é a da 0.3.8 (2443 ms contra 2000 ms), e 15000 ms dão mais de seis vezes de folga.
- [x] M3 receita 8 e CONCEPTS, PT e EN. Item novo sobre `accounts` logo depois do item de `media`; o item de `accounts` vazio cita `account1@enois.invalid`, `account2@enois.invalid`; "Se der errado" / "If it goes wrong" com a mensagem e a ação; CONCEPTS com uma frase e links `RECIPES.md#8-usar-meus-próprios-dados` e `RECIPES.md#8-use-my-own-data` (os mesmos slugs já usados por `README.md:31`, `docs/en/README.md:31` e os TUTORIAL).
- [x] Validação final e auditoria dos critérios A1 a A6, na árvore que será commitada:
  - `npm run build` 0; `npm run typecheck` 0; `npm test` 0 com 118 testes, 118 pass, 0 fail, 0 skip, 0 cancelled; `npm run check` 0; `check_markdown_links.py` 0; verificador `node -e` de `operator-documentation.md` 0, sem linhas impressas; `git status` lista só os sete arquivos previstos.
  - A1: primeiro `assert.throws` do teste de M1 (`author@example.com`, `PreviewError` com a mensagem exata), verde.
  - A2: controle `author@enois.invalid` aceito; prova de discriminação acima.
  - A3: comandos de M2 acima.
  - A4: resumo do `npm test` acima.
  - A5: a receita 8 PT e EN tem os cinco pontos (formato e caracteres ↔ `shared/accounts.ts:7`; checagem na leitura ↔ `preview/config.ts:40`; checagem na sanitização e gravação em `USER_CREDENTIALS`/`USERS` ↔ `recipe/SeedTool.java:116-121`; não selecionadas com `<id>@disabled.enois.invalid` e senha desativada ↔ `recipe/SeedTool.java:107-110`; motivo ↔ decisão do mantenedor), mais os logins gerados ↔ `preview/cli.ts:22` e a mensagem de erro no bloco de falhas.
  - A6: `grep -rln "enois.invalid" docs README.md TUTORIAL.md` acha só `docs/{pt-BR,en}/RECIPES.md` e `docs/{pt-BR,en}/CONCEPTS.md`. Os dois RECIPES já tinham o exemplo da receita 8, e cada CONCEPTS tem só a frase nova.
  - J1: README → receita 8 (`README.md:31`, link "Meus dados"); a regra e o motivo aparecem em "Regras de cada campo", antes do `setup`. J2: a mensagem de erro aparece em "Se der errado" / "If it goes wrong", com a ação.

## Validation

### Critérios de aceite

Para cada critério, o executor deve: (1) reconferir a expectativa contra a fonte citada; (2) rodar a verificação planejada; (3) registrar em `Progress` o comando, o resultado observado e onde está a evidência. Uma suíte verde sozinha não prova os critérios. Lacunas e critérios não verificados ficam registrados antes da entrega; nenhum deles pode ser dado como cumprido.

| ID | Expectativa | Fonte | Verificação planejada | Evidência esperada |
| --- | --- | --- | --- | --- |
| A1 | Config com `author@example.com` é recusada com a mensagem exata | `shared/accounts.ts:7` | Teste de M1 | Asserção de `PreviewError` e mensagem; `node --test` exit 0 |
| A2 | `author@enois.invalid` é aceito (controle) | `shared/accounts.ts:7` | Teste de M1, mais a prova de discriminação | O teste falha com o controle trocado e passa com ele restaurado |
| A3 | O limite do teste de cancelamento é 15000 ms e o SIGKILL continua | Decisão 2 | Comandos de M2 | Um `timeout:15000` na linha 83; nenhum `timeout:2000` |
| A4 | A suíte inteira passa: 118 testes, 0 fail, 0 skip | `package.json` `test` | Comando 3 | Linha de resumo do `node --test` |
| A5 | A receita 8 PT e EN tem os cinco pontos de M3.1, a mensagem de M3.2, e cada afirmação bate com o código | Seção "Context and limits" | Ler os dois arquivos e comparar com `shared/accounts.ts:7`, `recipe/SeedTool.java:107-121` e `preview/cli.ts:22` | Lista dos pontos com as linhas de PT e EN |
| A6 | CONCEPTS tem uma frase com link que resolve; nenhum outro guia repete a regra | Decisão 3 | Comandos 5 e 6; `grep -rn "enois.invalid" docs README.md TUTORIAL.md` | Exit 0; o grep só acha RECIPES (receita 8) e a frase do CONCEPTS |

Jornadas para ler depois de M3:

- **J1.** Pessoa que vai usar os próprios dados: README → receita 8. Antes de rodar o `setup`, ela descobre que precisa de um email inventado em `@enois.invalid` e sabe por quê.
- **J2.** Pessoa que recebeu o erro `Accounts require stable id, label and disposable @enois.invalid email.`: ela encontra a mensagem na receita 8 e sabe o que mudar.

Lacuna conhecida: M2 não tem vermelho reproduzível. A falha falsa depende da carga da máquina. A evidência é a de 0.3.8 (2443 ms contra o limite de 2000 ms) e o fato de 15000 ms deixar mais de seis vezes de folga sobre esse máximo. Registre isso como lacuna aceita, não como prova.

### Validação final

Rode na árvore exata que será commitada. Todos devem sair com 0:

1. `npm run build`
2. `npm run typecheck`
3. `npm test` (118 testes, 0 fail, 0 skip; se a contagem for outra, explique em `Progress` antes de seguir)
4. `npm run check`
5. `python3 -I ~/.claude/skills/restructure-documentation/scripts/check_markdown_links.py README.md CHANGELOG.md TUTORIAL.md docs/pt-BR docs/en docs/diagnostics`
6. O verificador de links `node -e` da seção Validation 5 de `.agent/execplans/operator-documentation.md`, copiado sem mudança
7. `git status --porcelain --untracked-files=all`, que deve listar só: `.agent/execplans/login-domain-and-cancel-timeout.md`, `test/capture-journey.test.ts`, `test/image-security.test.ts`, `docs/pt-BR/RECIPES.md`, `docs/en/RECIPES.md`, `docs/pt-BR/CONCEPTS.md` e `docs/en/CONCEPTS.md`

Paradas: qualquer comando com exit diferente de 0; a contagem de testes diferente de 118 sem explicação; um arquivo fora dessa lista alterado; uma afirmação da documentação sem fonte no código.
