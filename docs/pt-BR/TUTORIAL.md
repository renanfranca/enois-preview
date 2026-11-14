# Publicar uma revisão de teste

[English](../en/TUTORIAL.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Fluxo](FLOW.md) · [Receitas](RECIPES.md)

Este tutorial leva você da instalação até o primeiro link publicado, usando o exemplo fictício. As situações do dia a dia (publicar de novo, refresh, retomar, interrupções) estão nas [receitas](RECIPES.md).

## Antes de começar

- Tenha os [requisitos do README](../../README.md#requisitos) e sua infraestrutura privada pronta: [lançador](CONCEPTS.md#lançador) privado com `wrangler.jsonc`, Worker e catálogo, e pacote [GHCR](CONCEPTS.md#ghcr) privado. Se faltar algo, siga o [diagnóstico de instalação](../diagnostics/installation.pt-BR.md) antes.
- Tenha em mãos o commit público completo fixado no `tool.lock.json` do seu lançador. Abaixo ele aparece como `<COMMIT_PUBLICO_FIXADO>`.

Atenção:
- Use só o seu terminal local. Não execute comandos dentro de um [Codespace](CONCEPTS.md#worker-durable-object-e-codespace) para completar o boot de uma revisão.
- Não coloque tokens em argumentos, no chat ou em arquivos versionados.
- Não altere o plano de cobrança.

## Passo a passo

1. Autentique no GitHub:

   ```sh
   gh auth login
   ```

2. Autentique o Docker no GHCR pelo seu mecanismo de credenciais, por exemplo digitando o token na entrada padrão:

   ```sh
   docker login ghcr.io --username SEU_USUARIO --password-stdin
   ```

3. Selecione Node 24.x (`>=24 <25`):

   ```sh
   nvm install 24
   ```

4. Instale a ferramenta no commit fixado:

   ```sh
   COMMIT=<COMMIT_PUBLICO_FIXADO>
   curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
   ```

   O `install.sh` desse commit prepara o instalador num diretório temporário e o apaga no fim. O instalador cria `~/.local/share/enois-preview/<COMMIT_PUBLICO_FIXADO>`, aponta `~/.local/share/enois-preview/current` para ela, liga o comando `enois-preview` e instala o Chromium usado na validação pública. O JSON final traz `linked: true` e `browser: true`. Veja [commit da ferramenta e `install.json`](CONCEPTS.md#commit-da-ferramenta-e-installjson).

   Atenção: não execute `npm run` nem edite arquivos dentro da instalação. O `publish` passaria a mostrar o aviso `unverified-tool`.

5. Autentique na Cloudflare com o `wrangler` da instalação:

   ```sh
   (cd ~/.local/share/enois-preview/current && npx --no-install wrangler login)
   ```

6. Prepare o workspace fictício num caminho que ainda não existe:

   ```sh
   node ~/.local/share/enois-preview/current/dist/example/prepare.js /caminho/absoluto/novo-workspace
   ```

   A preparação busca as fontes públicas fixadas, compila o backend e aplica as migrações dele a um H2 novo antes de inserir só dados fictícios.

7. Edite o arquivo privado `/caminho/absoluto/novo-workspace/.preview/config.json`. Substitua `repository`, `branch`, `registry`, `origin` e `cloudflareAccountId` pela sua infraestrutura existente.

   Atenção: não use a infraestrutura de outro operador.

8. Rode o setup:

   ```sh
   enois-preview setup --config /caminho/absoluto/novo-workspace/.preview/config.json
   ```

   O setup verifica acessos e guarda a configuração em `~/.config/enois-preview-ts`, sem perguntas. O JSON dele termina com `warnings`, incluindo `free-plan`: mantenha os planos gratuitos com gastos bloqueados nas contas configuradas. Defina `ENOIS_PREVIEW_HOME` para manter outra instalação independente.

9. Publique:

   ```sh
   enois-preview publish meu-cenario
   ```

   Na primeira publicação acontece a [captura](CONCEPTS.md#dados-congelados-e-captura). O exemplo já seleciona Lia (`example_lia`) e Rui (`example_rui`), com as permissões preservadas. O comando só termina com sucesso depois que o link público informa prontidão, a revisão esperada e o login de cada conta selecionada. Conteúdo da imagem, mídias e decodificação continuam conferidos e aparecem em `warnings`. O que acontece em cada etapa está em [Fluxo](FLOW.md#o-que-acontece-no-publish).

10. Abra a `url` do JSON final no navegador, teste o comportamento específico do pull request (PR) e cole o link no PR. As senhas aparecem na página de entrada do ambiente, nunca no relatório do CLI.

    Atenção: as contas são compartilhadas. Use sessões independentes para autora e leitor. Um build ou push concluído nunca equivale a aceite público; só o JSON final com `status: "validated"` vale.

## O que o exemplo contém

A preparação cria cópias isoladas das três aplicações públicas nos commits de [example/sources.json](../../example/sources.json). Ela não usa o catálogo operacional, um H2 real nem imagens privadas.

- As quatro personagens são fictícias e os retratos são ilustrações vetoriais originais.
- A semente tem oito posts (três com imagens), seis comentários, duas respostas e oito reações.
- Lia e Rui são as contas selecionadas; as senhas são criadas no boot e aparecem só na entrada do ambiente.
- Maya e Davi preservam perfil e conteúdo, com login desabilitado.

## Depois da primeira publicação

| Situação | Receita |
| --- | --- |
| Código novo, mesmos dados | [Publicar de novo só com código novo](RECIPES.md#3-publicar-de-novo-só-com-código-novo) |
| Dados ou mídias novos | [Publicar com dados novos](RECIPES.md#4-publicar-com-dados-novos) |
| O `publish` falhou | [Retomar uma publicação que falhou](RECIPES.md#5-retomar-uma-publicação-que-falhou) |
| Você interrompeu o comando | [Ctrl+C, SIGTERM ou processo morto](RECIPES.md#6-ctrlc-sigterm-ou-processo-morto) |
| Seus próprios dados | [Usar meus próprios dados](RECIPES.md#8-usar-meus-próprios-dados) |
| Limites para quem abre o link | [Mostrar no PR que o problema foi resolvido](RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido) |

## Lançador da versão Python

Antes de usar um lançador da versão Python:

1. Preserve o catálogo dele no histórico do Git.
2. Prepare um catálogo vazio `{ "format": "enois-preview-ts-v1", "scenarios": {} }`, um `tool.lock.json` com o mesmo formato e `launcher.ts`.
3. Aponte a dependência pública para o SHA imutável da versão TypeScript.
4. Depois de `npm ci --ignore-scripts`, rode `npm run build` no lançador. Ele compila explicitamente `node_modules/enois-preview` e verifica `launcher.ts`.

Atenção: não reutilize journals nem receitas da versão anterior. Uma configuração anterior carrega, e os campos que não são mais usados são ignorados com um aviso. O procedimento completo está no [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).
