# Histórico de versões

[English](docs/en/CHANGELOG.md) · [README](README.md)

Este arquivo registra o que mudou em cada versão, da mais nova para a mais antiga. Os guias ([README](README.md), [tutorial](docs/pt-BR/TUTORIAL.md), [receitas](docs/pt-BR/RECIPES.md)) descrevem só o comportamento atual. As evidências de cada versão estão em [VALIDATION.md](VALIDATION.md).

## 0.3.7 (2026-11-11)

- O adaptador de serviço do exemplo (`service.js`) não responde mais `Backend ownership mismatch` para um backend que está terminando. `status` e `start` passam a tratar esse processo como parado, e a captura deixa de falhar nesse intervalo.
- Mensagens, códigos de saída e formato do pidfile continuam iguais.

## 0.3.6 (2026-11-10)

- Um `stop` que ficou órfão (porque o CLI foi morto) espera só o backend que ele mesmo sinalizou. Ele não espera mais um backend novo iniciado depois nem apaga o pidfile desse backend novo.

## 0.3.5 (2026-11-10)

- Sem mudança de comportamento para o operador. O código de produção é igual ao da 0.3.4.
- `npm run test:capture` passa a provar, com Spring e H2 reais, que um segundo CLI conclui a parada aceita por um CLI interrompido antes de confiar na prontidão do backend.

## 0.3.4 (2026-11-10)

- Novo comando `enois-preview source-digest`. Ele só lê: com o backend de origem parado e liberado, copia o banco H2 para um diretório privado e imprime em JSON `databaseSha256`, `logicalSha256` (o `SCRIPT` do H2 sem as linhas `CREATE USER`, com sha256) e as contagens por tabela. Veja [a receita](docs/pt-BR/RECIPES.md#7-conferir-se-o-banco-mudou).
- Os pontos de entrada do runtime, da receita e do exemplo passam a funcionar também pelo link `current`, como os do CLI já funcionavam na 0.3.3.

## 0.3.3 (2026-11-10)

- O `service.js` instalado e os scripts funcionam quando chamados pelo link `~/.local/share/enois-preview/current`. Na 0.3.2, por esse caminho, eles não faziam nada e saíam com código 0.
- Use 0.3.3 ou mais nova no lugar da 0.3.2.

## 0.3.2 (2026-11-09)

- A tag existe, mas a versão não foi lançada: o `service.js` instalado não funcionava pelo link `current`. Use 0.3.3.
- Novo instalador `node dist/scripts/install-tool.js --commit <SHA>`. Ele baixa o commit público só de `codeload.github.com`, compila fora dos seus checkouts e grava os hashes da fonte e do `dist` em `install.json`. `publish` e `resume` recusam uma instalação diferente desse registro.
- Um checkout de desenvolvimento deixa de publicar. Revisões congeladas pela 0.3.1 ou anteriores só são retomadas pelo executor original: um checkout limpo no commit delas, compilado com `npm run build`.
- Quando um CLI morre durante uma parada aceita do backend, o próximo CLI espera essa parada terminar antes de confiar na prontidão.

## 0.3.1 (2026-11-07)

- `Ctrl+C` (`SIGINT`) e `SIGTERM` cancelam comandos ativos e impedem novas etapas. O primeiro sinal define a saída: `130` ou `143`.
- A restauração do backend não é interrompida por sinais adicionais. Se ela falhar, `restoration.json` fica guardado e a próxima execução de `publish` ou `resume` tenta a recuperação antes de olhar as fontes.
- Um push ou deploy já aceito pode precisar de reconciliação por `resume`, porque cancelar a espera local não desfaz o efeito remoto.

## 0.3.0 (2026-11-07)

- Node 24.x (`>=24 <25`) passa a ser a versão qualificada; `.nvmrc` seleciona a família 24. Node 22 deixa de ser qualificado.
- O timeout de um comando gerenciado encerra todo o grupo de processos dele com `SIGKILL`, incluindo descendentes que ficaram no grupo.
- Catálogos, links e registros anteriores são preservados. A retomada de operações criadas antes dessa atualização exige o executor original e não foi validada.
- O build do lançador executa `npm rebuild --ignore-scripts enois-preview` depois da compilação para criar o atalho npm do CLI. Os scripts de instalação continuam desativados.

## 0.2.0 (2026-11-07)

- Migração da automação para TypeScript estrito e ESM. Python deixa de ser requisito.
- Configuração, dados, journals, proveniência e catálogo usam `format: "enois-preview-ts-v1"`. Registros antigos com `schema` ou sem esse `format` são recusados antes de qualquer alteração; crie uma instalação e um catálogo novos.
- A instalação padrão fica em `~/.config/enois-preview-ts`.

### Execução observada da versão 0.2.0

Em 7 de novembro de 2026, o tutorial foi executado na infraestrutura existente com a ferramenta fixada em `a95d9862bea0b5076b311600d6f0ebec939cfbd5`, sem alterar planos ou segredos. As revisões são temporárias e iniciam outro ambiente automaticamente após a exclusão por inatividade.

| Etapa | Revisão pública verificada | Dados |
| --- | --- | --- |
| Primeira publicação e retomada | [34fab05937743573](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-pt-34fab05937743573) | D1 |
| Código atualizado | [a787a8b14663c307](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-pt-a787a8b14663c307) | Mesma D1, H2 e mídias locais indisponíveis durante o comando |
| Refresh explícito | [6c1183df4fe6acca](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-pt-6c1183df4fe6acca) | D2, mesmos commits da etapa anterior |

A retomada preservou a revisão enquanto os três repositórios fictícios e os dados locais estavam indisponíveis. O caso começou com uma falha local de JVM registrada no aceite; a causa permanece desconhecida. [Recibos e limites](VALIDATION.md) incluem verificações públicas independentes dos marcadores de código e dados, imagens em desktop e emulação móvel e restauração após inatividade.
