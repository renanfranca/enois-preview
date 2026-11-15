# Publicar uma revisão de teste

[English](../en/TUTORIAL.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Fluxo](FLOW.md) · [Receitas](RECIPES.md)

Este tutorial leva você da instalação até o primeiro link publicado, usando o exemplo fictício. As situações do dia a dia (publicar de novo, refresh, retomar, interrupções) estão nas [receitas](RECIPES.md).

## Antes de começar

- Tenha os [requisitos do README](../../README.md#requisitos): Node 24.x, Git, Java 25 e Javac, Docker, `flock` e o GitHub CLI, mais uma conta no GitHub e uma na Cloudflare. O `setup` cria a sua infraestrutura privada ([lançador](CONCEPTS.md#lançador), Worker e segredos); o pacote [GHCR](CONCEPTS.md#ghcr) nasce no primeiro `publish`.

Atenção:

- Use só o seu terminal local. Não execute comandos dentro de um [Codespace](CONCEPTS.md#worker-durable-object-e-codespace) para completar o boot de uma revisão.
- Não coloque tokens em argumentos, no chat ou em arquivos versionados.
- Não altere o plano de cobrança.

## Passo a passo

1. Selecione Node 24.x (`>=24 <25`) e instale a ferramenta:

   ```sh
   nvm install 24
   npm install -g enois-preview
   enois-preview --version
   ```

2. Rode o setup guiado:

   ```sh
   enois-preview setup
   ```

   Primeiro ele confere os logins do GitHub CLI, do Docker no GHCR e do `wrangler` e oferece cada correção, com confirmação. Depois mostra o plano, uma linha por recurso com `exists`, `create` ou `update`, e pede uma confirmação. No meio, ele mostra a URL e as permissões do token do Worker: crie o token e cole-o no prompt oculto (o passo a passo está no [diagnóstico de instalação](../diagnostics/installation.pt-BR.md#criar-o-token-do-worker-manual)). O JSON final traz `status: "configured"`, os recursos em `created` e `warnings`, incluindo `free-plan`: mantenha os planos gratuitos com gastos bloqueados.

   Atenção: não use a infraestrutura de outro operador. Rodar o setup de novo não altera nada que já existe.

3. Prepare o workspace fictício num caminho que ainda não existe:

   ```sh
   node "$(npm root -g)/enois-preview/dist/example/prepare.js" ~/novo-workspace
   ```

   A preparação busca as fontes públicas fixadas, compila o backend e aplica as migrações dele a um H2 novo antes de inserir só dados fictícios.

4. Grave a configuração do workspace:

   ```sh
   enois-preview setup --config ~/novo-workspace/.preview/config.json
   ```

   A infraestrutura já está pronta, então o plano só mostra os arquivos locais. A configuração do workspace fica em `~/.config/enois-preview-ts/config.json`, ao lado do `infrastructure.json`. Defina `ENOIS_PREVIEW_HOME` para manter outro workspace independente.

5. Publique:

   ```sh
   enois-preview publish meu-cenario
   ```

   Na primeira publicação acontece a [captura](CONCEPTS.md#dados-congelados-e-captura). O exemplo já seleciona Lia (`example_lia`) e Rui (`example_rui`), com as permissões preservadas. O comando só termina com sucesso depois que o link público informa prontidão, a revisão esperada e o login de cada conta selecionada. Conteúdo da imagem, mídias e decodificação continuam conferidos e aparecem em `warnings`. O que acontece em cada etapa está em [Fluxo](FLOW.md#o-que-acontece-no-publish).

   O primeiro `publish` cria o pacote GHCR e mostra o aviso `registry-codespaces-access`, com a URL das configurações do pacote. Lá, em **Manage Codespaces access**, adicione o repositório do lançador. Se a validação pública falhar porque o Codespace não conseguiu baixar a imagem, faça esse ajuste e rode `enois-preview resume <revisao-completa>`.

6. Abra a `url` do JSON final no navegador, teste o comportamento específico do pull request (PR) e cole o link no PR. As senhas aparecem na página de entrada do ambiente, nunca no relatório do CLI.

   Atenção: as contas são compartilhadas. Use sessões independentes para autora e leitor. Um build ou push concluído nunca equivale a aceite público; só o JSON final com `status: "validated"` vale.

## O que o exemplo contém

A preparação cria cópias isoladas das três aplicações públicas nos commits de [example/sources.json](../../example/sources.json). Ela não usa o catálogo operacional, um H2 real nem imagens privadas.

- As quatro personagens são fictícias e os retratos são ilustrações vetoriais originais.
- A semente tem oito posts (três com imagens), seis comentários, duas respostas e oito reações.
- Lia e Rui são as contas selecionadas; as senhas são criadas no boot e aparecem só na entrada do ambiente.
- Maya e Davi preservam perfil e conteúdo, com login desabilitado.

## Depois da primeira publicação

| Situação                      | Receita                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Código novo, mesmos dados     | [Publicar de novo só com código novo](RECIPES.md#3-publicar-de-novo-só-com-código-novo)               |
| Dados ou mídias novos         | [Publicar com dados novos](RECIPES.md#4-publicar-com-dados-novos)                                     |
| O `publish` falhou            | [Retomar uma publicação que falhou](RECIPES.md#5-retomar-uma-publicação-que-falhou)                   |
| Você interrompeu o comando    | [Ctrl+C, SIGTERM ou processo morto](RECIPES.md#6-ctrlc-sigterm-ou-processo-morto)                     |
| Seus próprios dados           | [Usar meus próprios dados](RECIPES.md#8-usar-meus-próprios-dados)                                     |
| Limites para quem abre o link | [Mostrar no PR que o problema foi resolvido](RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido) |

## Lançador de uma versão anterior

Um lançador da versão Python ou da 0.4.0 (com `tool.lock.json` e dependência por `codeload`) não é migrado: o `setup` para e pede um `--launcher` novo. Preserve o lançador antigo; os links dele continuam enquanto ele e o Worker antigo existirem. Não reutilize journals nem receitas da versão anterior.
