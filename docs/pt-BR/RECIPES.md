# Receitas

[English](../en/RECIPES.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Fluxo](FLOW.md) · [Tutorial](TUTORIAL.md)

Cada receita tem o mesmo formato: **Quando usar**, **Comandos**, **O que esperar** e **Se der errado**. Rode tudo no seu terminal local, nunca dentro de um Codespace. Quando o CLI falha, a mensagem começa com `Publication incomplete:` (ou `Source digest incomplete:` no `source-digest`) seguida do motivo; procure o motivo nesta página.

## 1. Instalar ou trocar a ferramenta para outro commit fixado

**Quando usar:** na primeira instalação ou quando o lançador passar a fixar outro commit público em `tool.lock.json`.

**Comandos:**

Na primeira instalação, com Node 24.x, npm, `curl` e `tar`:

```sh
COMMIT=<COMMIT_PUBLICO_FIXADO>
curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
```

Com a ferramenta já instalada, para trocar para outro commit fixado:

```sh
enois-preview install <COMMIT_PUBLICO_FIXADO>
```

Os dois caminhos fazem a mesma instalação verificada e instalam o Chromium usado na validação pública. O `install.sh` vem do próprio commit fixado e só prepara o instalador num diretório temporário, apagado no fim.

Depois de trocar de commit, coloque o mesmo SHA em `toolCommit` no seu arquivo de configuração privado e repita `enois-preview setup --config <arquivo>`. O lançador também precisa fixar esse commit em `tool.lock.json` e na dependência `enois-preview` do `package.json`; veja o [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).

Caminho manual, para um commit anterior à 0.3.9 (que não tem `install.sh` nem instala o Chromium sozinho) ou para quem prefere não executar um script baixado:

```sh
git clone https://github.com/renanfranca/enois-preview.git /caminho/temporario/enois-preview
cd /caminho/temporario/enois-preview
git checkout --detach <COMMIT_PUBLICO_FIXADO>
npm ci --ignore-scripts
npm run build
node dist/scripts/install-tool.js --commit <COMMIT_PUBLICO_FIXADO>
(cd ~/.local/share/enois-preview/current && npx --no-install playwright install chromium)
```

**O que esperar:** o instalador imprime um JSON com `commit`, `installation` (`~/.local/share/enois-preview/<COMMIT>`), `current`, `stamp` (o `install.json`), `linked: true` e `browser: true`. O comando `enois-preview` passa a apontar para essa instalação.

Atenção:
- A instalação é imutável. Não rode `npm run` nem edite arquivos dentro dela: isso recompila o `dist` e o `publish` passa a recusar a instalação.
- Um checkout de desenvolvimento não publica, nem limpo no mesmo commit.
- Autentique com `gh auth login` e o mecanismo de credenciais do Docker. Nunca coloque tokens em argumentos, no chat ou em arquivos versionados.
- Interromper com Ctrl+C antes de a instalação ser criada não deixa nada para trás, e o comando pode ser repetido. Interromper durante o download do Chromium deixa a instalação completa; basta rodar o comando que a mensagem mostra.

**Se der errado:**
- `is already installed at ...; installations are immutable.`: esse commit já está instalado. O instalador não sobrescreve nem troca o `current` nesse caso.
- `Download of ... failed (HTTP ...)` ou `Download of commit ... failed`: confira se o SHA completo existe no repositório público. Se o `curl` do `install.sh` responder 404, o commit é anterior à 0.3.9: use o caminho manual.
- `Download of ... failed; check the network connection and retry.`: a máquina não alcançou `codeload.github.com`. Confira a rede ou o proxy e repita. Nada foi instalado.
- `Chromium, used by the public validation, was not installed`: a instalação está completa, só faltou o navegador. Rode o comando que a mensagem mostra.
- `Node 24.x is required`: selecione o Node 24, por exemplo com `nvm install 24`, e repita.
- `Build changed source files outside dist`: o commit não é instalável; avise quem fixou o commit.
- Outros casos: [diagnóstico](../diagnostics/README.md).

## 2. Primeira publicação com o exemplo fictício

**Quando usar:** para conhecer a ferramenta ou validar sua infraestrutura sem dados reais.

**Comandos:**

```sh
node ~/.local/share/enois-preview/current/dist/example/prepare.js /caminho/novo/workspace-ficticio
# edite /caminho/novo/workspace-ficticio/.preview/config.json com sua infraestrutura
enois-preview setup --config /caminho/novo/workspace-ficticio/.preview/config.json
enois-preview publish meu-cenario
```

**O que esperar:** a preparação clona as três aplicações nos commits de [example/sources.json](../../example/sources.json), cria um H2 novo só com dados fictícios e uma configuração com as contas Lia (`example_lia`) e Rui (`example_rui`). O `publish` termina com um JSON com `status: "validated"` e a `url`. O passo a passo completo está no [tutorial](TUTORIAL.md).

**Se der errado:** `Example destination must not exist.` pede um caminho novo. Para falhas de infraestrutura, veja o [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).

## 3. Publicar de novo só com código novo

**Quando usar:** você fez commits novos nas aplicações e quer o mesmo cenário com os mesmos dados.

**Comandos:**

```sh
# nas três aplicações: comite suas mudanças e deixe a árvore limpa
enois-preview publish meu-cenario
```

**O que esperar:** o CLI não lê nem para o banco local; funciona até com o H2 indisponível. O JSON final traz `dataReused: true`, uma `revision` nova e uma `url` nova. Atualize à mão o link no pull request (PR). Se nenhum commit mudou, a revisão é a mesma e o JSON traz `reused: true`.

**Se der errado:** árvore suja ou instalação recusada: veja a [receita 10](#10-erros-comuns-e-o-que-fazer). Falha numa etapa remota: veja a [receita 5](#5-retomar-uma-publicação-que-falhou).

## 4. Publicar com dados novos

**Quando usar:** você quer mostrar dados ou mídias que mudaram no seu banco local.

**Comandos:**

```sh
enois-preview publish meu-cenario --refresh-data
```

**O que esperar:** o CLI para o backend (só se estava rodando), copia o H2 e as mídias, devolve o backend ao estado anterior e sanitiza a cópia. O JSON final traz `dataReused: false`. Se os dados sanitizados forem iguais aos anteriores, a versão de dados é reaproveitada. As versões anteriores continuam disponíveis.

**Se der errado:**
- `Selected identity missing in refreshed data.`: uma conta selecionada não existe mais no banco. Corrija `accounts` na configuração, repita `setup` e rode o refresh de novo. Os dados completos anteriores continuam valendo.
- `Capture incomplete; backend restored to its prior state.` ou `Capture incomplete; backend restoration pending.`: a captura não substituiu nada. Se a restauração ficou pendente, veja a [receita 6](#6-ctrlc-sigterm-ou-processo-morto).
- `H2 is in use or cannot be checked. No lock file was removed.`: algum processo ainda usa o arquivo do banco. Não apague arquivos de trava do H2.

## 5. Retomar uma publicação que falhou

**Quando usar:** o `publish` falhou depois de congelar a revisão. A mensagem tem este formato: `Stage <etapa> incomplete: <motivo> Backend restoration complete. Revision <revisao>. Run enois-preview resume <revisao>.`

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
- `Another remote publication still holds the lease. Retry with resume after its owner reconciles; do not delete an ambiguous lease.`: outra operação pode estar viva. Espere e rode `resume` de novo.
- `Registry push outcome is unresolved.` ou `Deployment outcome unresolved; inspect Cloudflare deployments and resume after reconciliation.`: o resultado remoto é ambíguo. Inspecione o destino antes de repetir; veja o [diagnóstico](../diagnostics/README.md).

## 6. Ctrl+C, SIGTERM ou processo morto

**Quando usar:** você interrompeu um comando, ou o processo foi encerrado no meio.

**Comandos:**

```sh
# depois de Ctrl+C ou SIGTERM, espere o comando terminar sozinho
echo $?    # 130 para Ctrl+C (SIGINT), 143 para SIGTERM
# se uma revisão já estava congelada:
enois-preview resume <revisao-completa>
# se não estava, repita o mesmo publish:
enois-preview publish meu-cenario
```

**O que esperar:** o primeiro `Ctrl+C` ou `SIGTERM` cancela os comandos ativos e impede novas etapas. O CLI ainda conclui a restauração do backend; sinais adicionais não interrompem essa restauração. No fim, ele informa `Backend restored to its prior state.` ou `Backend restoration pending; preserve its record and retry this command.`. Uma captura incompleta mantém os dados completos anteriores.

Atenção:
- Se a restauração ficou pendente, preserve `<state>/restoration.json`. O próximo `publish` ou `resume` tenta a recuperação antes de avaliar as fontes.
- Um push ou deploy já aceito pode precisar de reconciliação: cancelar a espera local não desfaz o efeito remoto. Use `resume` com a revisão informada.
- Não remova leases de outra operação.
- `SIGKILL` não dá chance de restaurar; a recuperação acontece na próxima execução, a partir de `restoration.json` e do journal.

**Se der errado:** `Pending restoration belongs to another service configuration.` significa que a configuração do serviço mudou depois da captura. Volte a configuração exata registrada em `restoration.json` antes de tentar de novo. Veja o [diagnóstico](../diagnostics/README.md).

## 7. Conferir se o banco mudou

**Quando usar:** você quer saber se os dados do banco de origem mudaram, por exemplo antes e depois de iniciar e parar o backend.

**Comandos:**

```sh
# com o backend de origem parado e liberado
enois-preview source-digest
```

No exemplo fictício, o backend é controlado pelo adaptador configurado em `service`, por exemplo `node ~/.local/share/enois-preview/current/dist/preview/service.js /caminho/novo/workspace-ficticio/.preview/service.json stop`.

**O que esperar:** um JSON com `databaseSha256`, `logicalSha256` e as contagens de linhas por tabela. O comando só lê: copia o H2 para um diretório privado, calcula o digest e apaga a cópia. Ele nunca inicia nem para o backend e não exige a instalação verificada. Compare o `logicalSha256` (o `SCRIPT` do H2 sem as linhas `CREATE USER`, com sha256), não o `databaseSha256`: um `start` e `stop` reescreve o arquivo sem mudar os dados.

**Se der errado:**
- `The source backend must be stopped and released; source-digest never stops it. No digest computed.`: pare o backend pelo seu adaptador e rode de novo.
- `Backend restoration pending; run publish or resume to settle it first. No digest computed.`: resolva a restauração pendente (receita 6).
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
  "accounts": [{ "id": "ID_ESTAVEL", "email": "conta@enois.invalid", "label": "Nome visível" }],
  "service": {
    "status": ["comando", "arg"], "identity": ["comando", "arg"],
    "stop": ["comando", "arg"], "start": ["comando", "arg"],
    "ready": ["comando", "arg"], "released": ["comando", "arg"],
    "expectedIdentity": "texto que identity deve imprimir",
    "timeout": 60
  }
}
```

```sh
enois-preview setup --config /caminho/absoluto/config.json
```

**O que esperar:** o setup confere comandos, repositórios, o driver H2, o banco, o lançador, o GHCR e a identidade do serviço. Regras de cada campo:
- Todos os caminhos são absolutos. O `state` fica fora dos repositórios das aplicações.
- O driver `h2Jar` deve corresponder ao banco configurado.
- Cada comando de `service` é um vetor de argumentos, sem shell, com timeout (60 segundos se `timeout` faltar). `status` imprime `running` ou `stopped`, `ready` imprime `ready` e `released` imprime `released`.
- A saída de `identity` deve ser igual a `expectedIdentity`, que deve provar o dono do processo e o caminho do H2, nunca só uma porta.
- Os prefixos de `media` começam e terminam com `/` e não se sobrepõem.
- O `email` de cada conta em `accounts` é obrigatório no formato `<parte local>@enois.invalid`, e a parte local aceita só letras minúsculas, números, `.`, `_` e `-`. Use um email inventado, nunca o email real da pessoa: ele vira o login mostrado na página de entrada do link. A ferramenta confere essa regra ao ler a configuração (no `setup` e em todo comando que lê a config) e de novo ao sanitizar a cópia do H2, quando grava o email nas tabelas `USER_CREDENTIALS` e `USERS`. As contas não selecionadas ficam com `<id>@disabled.enois.invalid` e sem login. O motivo: `.invalid` é um domínio reservado (RFC 2606 e RFC 6761) que nunca resolve, então nenhum email enviado pela demo chega a uma pessoa, e o login exibido no link público não expõe o email verdadeiro de ninguém.
- Se `accounts` ficar vazio, o primeiro `publish` lista as identidades do banco capturado e pergunta no terminal quais IDs usar. Nesse caso, a ferramenta gera os logins `account1@enois.invalid`, `account2@enois.invalid` e assim por diante.

**Se der errado:** `Backend service ownership mismatch; configure its identity and database.` indica que `identity` não imprimiu `expectedIdentity`. `Configure service.<nome> as an argument array.` indica um comando ausente ou mal formado. `Accounts require stable id, label and disposable @enois.invalid email.` indica uma conta com email fora do formato: troque o email da conta para `<algo>@enois.invalid`.

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
2. Publique com esses dados: `enois-preview publish <cenario> --refresh-data` ([Publicar com dados novos](#4-publicar-com-dados-novos)). As contas com login vêm de `accounts` na configuração ([Usar meus próprios dados](#8-usar-meus-próprios-dados)). Com `accounts` vazio, só o primeiro `publish` de um cenário pergunta quais contas usar, e o refresh reaproveita as da captura anterior. Se as contas fictícias forem novas, coloque os IDs delas em `accounts` e repita o `setup`, ou publique um cenário novo e selecione as contas fictícias quando o terminal perguntar.
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
- As contas, os dados e a capacidade de upload são compartilhados entre todos os visitantes. Use sessões independentes para quem escreve e para quem lê.
- Cada ambiente aceita arquivos novos de até 20 MiB e 256 MiB de uploads no total, compartilhados entre visitantes. As mídias da semente não contam.
- Um novo boot descarta alterações e uploads, restaura a semente e troca as senhas.
- Cadastro público e integrações externas de escrita ficam desligados.
- A exclusão começa após dez minutos sem interação reconhecida. A página de espera, inclusive o polling de status, e a leitura de credenciais não renovam o prazo. Disponibilidade e franquias das plataformas limitam essa proteção.
- O link é imutável, mas o ambiente não é permanente. Uma revisão nova gera outro link, que você atualiza no PR à mão.
- O ambiente só sobe enquanto a sua infraestrutura e as cotas gratuitas continuarem existindo. Um print opcional do "depois" serve como registro durável; ele acompanha o link e nunca o substitui.

**Se der errado:** `O GitHub recusou a criação.` na página pede para esperar dez minutos e tentar de novo, sem mudar máquina ou plano. Se o ambiente não iniciar, veja o [diagnóstico](../diagnostics/README.md).

## 10. Erros comuns e o que fazer

**Quando usar:** o CLI recusou o comando antes de qualquer efeito.

**Comandos:** conforme o erro, abaixo.

**O que esperar:** depois da correção, o mesmo comando segue normalmente.

**Se der errado:**

| Mensagem | O que fazer |
| --- | --- |
| `<aplicação> has staged, unstaged or untracked source changes; commit or resolve them before publishing. No service was stopped.` | Comite ou descarte as mudanças nessa aplicação. A ferramenta não comita por você. |
| `The verified installation belongs to another public commit; install the configured commit with install-tool before publishing or resuming.` | O `toolCommit` da configuração é diferente da instalação em uso. Instale esse commit (receita 1). |
| `Tool is not a verified installation of a public commit; install the configured commit with install-tool before publishing or resuming.` | A instalação foi alterada (por exemplo, alguém rodou `npm run` dentro dela) ou o comando veio de um checkout de desenvolvimento. Instale o commit de novo em outro prefixo ou use a instalação correta. |
| `Private launcher tool pin differs from the executor. Complete its reviewed TypeScript installation before publication or resume.` | O `tool.lock.json` do lançador fixa outro commit. Alinhe o lançador com o `toolCommit`. |
| `Initial Free plan verification required. Run enois-preview setup --config PRIVATE_JSON in an interactive local terminal.` | Rode o `setup` num terminal interativo e confirme os planos gratuitos. |
| `Unsupported record format. Expected enois-preview-ts-v1.` | O arquivo é de uma versão antiga. Preserve os arquivos antigos e crie uma instalação nova com `--home NOVO_DIRETORIO`. |
| `Unrecognized authentication or integration column: <TABELA>.<COLUNA>; extend the reviewed sanitizer before capture`, gravada em `<state>/tools/sanitize.log`. No terminal aparece `Capture incomplete; backend restored to its prior state. java failed (exit 1)…`. | O banco tem uma coluna com cara de credencial que esta versão da ferramenta ainda não conhece. A captura parou sem promover dados, e o backend voltou ao estado anterior. É preciso uma versão da ferramenta que reconheça essa coluna (receita 1). |
| `Stage localImage incomplete: docker failed (exit 1); …`, com `cannot be applied to given types` no `build.log` da operação. | O backend é anterior ao suportado por esta versão da ferramenta, que só compila backends com o commit `1a3f9964` (#492). Nada remoto foi alterado. Use um backend do `qa` atual ou a versão anterior da ferramenta (receita 1). |
| Node fora de `>=24 <25` | A ferramenta não verifica a versão do Node e não tem mensagem própria para isso. Confira com `node --version` e use `nvm install` e `nvm use`, que leem o `.nvmrc`. |
