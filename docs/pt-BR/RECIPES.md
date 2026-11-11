# Receitas

[English](../en/RECIPES.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Fluxo](FLOW.md) · [Tutorial](TUTORIAL.md)

Cada receita tem o mesmo formato: **Quando usar**, **Comandos**, **O que esperar** e **Se der errado**. Rode tudo no seu terminal local, nunca dentro de um Codespace. Quando o CLI falha, a mensagem começa com `Publication incomplete:` (ou `Source digest incomplete:` no `source-digest`) seguida do motivo; procure o motivo nesta página.

## 1. Instalar ou trocar a ferramenta para outro commit fixado

**Quando usar:** na primeira instalação ou quando o lançador passar a fixar outro commit público em `tool.lock.json`.

**Comandos:**

```sh
git clone https://github.com/renanfranca/enois-preview.git /caminho/temporario/enois-preview
cd /caminho/temporario/enois-preview
git checkout --detach <COMMIT_PUBLICO_FIXADO>
npm ci --ignore-scripts
npm run build
node dist/scripts/install-tool.js --commit <COMMIT_PUBLICO_FIXADO>
cd ~/.local/share/enois-preview/current
npx --no-install playwright install chromium
```

Para trocar de commit, instale o novo commit do mesmo jeito, coloque o mesmo SHA em `toolCommit` no seu arquivo de configuração privado e repita `enois-preview setup --config <arquivo>`. O lançador também precisa fixar esse commit em `tool.lock.json` e na dependência `enois-preview` do `package.json`; veja o [diagnóstico de instalação](../diagnostics/installation.pt-BR.md).

**O que esperar:** o instalador imprime um JSON com `commit`, `installation` (`~/.local/share/enois-preview/<COMMIT>`), `current`, `stamp` (o `install.json`) e `linked: true`. O comando `enois-preview` passa a apontar para essa instalação.

Atenção:
- A instalação é imutável. Não rode `npm run` nem edite arquivos dentro dela: isso recompila o `dist` e o `publish` passa a recusar a instalação.
- Um checkout de desenvolvimento não publica, nem limpo no mesmo commit.
- Autentique com `gh auth login` e o mecanismo de credenciais do Docker. Nunca coloque tokens em argumentos, no chat ou em arquivos versionados.

**Se der errado:**
- `is already installed at ...; installations are immutable.`: esse commit já está instalado. O instalador não sobrescreve nem troca o `current` nesse caso.
- `Download of ... failed (HTTP ...)`: confira se o SHA completo existe no repositório público.
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
- Se `accounts` ficar vazio, o primeiro `publish` lista as identidades do banco capturado e pergunta no terminal quais IDs usar.

**Se der errado:** `Backend service ownership mismatch; configure its identity and database.` indica que `identity` não imprimiu `expectedIdentity`. `Configure service.<nome> as an argument array.` indica um comando ausente ou mal formado.

## 9. Compartilhar o link no PR

**Quando usar:** o `publish` ou `resume` terminou com `status: "validated"`.

**Comandos:** copie a `url` do JSON e cole no PR. Teste o comportamento específico do PR antes.

**O que esperar:** quem abre o link vê uma página de espera enquanto o Codespace sobe sozinho; ninguém precisa abrir o terminal dele. Depois, aparece a página com as contas e as senhas, geradas a cada boot.

Atenção:
- As contas, os dados e a capacidade de upload são compartilhados entre todos os visitantes. Use sessões independentes para autora e leitor.
- Cada ambiente aceita arquivos novos de até 20 MiB e 256 MiB de uploads no total, compartilhados entre visitantes. As mídias da semente não contam.
- Um novo boot descarta alterações e uploads, restaura a semente e troca as senhas.
- Cadastro público e integrações externas de escrita ficam desligados.
- A exclusão começa após dez minutos sem interação reconhecida. A página de espera, inclusive o polling de status, e a leitura de credenciais não renovam o prazo. Disponibilidade e franquias das plataformas limitam essa proteção.
- O link é imutável, mas o ambiente não é permanente. Uma revisão nova gera outro link, que você atualiza no PR à mão.

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
| Node fora de `>=24 <25` | A ferramenta não verifica a versão do Node e não tem mensagem própria para isso. Confira com `node --version` e use `nvm install` e `nvm use`, que leem o `.nvmrc`. |
