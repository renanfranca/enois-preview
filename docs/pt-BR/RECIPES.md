# Receitas

[English](../en/RECIPES.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Fluxo](FLOW.md) · [Tutorial](TUTORIAL.md)

Cada receita tem o mesmo formato: **Quando usar**, **Comandos**, **O que esperar** e **Se der errado**. Rode tudo no seu terminal local, nunca dentro de um Codespace. Quando o CLI falha, a mensagem começa com `Publication incomplete:` (ou `Source digest incomplete:` no `source-digest`) seguida do motivo; procure o motivo nesta página.

## 1. Instalar ou atualizar a ferramenta

**Quando usar:** na primeira instalação, para atualizar a ferramenta, ou quando o `setup` ainda não foi rodado nesta máquina.

**Comandos:**

```sh
npm install -g enois-preview
enois-preview setup
```

Para atualizar para outra versão publicada:

```sh
npm install -g enois-preview@<versão>
enois-preview --version
```

**O que esperar:** o `setup` confere ferramentas e logins, mostra o plano no stderr (`exists`, `create` ou `update` por recurso), pede uma confirmação, cria o que falta e termina com um JSON com `status: "configured"`, `created`, `updated` e `warnings`. Rodar de novo numa infraestrutura completa não escreve nada. O passo a passo, as flags e os segredos estão no [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).

Depois de atualizar, a configuração não muda. Na próxima publicação, se o lançador depende de outra versão do `enois-preview`, o `publish` refixa a dependência num commit da própria ferramenta, dentro do lease e antes do deploy; um `resume` interrompido reconcilia esse commit sem duplicá-lo.

Atenção:

- Nunca coloque tokens em argumentos, no chat ou em arquivos versionados. O setup lê o token do Worker num prompt oculto e passa todos os segredos pelo stdin.
- Interromper com Ctrl+C é seguro: rode `enois-preview setup` de novo e ele completa o que faltou.
- Um checkout de desenvolvimento roda como `0.0.0-SNAPSHOT`, que não existe no npm: ele não cria nem refixa lançadores.

**Se der errado:**

- `Infrastructure missing. Run enois-preview setup first.`: o `publish`, o `resume` ou o `source-digest` não acharam o `infrastructure.json`. Rode `enois-preview setup`.
- `Setup needs to create or update infrastructure; rerun in an interactive terminal or with --yes.`: o setup rodou sem terminal e havia algo a criar. Repita num terminal ou com `--yes` (o prompt do token ainda exige terminal).
- `Unknown command install. ...`: o comando `install` saiu; use `npm install -g enois-preview`.
- `enois-preview <versão> is not published on npm; run setup from an installed release.`: você rodou de um checkout de desenvolvimento. Use a ferramenta instalada pelo npm.
- Os demais casos em que o setup para estão no [diagnóstico de instalação](../diagnostics/installation.pt-BR.md#quando-o-setup-para).

## 2. Primeira publicação com o exemplo fictício

**Quando usar:** para conhecer a ferramenta ou validar sua infraestrutura sem dados reais.

**Comandos:**

```sh
node "$(npm root -g)/enois-preview/dist/example/prepare.js" ~/workspace-ficticio
enois-preview setup --config ~/workspace-ficticio/.preview/config.json
enois-preview publish meu-cenario
```

**O que esperar:** a preparação clona as três aplicações nos commits de [example/sources.json](../../example/sources.json), cria um H2 novo só com dados fictícios e uma configuração com as contas Lia (`example_lia`) e Rui (`example_rui`). O `publish` termina com um JSON com `status: "validated"` e a `url`. O passo a passo completo está no [tutorial](TUTORIAL.md).

**Se der errado:** `Example destination must not exist.` pede um caminho novo. Para falhas de infraestrutura, veja o [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).

## 3. Publicar de novo só com código novo

**Quando usar:** você fez commits novos nas aplicações e quer o mesmo cenário com os mesmos dados.

**Comandos:**

```sh
# nas três aplicações: comite o que quer mostrar; só o HEAD comitado é publicado
enois-preview publish meu-cenario
```

**O que esperar:** o CLI não lê o banco local; funciona até com o H2 indisponível. O JSON final traz `dataReused: true`, uma `revision` nova e uma `url` nova. Atualize à mão o link no pull request (PR). Se nenhum commit mudou, a revisão é a mesma e o JSON traz `reused: true`.

**Se der errado:** o aviso `source-dirty` indica que mudanças não comitadas ficaram de fora; comite e publique de novo. Falha numa etapa remota: veja a [receita 5](#5-retomar-uma-publicação-que-falhou). Outros avisos: veja a [receita 10](#10-erros-comuns-e-o-que-fazer).

## 4. Publicar com dados novos

**Quando usar:** você quer mostrar dados ou mídias que mudaram no seu banco local.

**Comandos:**

```sh
enois-preview publish meu-cenario --refresh-data
```

**O que esperar:** o CLI copia o H2 e as mídias com o seu backend rodando e depois sanitiza a cópia. Se o backend segurar o arquivo ou escrever durante a cópia, o resultado traz `database-in-use` ou `database-changed-during-copy`; a cópia é usada mesmo assim. Para uma cópia totalmente consistente, pare o backend você mesmo antes. O JSON final traz `dataReused: false`. Se os dados sanitizados forem iguais aos anteriores, a versão de dados é reaproveitada. As versões anteriores continuam disponíveis.

**Se der errado:**

- `Selected identity missing in refreshed data.`: uma conta selecionada não existe mais no banco. Corrija `accounts` na configuração (e repita o `setup`) ou passe `--accounts`, e rode o refresh de novo. Os dados completos anteriores continuam valendo.
- `Capture incomplete. <motivo> Previous complete data preserved; retry publication explicitly.`: a captura não substituiu nada. Corrija o motivo e repita.
- Uma cópia danificada por escrita simultânea aparece depois como falha de build ou de validação. Pare o backend e faça o refresh de novo.

## 5. Retomar uma publicação que falhou

**Quando usar:** o `publish` falhou depois de congelar a revisão. A mensagem tem este formato: `Stage <etapa> incomplete: <motivo> Revision <revisao>. Run enois-preview resume <revisao>.`

**Comandos:**

```sh
enois-preview resume <revisao-completa>
```

**O que esperar:** o `resume` usa os commits e dados gravados, confere os arquivos congelados, reconcilia o que já foi aceito remotamente e continua das etapas pendentes. Termina com o mesmo JSON do `publish`. Ele funciona mesmo com as aplicações e o H2 indisponíveis, porque nunca recaptura dados.

Atenção:

- Não altere o catálogo nem faça pushes manuais para completar a revisão.
- Revisões congeladas pela 0.3.1 ou anteriores só são retomadas pelo executor original: um checkout limpo no commit delas, compilado com `npm run build`.

**Se der errado:**

- `Resume requires the full 64 character revision ID.`: copie a revisão inteira da mensagem de falha.
- `Unknown revision. Resume never recaptures live data.`: essa revisão não existe neste `state`.
- `Another remote publication still holds the lease. Retry with resume after its owner reconciles; do not delete an ambiguous lease.`: outra operação pode estar viva. Espere e rode `resume` de novo. Se tiver certeza de que essa operação morreu, `enois-preview resume <revisao-completa> --force-lease` apaga a lease dela, registra a tomada no journal e continua com o aviso `lease-forced`.
- `Registry push outcome is unresolved.` ou `Deployment outcome unresolved; inspect Cloudflare deployments and resume after reconciliation.`: o resultado remoto é ambíguo. Inspecione o destino antes de repetir; veja o [diagnóstico](../diagnostics/README.md).

## 6. Ctrl+C, SIGTERM ou processo morto

**Quando usar:** você interrompeu um comando, ou o processo foi encerrado no meio.

**Comandos:**

```sh
# depois do Ctrl+C ou do SIGTERM, espere o comando terminar sozinho
echo $?    # 130 para Ctrl+C (SIGINT), 143 para SIGTERM
# se uma revisão já foi congelada:
enois-preview resume <revisao-completa>
# se não foi, repita o mesmo publish:
enois-preview publish meu-cenario
```

**O que esperar:** o primeiro `Ctrl+C` ou `SIGTERM` cancela os comandos ativos e impede as etapas seguintes. A captura nunca para o seu backend, então não há nada a restaurar. Uma captura incompleta mantém os dados completos anteriores.

Atenção:

- Um push ou uma implantação já aceitos podem precisar de reconciliação: cancelar a espera local não desfaz o efeito remoto. Use `resume` com a revisão informada.
- Se a operação interrompida deixou a lease remota para trás e você tem certeza de que ela não está mais rodando, acrescente `--force-lease` ao `resume` (veja [Lease](CONCEPTS.md#lease)). Nunca force uma lease que pode ser de uma operação viva.
- O `SIGKILL` não dá chance de limpeza; a próxima execução continua a partir do journal.

**Se der errado:** veja o [diagnóstico](../diagnostics/README.md).

## 7. Conferir se o banco mudou

**Quando usar:** você quer saber se os dados do banco de origem mudaram, por exemplo antes e depois de um teste manual na sua aplicação local.

**Comandos:**

```sh
enois-preview source-digest
```

**O que esperar:** um JSON com `databaseSha256`, `logicalSha256`, as contagens de linhas por tabela e `warnings`. O comando só lê: copia o H2 para um diretório privado, calcula o digest e apaga a cópia. Ele nunca inicia nem para o backend, funciona com o backend rodando. Se o arquivo parecer em uso, o resultado traz o aviso `database-in-use`: dados que o backend ainda não gravou no disco ficam fora do digest. Para um digest comparável, pare o backend antes; no exemplo fictício, `node "$(npm root -g)/enois-preview/dist/preview/service.js" ~/workspace-ficticio/.preview/service.json stop` faz isso. Compare o `logicalSha256` (o `SCRIPT` do H2 sem as linhas `CREATE USER`, com sha256), não o `databaseSha256`: um `start` e `stop` reescreve o arquivo sem mudar os dados.

**Se der errado:**

- `Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.`: rode o `setup` antes.

## 8. Usar meus próprios dados

**Quando usar:** você quer publicar com o seu banco H2 e as suas mídias, não com o exemplo fictício.

Atenção: todo o conteúdo do banco e das mídias configuradas fica visível para quem abre o link. Use só os seus próprios dados ou dados fictícios; a regra completa está em [Mostrar no PR que o problema foi resolvido](#9-mostrar-no-pr-que-o-problema-foi-resolvido).

**Comandos:** edite o arquivo de configuração privado e repita o setup.

```json
{
  "database": "/caminho/absoluto/rede.mv.db",
  "h2Jar": "/caminho/absoluto/h2-<versao>.jar",
  "media": [{ "root": "/caminho/absoluto/midias", "url": "/prefixo/" }],
  "accounts": [{ "id": "ID_ESTAVEL", "email": "conta@enois.invalid", "label": "Nome visível" }]
}
```

```sh
enois-preview setup --config /caminho/absoluto/config.json
```

**O que esperar:** o setup confere a infraestrutura (sem escrever nada quando ela já existe) e, no workspace, os comandos, os repositórios, o driver H2 e o banco, e termina com um JSON que traz `warnings`. Pouco espaço livre em disco (`storage-low`) e o lembrete dos planos gratuitos (`free-plan`) são avisos. Campos que o contrato do workspace não define, inclusive `repository`, `branch`, `registry`, `origin` e `cloudflareAccountId` (que agora ficam no `infrastructure.json`) ou `service`, `toolCommit` e `installation` da 0.3.x, são ignorados com um único aviso `ignored-config-fields`. Regras de cada campo:

- Todos os caminhos são absolutos. O `state` fica fora dos repositórios das aplicações.
- O driver `h2Jar` deve corresponder ao banco configurado.
- Os prefixos de `media` começam e terminam com `/` e não se sobrepõem.
- `accounts` precisa de pelo menos uma conta, sem limite máximo. `id` e `label` são obrigatórios.
- O `email` é opcional. Quando existe, deve ser um endereço válido e único na seleção; ele vira o login mostrado na página de entrada do link e é gravado nas tabelas `USER_CREDENTIALS` e `USERS` da cópia do H2. Prefira um endereço inventado em `@enois.invalid`, nunca o email real da pessoa: `.invalid` é um domínio reservado (RFC 2606 e RFC 6761) que nunca resolve, então nenhum email enviado pela demo chega a uma pessoa. Sem `email`, a ferramenta gera `account<N>@enois.invalid`. As contas não selecionadas ficam com `<id>@disabled.enois.invalid` e sem login.
- Se `accounts` ficar vazio, passe `enois-preview publish <cenario> --accounts ID[,ID...]`, ou deixe o primeiro `publish` listar as identidades do banco capturado e perguntar no terminal. Os rótulos vêm da listagem capturada, e um ID desconhecido falha. Sem terminal e sem contas, a mensagem cita `--accounts`.

**Se der errado:** `Accounts require a stable id and a label.` indica uma conta sem um deles. `Account emails must be valid addresses.` indica um `email` mal formado. `Select distinct accounts and demo logins.` indica duas contas com o mesmo ID ou o mesmo email. `Unknown account ID ...; use an ID from the captured listing.` indica um ID passado em `--accounts` que não existe no banco capturado.

<a id="9-compartilhar-o-link-no-pr"></a>

## 9. Mostrar no PR que o problema foi resolvido

**Quando usar:** você corrigiu algo e quer que quem avalia o PR veja a correção rodando, sem depender de print ou vídeo. Com o link, quem avalia abre a mudança num ambiente real e a analisa do jeito que preferir.

**Atenção: o link é público.** Os repositórios do Énóis são públicos, e o link colado no PR também. Antes de publicar, saiba o que fica exposto:

- Todo o conteúdo do H2 local e das mídias capturadas fica visível para quem abre o link, não só o que o PR mostra.
- As contas selecionadas viram contas compartilhadas, com a senha exibida na página de entrada do link. As outras contas continuam com perfil e conteúdo visíveis, só com o login desativado.
- A sanitização remove sessões, tokens e senhas, mas não anonimiza conteúdo.

Por isso, escolha os dados nesta ordem:

1. **Dados fictícios moldados no caso real:** reproduza a forma que causa o problema (tamanho dos textos, quantidade de itens, emojis, dimensões das imagens, estados como "fixado" ou "com selos", largura da tela), não o conteúdo real.
2. **Os seus próprios dados**, sabendo que ficam expostos a quem abrir o link.
3. **Conteúdo de outras pessoas, inclusive copiado do Énóis: não use**, a não ser com o consentimento delas ou o aval da equipe do Énóis.

**Comandos:**

1. Responda: o que torna o problema reproduzível? Crie esses dados fictícios na sua aplicação local, pela própria interface. Exemplos: um post fixado numa comunidade de nome longo, visto numa tela estreita; um perfil com as seções Sobre, Projetos e Publicações preenchidas.
2. Publique com esses dados: `enois-preview publish <cenario> --refresh-data` ([Publicar com dados novos](#4-publicar-com-dados-novos)). As contas com login vêm de `accounts` na configuração ([Usar meus próprios dados](#8-usar-meus-próprios-dados)). Com `accounts` vazio, só o primeiro `publish` de um cenário pergunta quais contas usar, e o refresh reaproveita as da captura anterior. Se as contas fictícias forem novas, passe `--accounts` com os IDs delas: uma seleção diferente dos dados congelados captura de novo.
3. Quando o comando terminar com `status: "validated"`, abra a `url` do JSON final e teste você mesmo o comportamento do PR.
4. Cole no PR o bloco abaixo, preenchido:

```markdown
## Como verificar

Preview: <url do JSON final>
Contas e senhas: na página de entrada do link (mudam a cada boot).

1. Entre como <conta>.
2. Abra <página> e <ação>.
3. Esperado: <resultado>. Confira no celular e no desktop, ou no seu próprio aparelho.

Dados fictícios, montados para reproduzir <característica do caso>.
<!-- Opcional: um print do "depois". O link continua sendo a evidência principal. -->
```

**O que esperar:** quem abre o link vê uma página de espera enquanto o Codespace sobe sozinho; ninguém precisa abrir o terminal dele. Depois, aparece a página com as contas e as senhas, geradas a cada boot. Quem avalia pode abrir o link no próprio celular, um aparelho real e não uma emulação.

Atenção:

- As contas, os dados e o disco são compartilhados entre todos os visitantes. Use sessões independentes para quem escreve e para quem lê. Um visitante pode trocar a senha de uma conta compartilhada e trancar os outros até o ambiente ser reciclado; isso é aceito.
- Cada arquivo enviado tem limite de 100 MB, o teto de corpo de requisição do plano gratuito da Cloudflare, e os limites de mídia do próprio backend continuam valendo. O total só é limitado pelo disco do Codespace; disco cheio aparece como erro de escrita do próprio backend.
- Um novo boot descarta alterações e uploads, restaura a semente e troca as senhas.
- O cadastro público fica desligado por `rede.auth.signup-enabled=false` e o envio de email por `spring.mail.*`. As outras rotas da aplicação não são bloqueadas; só caminhos `/__demo/` e caminhos com `;` são recusados.
- A exclusão começa após dez minutos sem interação reconhecida. A página de espera, inclusive o polling de status, e a leitura de credenciais não renovam o prazo. Disponibilidade e franquias das plataformas limitam essa proteção.
- O link é imutável, mas o ambiente não é permanente. Uma revisão nova gera outro link, que você atualiza no PR à mão.
- O ambiente só sobe enquanto a sua infraestrutura e as cotas gratuitas continuarem existindo. Um print opcional do "depois" serve como registro durável; ele acompanha o link e nunca o substitui.

**Se der errado:** `O GitHub recusou a criação.` na página pede para esperar dez minutos e tentar de novo, sem mudar máquina ou plano. Se o ambiente não iniciar, veja o [diagnóstico](../diagnostics/README.md).

## 10. Erros comuns e o que fazer

**Quando usar:** o CLI parou o comando, ou o JSON final traz avisos que você quer entender.

**Comandos:** conforme o erro ou o aviso, abaixo.

**O que esperar:** depois da correção, o mesmo comando segue normalmente. Um aviso nunca para um comando.

**Se der errado:**

| Mensagem                                                                                                    | O que fazer                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unsupported record format. Expected enois-preview-ts-v1.`                                                  | O arquivo vem de uma versão antiga. Preserve os arquivos antigos e crie uma instalação nova com `--home NOVO_DIRETORIO`.                                                                                                    |
| `Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.`                               | Rode o `setup` antes.                                                                                                                                                                                                       |
| `Infrastructure missing. Run enois-preview setup first.`                                                    | Não há `infrastructure.json`. Rode `enois-preview setup` (receita 1).                                                                                                                                                       |
| `Revision ... was created by an earlier enois-preview version and cannot be resumed by this version. ...`   | O `resume` recebeu uma revisão cujo journal não grava `toolVersion` (criada pela 0.4.0 ou antes). O journal está íntegro; ele só pertence a outra versão. Rode `enois-preview publish CENARIO` para criar uma revisão nova. |
| `Select stable account IDs with enois-preview publish SCENARIO --accounts ID[,ID...], ...`                  | Não há contas configuradas nem terminal para perguntar. Passe `--accounts` (receita 8).                                                                                                                                     |
| `Stage localImage incomplete: docker failed (exit 1); …`                                                    | Uma aplicação não compila nos commits publicados. Leia o `build.log` da operação. Nada remoto foi alterado.                                                                                                                 |
| `Stage publicValidation incomplete: ...` com `Readiness is not UP`, `input identity mismatch` ou `HTTP 401` | O app não subiu, roda outra revisão, ou uma conta selecionada não consegue entrar. Essas são as únicas falhas da validação. Veja o [diagnóstico](../diagnostics/README.md).                                                 |
| Node fora de `>=24 <25`                                                                                     | A ferramenta não confere a versão do Node e não tem mensagem própria para isso. Confira com `node --version` e use `nvm install` e `nvm use`, que leem o `.nvmrc`.                                                          |

Avisos, em `warnings: [{code, message}]` e no stderr como `warning: <mensagem>`:

| Código                                                                                  | Significado                                                                                                                             | O que fazer                                                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `source-dirty`                                                                          | Uma aplicação tem mudanças staged, unstaged ou arquivos não rastreados; só o `HEAD` comitado foi publicado.                             | Comite o que quer mostrar e publique de novo.                                                         |
| `database-in-use`, `database-changed-during-copy`, `media-changed-during-copy`          | O backend segurou ou alterou os arquivos durante a captura. A cópia foi usada.                                                          | Se o build ou a validação falhar, pare o backend e faça o refresh.                                    |
| `credential-column`                                                                     | O banco tem uma coluna com cara de credencial que esta versão não conhece, citada como `TABELA.COLUNA`. Os valores dela foram mantidos. | Confira o que essa coluna guarda antes de compartilhar o link.                                        |
| `storage-low`                                                                           | Pouco espaço livre em disco para a captura.                                                                                             | Libere espaço se a captura falhar.                                                                    |
| `registry-codespaces-access`                                                            | Este `publish` criou o pacote GHCR, e não há API para liberar o acesso dos Codespaces a ele.                                            | Nas configurações do pacote (URL no aviso), em **Manage Codespaces access**, adicione o lançador.     |
| `lease-forced`                                                                          | O `--force-lease` apagou a lease remota de outra operação.                                                                              | Confirme que essa operação não está rodando.                                                          |
| `ignored-config-fields`                                                                 | O workspace tem campos que o contrato não define, como os de infraestrutura ou `service`, `toolCommit` e `installation` da 0.3.x.       | Remova quando for conveniente; a infraestrutura vem sempre do `infrastructure.json`.                  |
| `free-plan`, `launcher-not-private`                                                     | Lembretes do `setup` sobre planos e visibilidade.                                                                                       | Mantenha as duas contas nos planos gratuitos com gastos bloqueados, e o lançador e o pacote privados. |
| `browser-missing`                                                                       | O `setup` não conseguiu instalar o Chromium da validação pública.                                                                       | Rode o comando que o aviso mostra.                                                                    |
| `permissions-differ`, `session-cookies-missing`, `media-*`, `image-*`, `external-reads` | Uma conferência da validação diferiu do registro congelado. O link foi validado mesmo assim.                                            | Abra o link e confira as telas afetadas.                                                              |
