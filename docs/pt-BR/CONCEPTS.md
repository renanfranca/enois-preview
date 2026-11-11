# Conceitos

[English](../en/CONCEPTS.md) · [README](../../README.md) · [Fluxo](FLOW.md) · [Receitas](RECIPES.md)

Leia este guia antes de rodar o primeiro comando. Ele explica as palavras que aparecem nas mensagens do CLI e por que a ferramenta se comporta como se comporta.

## Em uma frase

Você aponta o enois-preview para commits das três aplicações do Énóis e para uma cópia dos seus dados. Ele congela tudo isso numa **revisão** e devolve um link HTTPS. Quem abre o link recebe um Codespace novo com o app inteiro rodando, que é apagado sozinho depois de dez minutos sem uso.

## Glossário

### Cenário

Nome curto que você escolhe para um preview, como `meu-cenario`. Aceita só letras minúsculas, dígitos e hífens simples entre eles. Você passa o cenário em `enois-preview publish <cenario>`.

**Por que importa para você:** cada cenário guarda os próprios dados congelados. Publicar de novo o mesmo cenário reaproveita esses dados; um cenário novo faz uma captura nova.

### Revisão

Identificador sha256 de 64 caracteres calculado sobre todas as entradas congeladas: o nome do cenário, os commits das três aplicações, os arquivos exportados desses commits, a versão dos dados, a receita da imagem (`recipe/`), o runtime do Codespace (`runtime/`), o Worker (`src/`), o `dist` compilado e o `toolCommit`. O link público usa `<cenario>-<16 primeiros caracteres da revisão>`.

**Por que importa para você:** se nada mudou, a revisão é a mesma e o link também. Qualquer commit novo gera outra revisão e outro link, que você precisa colar no PR. Para retomar uma publicação, use a revisão **completa**, com 64 caracteres.

### Dados congelados e captura

A **captura** para o backend local (só se ele estiver rodando), copia o banco H2 e as pastas de mídia configuradas e devolve o backend ao estado anterior. Depois, ela sanitiza a cópia: só as contas selecionadas continuam com login. O resultado fica em `<state>/data/<id>/`, onde `<state>` é o campo `state` da sua configuração.

**Por que importa para você:** a captura acontece só no primeiro `publish` de um cenário ou quando você pede `--refresh-data`. Nas outras publicações o banco local nem é lido. Uma captura incompleta nunca substitui os dados completos anteriores.

### Lançador

Repositório GitHub **privado** do operador. Contém o Worker (`launcher.ts` e `wrangler.jsonc`), o catálogo (`catalog/scenarios.json`), a configuração de cada revisão em `.devcontainer/<slug>/` e o `tool.lock.json`, que fixa o commit público da ferramenta.

**Por que importa para você:** o `publish` faz commits e pushes nesse repositório por você. Não edite o catálogo à mão para completar uma publicação; use `resume`.

### Journal

Arquivo `<state>/operations/<revisao>/journal.json`. Registra a etapa atual, a intenção de cada etapa antes do efeito remoto e o resultado (checkpoint) de cada etapa concluída.

**Por que importa para você:** é o journal que permite `enois-preview resume <revisao>` continuar exatamente do ponto da falha, sem recapturar dados e sem repetir um push que já foi aceito.

### Lease

Trava que impede duas operações de mexer na mesma coisa ao mesmo tempo. As leases locais são arquivos travados com `flock` (por exemplo `<state>/publication.lock`). A lease remota é a ref `refs/heads/enois-preview-publication-lease` no lançador.

**Por que importa para você:** se uma lease está ocupada, outra operação pode estar viva. Não apague uma lease de outra operação; espere ou use `resume` depois que o dono terminar.

### `restoration.json`

Arquivo `<state>/restoration.json`, gravado antes da captura parar o backend. Diz como o backend estava (rodando ou parado) e com qual configuração de serviço.

**Por que importa para você:** se a restauração do backend falhar, esse arquivo fica. O próximo `publish` ou `resume` lê o arquivo e devolve o backend ao estado anterior antes de olhar as fontes. Não apague esse arquivo.

### `toolCommit` e `install.json`

`toolCommit` é o commit público completo da ferramenta, configurado por você e igual ao fixado no `tool.lock.json` do lançador. `install.json` fica dentro da instalação e guarda esse commit e os hashes da fonte e do `dist`.

**Por que importa para você:** antes de `publish` e `resume`, a ferramenta recalcula os hashes. Se a instalação foi alterada (por exemplo, alguém rodou `npm run` dentro dela) ou pertence a outro commit, ela recusa antes de qualquer efeito.

### As três aplicações

As fontes publicadas são `enois-backend` (Spring Boot, Java 25, banco H2), `enois-frontend` (Nuxt) e `enois-design-system` (pacote npm). O exemplo fictício fixa os commits delas em [example/sources.json](../../example/sources.json).

**Por que importa para você:** as três precisam estar com a árvore limpa e com as mudanças já comitadas por você. A ferramenta exporta os commits e nunca comita nem altera esses repositórios.

### Worker, Durable Object e Codespace

O **Worker** da Cloudflare atende o link público. Para cada cenário publicado existe um **Durable Object**, que lembra se há um Codespace, em que fase ele está e quando houve a última interação. O **Codespace** é a máquina do GitHub onde o app roda.

**Por que importa para você:** o Codespace sobe sozinho. Se você precisar abrir o terminal dele para iniciar algo, isso é uma falha de boot, não uma etapa normal.

## Código vs dados

O código vem sempre dos **commits atuais** das três aplicações, exportados por `git archive`. Os dados vêm da **última captura** do cenário e ficam congelados até você pedir `--refresh-data`.

| Você quer | Comando | Captura dados? |
| --- | --- | --- |
| Mostrar código novo com os mesmos dados | `enois-preview publish <cenario>` | Não |
| Mostrar dados ou mídias novos | `enois-preview publish <cenario> --refresh-data` | Sim |
| Terminar uma publicação que falhou | `enois-preview resume <revisao-completa>` | Nunca |

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
| `~/.config/enois-preview-ts/config.json` | Configuração privada e confirmação inicial dos planos gratuitos. Mude o diretório com `ENOIS_PREVIEW_HOME` ou `--home` |
| `<state>/scenarios/<cenario>.json` | Qual versão de dados o cenário usa |
| `<state>/data/<id>/` | Dados congelados e sanitizados |
| `<state>/operations/<revisao>/` | Journal, arquivos congelados e evidências de cada revisão |
| `<state>/restoration.json` | Restauração pendente do backend, quando existe |
| Lançador: `catalog/scenarios.json` | Catálogo de revisões publicadas |
| Lançador: `.devcontainer/<slug>/` | Configuração do Codespace de cada revisão |
