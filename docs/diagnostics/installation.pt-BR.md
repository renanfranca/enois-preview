# Preparar a infraestrutura privada do operador

O `enois-preview setup` cria e confere a sua infraestrutura privada nas suas próprias contas do GitHub e da Cloudflare. Este guia descreve o que ele faz, o que você precisa fazer à mão (o token do Worker) e os casos em que ele para com instruções. Ele complementa o [tutorial](../pt-BR/TUTORIAL.md). Mantenha os planos gratuitos com gastos bloqueados; o setup lembra disso com o aviso `free-plan`. Não adicione forma de pagamento nem ative serviços pagos.

## Instalar e rodar

Use Linux com Node 24.x (`>=24 <25`), Git, Java 25 e Javac, Docker, `flock` e o GitHub CLI.

```sh
npm install -g enois-preview
enois-preview setup
```

Interface completa:

```
enois-preview setup [--config WORKSPACE_JSON] [--yes]
                    [--launcher OWNER/REPO] [--branch BRANCH] [--registry ghcr.io/OWNER/NAME]
                    [--worker NAME] [--account CLOUDFLARE_ACCOUNT_ID]
```

| Flag         | Padrão (`<login>` é o seu login no GitHub)    |
| ------------ | --------------------------------------------- |
| `--launcher` | `<login>/enois-preview-launcher`              |
| `--branch`   | `main`                                        |
| `--registry` | `ghcr.io/<login>/enois-preview`               |
| `--worker`   | `enois-preview-launcher`                      |
| `--account`  | a única conta informada por `wrangler whoami` |

Sem `--config`, o setup configura só a infraestrutura. Com `--config`, ele também valida o workspace e o grava em `<home>/config.json`. Valores de um `infrastructure.json` existente vencem os padrões; uma flag que contradiz esse arquivo para o setup e cita os dois valores, porque trocar de infraestrutura está fora do escopo.

## O que o setup faz, em ordem

Cada etapa confere primeiro e só age no que falta. Rodar de novo numa infraestrutura completa não faz nenhuma escrita remota e informa todos os recursos como `exists`.

1. **Ferramentas e logins.** Confere os comandos obrigatórios, o login do GitHub CLI com os escopos `repo`, `codespace` e `write:packages`, o login do Docker em `ghcr.io` e o login do `wrangler`. Cada correção (`gh auth login`, `gh auth refresh`, `docker login ghcr.io` com o token do `gh` pelo stdin, `wrangler login`) pede a sua própria confirmação e precisa de um terminal interativo; `--yes` não a substitui. Sem terminal, o setup para e mostra o comando a rodar.
2. **Plano.** Antes de qualquer outra escrita, imprime no stderr uma linha por recurso com `exists`, `create` ou `update`: repositório, branch, Worker, origem, cada segredo pelo nome, formato do lançador, Chromium e arquivos locais. Havendo `create` ou `update`, pede uma confirmação; qualquer resposta diferente de sim termina com saída 1 e nada escrito. Com `--yes`, segue sem perguntar. Sem terminal e sem `--yes`, termina com `Setup needs to create or update infrastructure; rerun in an interactive terminal or with --yes.` sem escrever nada.
3. **Lançador.** Se o repositório não existe, cria-o privado, gera os arquivos do lançador (`package.json` com `enois-preview` na versão em execução e `wrangler` exatos, `package-lock.json`, `launcher.ts`, `wrangler.jsonc`, catálogo vazio), comita como `enois-preview` e envia a branch. Se existe, ele precisa aceitar escrita e ter `main: "launcher.ts"`, `GITHUB_REPOSITORY` e `GITHUB_OWNER` coerentes no `wrangler.jsonc`. Um lançador que não é privado gera o aviso `launcher-not-private`.
4. **Worker.** Se não existe, publica o lançador com `LAUNCH_ENABLED=false` e grava a origem `https://<worker>.<subdomínio>.workers.dev`.
5. **Segredos.** Grava os que faltam, sempre pelo stdin (tabela abaixo). Um segredo existente nunca é sobrescrito; um segredo de Codespaces existente que não inclui o lançador ganha o lançador na seleção, sem trocar o valor (`update` no plano).
6. **Ativação.** Com todos os segredos presentes, muda `LAUNCH_ENABLED` para `true`, comita, envia e publica.
7. **Chromium e arquivos locais.** Instala o Chromium da validação pública quando falta (uma falha vira o aviso `browser-missing`, com o comando para tentar de novo) e grava `~/.config/enois-preview-ts/infrastructure.json` (modo `0600`, sem segredos) e, com `--config`, o `config.json` do workspace.

O pacote GHCR não precisa existir: o primeiro `publish` cria-o ao enviar a imagem e mostra o aviso `registry-codespaces-access`. Siga o aviso: nas configurações do pacote, em **Manage Codespaces access**, adicione o repositório do lançador. Não torne o pacote público. Veja [acesso dos Codespaces a um registro privado](https://docs.github.com/en/codespaces/reference/allowing-your-codespace-to-access-a-private-registry).

O setup termina com um JSON com `status: "configured"`, os campos da infraestrutura, `created`, `updated` e `warnings`.

## Segredos

| Segredo                        | Onde                                             | Origem                                |
| ------------------------------ | ------------------------------------------------ | ------------------------------------- |
| `GITHUB_TOKEN`                 | segredo do Worker                                | token fine-grained criado por você    |
| `CALLBACK_SECRET`              | segredo do Worker                                | gerado pelo setup                     |
| `DEMO_CALLBACK_SECRET`         | segredo de Codespaces do usuário, só no lançador | o mesmo valor do `CALLBACK_SECRET`    |
| `DEMO_WORKER_URL`              | segredo de Codespaces do usuário, só no lançador | a origem do Worker                    |
| `REDE_SECURITY_ENCRYPTION_KEY` | segredo de Codespaces do usuário, só no lançador | gerado: 32 bytes aleatórios em Base64 |

Nenhum valor aparece em argumentos, na saída, em logs, em journals ou no `infrastructure.json`.

### Criar o token do Worker (manual)

O `GITHUB_TOKEN` do Worker é o único passo manual. O setup mostra a URL e as permissões e lê o token num prompt oculto; esse prompt precisa de terminal interativo, mesmo com `--yes`. Crie o token em <https://github.com/settings/personal-access-tokens/new>:

- **Resource owner:** o dono do lançador.
- **Repository access:** "Only select repositories", somente o lançador.
- **Repository permissions:** Contents: Read-only; Codespaces: Read and write; Codespaces metadata: Read-only.

Antes de gravar, o setup confere o token listando os Codespaces do lançador com ele. Um token que falha não é gravado, e o setup pergunta de novo. O setup nunca usa o token do `gh` para esse segredo. Essas permissões atendem aos [endpoints de Codespaces](https://docs.github.com/en/rest/codespaces/codespaces).

### Os dois lados do segredo de callback

`CALLBACK_SECRET` (no Worker) e `DEMO_CALLBACK_SECRET` (nos Codespaces) precisam do mesmo valor, e nenhum dos dois pode ser lido de volta. Por isso o setup grava o valor gerado em `~/.config/enois-preview-ts/pending-callback-secret` (modo `0600`) antes de gravar os dois lados e apaga o arquivo no fim. Se uma interrupção deixar só um lado gravado, o próximo `setup` completa o outro lado com o arquivo pendente.

## Quando o setup para

| Situação                                                                                         | O que fazer                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falta um comando obrigatório ou um login que você não quis corrigir                              | Instale o comando ou rode o comando de login mostrado, depois repita `enois-preview setup`.                                                        |
| `Several Cloudflare accounts are available; choose one with --account: ...`                      | Repita com `--account` e um dos IDs listados.                                                                                                      |
| Uma flag contradiz o `infrastructure.json`                                                       | Use os valores registrados; trocar de infraestrutura não é suportado.                                                                              |
| O lançador não aceita escrita ou não combina com o `wrangler.jsonc`                              | Use um lançador seu, com escrita, ou escolha outro `--launcher`.                                                                                   |
| `Launcher ... uses another format ...`                                                           | É um lançador antigo (por exemplo da 0.4.0, com `tool.lock.json` e dependência por `codeload`). Escolha um `--launcher` novo; o setup nunca migra. |
| `enois-preview <versão> is not published on npm; run setup from an installed release.`           | Rode o setup da ferramenta instalada pelo npm, não de um checkout de desenvolvimento.                                                              |
| `Worker ... did not deploy to workers.dev. ...`                                                  | Registre um subdomínio `workers.dev` no painel da Cloudflare (Workers & Pages) e repita.                                                           |
| `CALLBACK_SECRET and DEMO_CALLBACK_SECRET must hold the same value, only one of them exists ...` | Apague o segredo que a mensagem nomeia, com o comando mostrado, e repita.                                                                          |
| O `GITHUB_TOKEN` não passou na conferência                                                       | Crie o token de novo com as permissões acima e repita.                                                                                             |
| Plano recusado ou sem terminal e sem `--yes`                                                     | Repita num terminal interativo ou com `--yes`.                                                                                                     |

Interromper o setup (Ctrl+C) é seguro: cada etapa converge, e rodar `enois-preview setup` de novo completa o que faltou.

## Infraestrutura de versões anteriores

Uma infraestrutura criada à mão para a 0.4.0 ou antes continua intacta, e os links antigos funcionam enquanto o Worker e o lançador antigos existirem. O setup não a migra: para a distribuição pelo npm, rode o setup com um `--launcher` e um `--worker` novos.
