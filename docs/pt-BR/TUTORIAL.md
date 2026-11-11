# Publicar uma revisão de teste

[English](../en/TUTORIAL.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Fluxo](FLOW.md) · [Receitas](RECIPES.md)

Este tutorial leva você da instalação até o primeiro link publicado, usando o exemplo fictício. As situações do dia a dia (publicar de novo, refresh, retomar, interrupções) estão nas [receitas](RECIPES.md).

## Antes de começar

- Tenha os [requisitos do README](../../README.md#requisitos) e sua infraestrutura privada pronta: [lançador](CONCEPTS.md#lançador) privado com `wrangler.jsonc`, Worker e catálogo, e pacote GHCR privado. Se faltar algo, siga o [diagnóstico de instalação](../diagnostics/installation.pt-BR.md) antes.
- Tenha em mãos o commit público completo fixado no `tool.lock.json` do seu lançador. Abaixo ele aparece como `<COMMIT_PUBLICO_FIXADO>`.

Atenção:
- Use só o seu terminal local. Não execute comandos dentro de um Codespace para completar o boot de uma revisão.
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

3. Clone a ferramenta num diretório temporário:

   ```sh
   git clone https://github.com/renanfranca/enois-preview.git /caminho/temporario/enois-preview
   ```

4. Entre no clone:

   ```sh
   cd /caminho/temporario/enois-preview
   ```

5. Vá para o commit fixado:

   ```sh
   git checkout --detach <COMMIT_PUBLICO_FIXADO>
   ```

6. Selecione Node 24.x (`>=24 <25`); o `.nvmrc` indica a família 24:

   ```sh
   nvm install
   ```

7. Instale as dependências sem scripts de instalação:

   ```sh
   npm ci --ignore-scripts
   ```

8. Compile:

   ```sh
   npm run build
   ```

9. Crie a instalação verificada desse commit:

   ```sh
   node dist/scripts/install-tool.js --commit <COMMIT_PUBLICO_FIXADO>
   ```

   O instalador cria `~/.local/share/enois-preview/<COMMIT_PUBLICO_FIXADO>`, aponta `~/.local/share/enois-preview/current` para ela e liga o comando `enois-preview`. Veja [`toolCommit` e `install.json`](CONCEPTS.md#toolcommit-e-installjson).

   Atenção: não execute `npm run` nem edite arquivos dentro da instalação. O `publish` recusaria a instalação depois.

10. Entre na instalação:

    ```sh
    cd ~/.local/share/enois-preview/current
    ```

11. Instale o navegador usado na validação pública:

    ```sh
    npx --no-install playwright install chromium
    ```

12. Autentique na Cloudflare:

    ```sh
    npx --no-install wrangler login
    ```

13. Prepare o workspace fictício num caminho que ainda não existe:

    ```sh
    node dist/example/prepare.js /caminho/absoluto/novo-workspace
    ```

    A preparação busca as fontes públicas fixadas, compila o backend e aplica as migrações dele a um H2 novo antes de inserir só dados fictícios.

14. Edite o arquivo privado `/caminho/absoluto/novo-workspace/.preview/config.json`. Substitua `repository`, `branch`, `registry`, `origin` e `cloudflareAccountId` pela sua infraestrutura existente e preencha `toolCommit` com `<COMMIT_PUBLICO_FIXADO>`.

    Atenção: não use a infraestrutura de outro operador.

15. Rode o setup:

    ```sh
    enois-preview setup --config /caminho/absoluto/novo-workspace/.preview/config.json
    ```

    Confira os planos gratuitos e os bloqueios de gasto nas contas configuradas e responda `yes` à confirmação no terminal interativo. O setup verifica acessos e a identidade do serviço e guarda a configuração e a confirmação em `~/.config/enois-preview-ts`. Defina `ENOIS_PREVIEW_HOME` para manter outra instalação independente. Repetir o setup preserva a confirmação da mesma infraestrutura; não existe renovação periódica.

16. Publique:

    ```sh
    enois-preview publish meu-cenario
    ```

    Na primeira publicação acontece a [captura](CONCEPTS.md#dados-congelados-e-captura). O exemplo já seleciona Lia (`example_lia`) e Rui (`example_rui`), com as permissões preservadas. O comando só termina com sucesso depois de validar imagem, boot, saúde JSON, todas as contas, mídias e identidade pública. O que acontece em cada etapa está em [Fluxo](FLOW.md#o-que-acontece-no-publish).

17. Abra a `url` do JSON final no navegador, teste o comportamento específico do PR e cole o link no PR. As senhas aparecem na página de entrada do ambiente, nunca no relatório do CLI.

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
| Limites para quem abre o link | [Compartilhar o link no PR](RECIPES.md#9-compartilhar-o-link-no-pr) |

## Lançador da versão Python

Antes de usar um lançador da versão Python:

1. Preserve o catálogo dele no histórico do Git.
2. Prepare um catálogo vazio `{ "format": "enois-preview-ts-v1", "scenarios": {} }`, um `tool.lock.json` com o mesmo formato e `launcher.ts`.
3. Aponte a dependência pública para o SHA imutável da versão TypeScript.
4. Depois de `npm ci --ignore-scripts`, rode `npm run build` no lançador. Ele compila explicitamente `node_modules/enois-preview` e verifica `launcher.ts`.

Atenção: não reutilize configuração, journals, receitas ou confirmação financeira da versão anterior. O procedimento completo está no [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).
