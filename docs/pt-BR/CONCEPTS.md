# Conceitos

[English](../en/CONCEPTS.md) · [README](../../README.md) · [Fluxo](FLOW.md) · [Receitas](RECIPES.md)

Leia este guia antes de rodar o primeiro comando. Ele explica as palavras que aparecem nas mensagens da ferramenta e por que ela se comporta como se comporta.

## Glossário

### As três aplicações

O Énóis ([enois.ia.br](https://enois.ia.br)) é uma rede social gratuita, sem anúncios e sem fins lucrativos, construída junto com a comunidade. Ele é feito de três aplicações, que são as fontes publicadas: `enois-backend` (Spring Boot, Java 25), que guarda os dados num banco **H2**, um banco de dados Java gravado num arquivo local; `enois-frontend` (Nuxt); e `enois-design-system` (pacote npm). O exemplo fictício fixa os commits delas em [example/sources.json](../../example/sources.json).

**Por que importa para você:** as três precisam estar com a árvore limpa e com as mudanças já comitadas por você. A ferramenta exporta os commits e nunca comita nem altera esses repositórios.

### PR (pull request)

Um pull request (PR) é o pedido para que outras pessoas avaliem uma mudança de código no GitHub: você propõe mudanças numa das três aplicações e outras pessoas leem e testam antes de aceitar.

**Por que importa para você:** no PR, você precisa mostrar que a mudança funciona. O enois-preview existe para que o PR traga um link onde quem avalia abre a mudança rodando e a analisa como preferir, sem depender só de prints e vídeos e sem montar nada na própria máquina.

### Operador e visitante

O **operador** é quem abre o PR e roda o enois-preview no próprio terminal para publicar o link. O **visitante** é qualquer pessoa que tenha o link e o abra no navegador, por exemplo quem avalia o PR.

**Por que importa para você:** este guia fala com o operador. Os visitantes não instalam nada e compartilham as mesmas contas, os mesmos dados e a mesma capacidade de upload. Num PR público, quem lê o PR também pode ser visitante; o que isso exige dos dados está em [Mostrar no PR que o problema foi resolvido](RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido).

### CLI

A interface de linha de comando: o comando `enois-preview` (`setup`, `publish`, `resume` e `source-digest`), que você roda no terminal da sua máquina.

**Por que importa para você:** as mensagens de erro e o JSON final vêm do CLI. Ele roda só na sua máquina; os visitantes nunca o usam.

### Worker, Durable Object e Codespace

O **Codespace** é uma máquina de desenvolvimento na nuvem do GitHub; é nela que o app roda para o visitante. O **Worker** da Cloudflare é o programa que atende o link público. Para cada link publicado existe um **Durable Object**, um pequeno estado guardado pela Cloudflare, que lembra se há um Codespace, em que fase ele está e quando houve a última interação.

**Por que importa para você:** o Codespace sobe sozinho. Se você precisar abrir o terminal dele para iniciar algo, isso é uma falha de boot, não uma etapa normal.

### GHCR

O GitHub Container Registry, onde o GitHub guarda imagens Docker. A ferramenta envia para um pacote **privado** seu no GHCR a imagem com o app que o Codespace usa para subir.

**Por que importa para você:** o `publish` precisa da sua autenticação no GHCR. A imagem é referenciada pelo digest, então um link já publicado nunca passa a usar outra imagem.

### Lançador

Repositório GitHub **privado** do operador. Contém o Worker (`launcher.ts` e `wrangler.jsonc`), o catálogo das publicações, a configuração do Codespace de cada publicação em `.devcontainer/<slug>/` (o **devcontainer**, arquivo do GitHub que diz ao Codespace qual imagem usar e como subir) e o `tool.lock.json`, que fixa o commit público da ferramenta. Os caminhos estão em [Onde ficam os arquivos](#onde-ficam-os-arquivos).

**Por que importa para você:** o `publish` faz commits e pushes nesse repositório por você. Não edite o catálogo à mão para completar uma publicação; use `resume`.

### Cenário

Nome curto que você escolhe para um preview, como `meu-cenario`. Aceita só letras minúsculas, dígitos e hífens simples entre eles. Você passa o cenário em `enois-preview publish <cenario>`.

**Por que importa para você:** cada cenário guarda a própria cópia congelada dos seus dados. Publicar de novo o mesmo cenário reaproveita essa cópia; um cenário novo copia os dados de novo.

### Revisão

Identificador sha256 de 64 caracteres calculado sobre todas as entradas congeladas: o nome do cenário, os commits das três aplicações, os arquivos exportados desses commits, a versão dos dados, a receita da imagem (`recipe/`), o runtime do Codespace (`runtime/`), o Worker (`src/`) e o `dist` compilado. O commit da ferramenta é registrado, mas não entra na revisão, porque esses inventários já identificam o que foi construído. O link público usa `<cenario>-<16 primeiros caracteres da revisão>`. Não confunda com a avaliação de código feita no PR.

**Por que importa para você:** se nada mudou, a revisão é a mesma e o link também. Qualquer commit novo gera outra revisão e outro link, que você precisa colar no PR. Para retomar uma publicação, use a revisão **completa**, com 64 caracteres.

### Dados congelados e captura

A **captura** copia o banco H2 e as pastas de mídia configuradas para o estado privado, sem parar, iniciar nem esperar o seu backend. Se o arquivo parecer em uso (o `fuser` relata, ou existe `rede.lock.db` ao lado), o resultado traz o aviso `database-in-use`; se o arquivo mudou durante a cópia, `database-changed-during-copy`. A cópia é usada mesmo assim, e uma cópia danificada aparece como falha de build ou de validação. Depois, a captura **sanitiza** a cópia, isto é, remove dela sessões, tokens e senhas: só as contas selecionadas continuam com login. Uma coluna desconhecida com cara de credencial não para a captura: ela aparece como `TABELA.COLUNA` no aviso `credential-column`. Esses logins usam emails inventados em `@enois.invalid`, como explica [Usar meus próprios dados](RECIPES.md#8-usar-meus-próprios-dados). O resultado fica em `<state>/data/<id>/`, onde `<state>` é o campo `state` da sua configuração.

**Por que importa para você:** a captura acontece só no primeiro `publish` de um cenário ou quando você pede `--refresh-data`. Nas outras publicações o banco local nem é lido. Uma captura incompleta nunca substitui os dados completos anteriores.

### Journal

Arquivo `<state>/operations/<revisao>/journal.json`. Registra a etapa atual, a intenção de cada etapa antes do efeito remoto e o resultado (checkpoint) de cada etapa concluída.

**Por que importa para você:** é o journal que permite `enois-preview resume <revisao>` continuar exatamente do ponto da falha, sem recapturar dados e sem repetir um push que já foi aceito.

### Lease

Trava que impede duas operações de mexer na mesma coisa ao mesmo tempo. As leases locais são arquivos travados com `flock` (por exemplo `<state>/publication.lock`). A lease remota é a ref `refs/heads/enois-preview-publication-lease` no lançador.

**Por que importa para você:** se uma lease está ocupada, outra operação pode estar viva. Espere ou use `resume` depois que o dono terminar. Quando você sabe que a outra operação morreu, `publish --force-lease` ou `resume --force-lease` apaga a lease remota dela, registra a tomada em `journal.intents.remoteLease.forced` e mostra o aviso `lease-forced`. Sem a flag, a ferramenta espera e recusa como antes.

### Commit da ferramenta e `install.json`

`install.json` fica dentro de uma instalação e guarda o commit público dela e os hashes da fonte e do `dist`. Antes de `publish` e `resume`, a ferramenta recalcula esses hashes. Quando batem, o journal e o resultado registram esse commit como `toolCommit`, com `toolVerified: true`. Caso contrário, como num checkout de desenvolvimento ou numa instalação alterada por `npm run`, a ferramenta roda mesmo assim: registra o `HEAD` do Git do checkout (ou `null`), marca `toolVerified: false` e mostra o aviso `unverified-tool`.

A configuração não tem mais o campo `toolCommit`. Uma configuração da 0.3.x que ainda o traga, ou traga `service` ou `installation`, carrega normalmente; esses campos são ignorados e preservados, com um único aviso `ignored-config-fields`.

**Por que importa para você:** se o `tool.lock.json` do lançador ou a dependência `enois-preview` dele fixam outro commit, a publicação continua com o aviso `launcher-pin`, que cita os dois commits. O lançador nunca é refixado automaticamente; refixe você quando quiser que o Worker use esta versão.

### Aviso

Mensagem sobre algo que a ferramenta observou e que não para a operação, como `source-dirty` ou `database-in-use`. O JSON final de `setup`, `publish`, `resume` e `source-digest` sempre traz `warnings: [{code, message}]`, e cada aviso também sai no stderr como `warning: <mensagem>`.

**Por que importa para você:** só três coisas param uma operação: a aplicação não compila ou não roda, a ferramenta não consegue identificar a revisão que construiu e publicou, ou uma conta selecionada não consegue entrar. Leia os avisos antes de compartilhar o link.

## Em uma frase

Você aponta o enois-preview para commits das três aplicações do Énóis e para uma cópia dos seus dados. Ele congela tudo isso numa **revisão** e devolve um link HTTPS. Quem abre o link recebe um Codespace novo com o app inteiro rodando, que é apagado sozinho depois de dez minutos sem uso.

## Código vs dados

O código vem sempre dos **commits atuais** das três aplicações, exportados por `git archive`. Os dados vêm da **última captura** do cenário e ficam congelados até você pedir `--refresh-data`.

| Você quer | Comando | Captura dados? |
| --- | --- | --- |
| Mostrar código novo com os mesmos dados | `enois-preview publish <cenario>` | Não |
| Mostrar dados ou mídias novos | `enois-preview publish <cenario> --refresh-data` | Sim |
| Terminar uma publicação que falhou | `enois-preview resume <revisao-completa>` | Nunca |

A captura nunca para o seu backend. O pacote do design system é construído de novo a partir do commit dele a cada imagem.

Por isso, depois da primeira captura, você pode publicar código novo mesmo com o H2 local indisponível.

## Por que é imutável

Uma revisão nunca muda depois de congelada. A imagem é referenciada pelo digest no GHCR, a configuração e o catálogo ficam em commits do lançador e uma entrada existente no catálogo nunca é sobrescrita.

Isso traz três vantagens:

1. O link colado no PR mostra sempre o mesmo código e os mesmos dados.
2. Uma publicação interrompida pode ser retomada com segurança: `resume` confere os arquivos congelados e reaproveita o que já foi aceito.
3. Duas pessoas não sobrescrevem a revisão uma da outra.

A contrapartida: para mudar qualquer coisa, você gera uma revisão nova e atualiza o link no PR. Um link imutável também não promete um ambiente sempre ligado; ele só garante que o próximo boot usa as mesmas entradas.

## Onde ficam os arquivos

| Caminho | O que é |
| --- | --- |
| `~/.local/share/enois-preview/<COMMIT>/` | Instalação imutável da ferramenta, com `install.json` |
| `~/.local/share/enois-preview/current` | Link para a instalação em uso |
| `~/.config/enois-preview-ts/config.json` | Configuração privada. Mude o diretório com `ENOIS_PREVIEW_HOME` ou `--home` |
| `<state>/scenarios/<cenario>.json` | Qual versão de dados o cenário usa |
| `<state>/data/<id>/` | Dados congelados e sanitizados |
| `<state>/operations/<revisao>/` | Journal, arquivos congelados e evidências de cada revisão |
| Lançador: `catalog/scenarios.json` | Catálogo de revisões publicadas |
| Lançador: `.devcontainer/<slug>/` | Configuração do Codespace de cada revisão |
