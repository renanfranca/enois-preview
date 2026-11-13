# Avaliação do projeto em 13 de novembro de 2026

Avaliação de leitura, sem alteração de código, feita sobre `c1261c2` (branch `feat/one-command-install`). Os pontos estão em ordem de importância dentro de cada grupo. Nenhum deles foi decidido nem planejado: são candidatos.

Fora desta lista: os defeitos do `enois-preview install` (Ctrl+C ignorado e mensagem errada sem rede), que já têm plano em `.agent/execplans/install-interruption-and-network-errors.md`.

## Cobertura

Lidos por inteiro: `preview/capture.ts`, `preview/service.ts`, `preview/remote.ts`, `preview/validation.ts`, `preview/cli.ts`, `preview/installation.ts`, `scripts/install-tool.ts`, `install.sh`, `runtime/gateway.ts`, `runtime/start.ts`, `src/worker.ts`, `recipe/Dockerfile`, `wrangler.jsonc` e `package.json`.

Não lidos: `preview/publication.ts`, `preview/build.ts`, `preview/exercises.ts`, o restante de `src/scenario.ts` depois da linha 90, `src/github.ts`, o transporte de upload, o código Java e a maior parte dos testes e dos guias. Um ponto sobre essas áreas pode estar faltando aqui.

Medições usadas: `npm test` (120 de 120, 102 s), `npm run typecheck` (limpo), `npm audit` (0 vulnerabilidades), `npm outdated`, contagem de linhas longas com `awk`, e `du` em `~/.local/share/enois-preview`.

## Risco real

1. **Sem CI.** Não existe `.github/`. Os 120 testes unitários só rodam na máquina do mantenedor. As 13 suítes de integração (`test:image`, `test:capture`, `test:flows` e as demais em `package.json`) ficam fora do `npm test` e só rodam se alguém lembrar.
2. **O gateway bloqueia por lista de proibidos.** `demoBlocked` em `runtime/gateway.ts:11` nega rotas conhecidas (`oauth2`, `webhooks`, `integrations` e outras). Um endpoint sensível novo no backend nasce aberto no link público. O sanitizador faz o contrário: para a captura diante de uma coluna desconhecida.
3. **Imagens base sem digest.** `recipe/Dockerfile` usa `node:24-bookworm-slim` e `eclipse-temurin:25-jdk-noble` e `25-jre-noble` por tag, `apt-get install` sem versão, e `npm install --package-lock-only` no estágio do frontend. Duas publicações dos mesmos commits podem gerar imagens diferentes, o que enfraquece a promessa de revisão imutável. Só o modelo ONNX tem `--checksum`.
4. **Erros inesperados somem sem rastro.** Tudo que não é `PreviewError` vira texto genérico em `preview/cli.ts:123`, em `runtime/start.ts:67` e no `catch` de `src/worker.ts:63`. Não existe modo de depuração nem registro de stack, e o `wrangler.jsonc` vem com `observability` desligado. Foi assim que a falha de rede do `install` virou "private input".

## Manutenção

5. **Código difícil de ler e revisar.** No código de produção, 269 linhas passam de 200 caracteres, 86 passam de 300 e 14 passam de 500. A maior tem 861 (`preview/service.ts:71`). Não há formatador nem linter, e o estilo muda dentro do mesmo arquivo (trechos com espaços e trechos compactados).
6. **Arquivos com cara de colagem.** `preview/capture.ts:19` e `preview/validation.ts:51` têm blocos de `import` no meio do arquivo, depois de funções e classes.
7. **Validações repetidas.** A regex `^[a-f0-9]{40}$` aparece em 9 arquivos e `^[a-f0-9]{64}$` em 14 lugares. A checagem de origem HTTPS ou loopback está escrita três vezes: `preview/validation.ts:11`, `runtime/gateway.ts:23` e `runtime/start.ts:14`.
8. **Configuração meio tipada.** Existem os tipos `Config` e `CaptureConfig`, mas `preview/cli.ts` e `commits()` em `preview/capture.ts:5` circulam `Record<string, unknown>` com `string(config.x)`.
9. **Versão solta no código.** O User-Agent diz `enois-preview/0.3.1` em `preview/validation.ts:19`, e o pacote está em `0.3.8`.
10. **Acoplamento ao backend em linha.** As flags `--rede.*` que desligam integrações estão fixas em `preview/service.ts:71`. Uma integração nova no backend fica ligada até alguém lembrar de adicioná-la à lista.
11. **`miniflare` fixado numa versão beta.** `package.json` usa `5.20261023.3-beta`, e o `npm outdated` aponta a 4.x como a mais recente estável.

## Operação

12. **Instalações acumulam.** Havia 6 em `~/.local/share/enois-preview`, com 1,6 GB. Não existe comando para listar, remover ou voltar a um commit já instalado: o instalador recusa um commit existente e não troca o `current`.
13. **Cerimônia de release pesada.** Foram 8 versões (0.3.1 a 0.3.8) em uma semana. Cada troca exige reinstalar, refazer o pin no lançador (`tool.lock.json` e `package.json`) e repetir o `setup`. Leitura do histórico, não medição de tempo gasto.
14. **Scripts fora do CLI.** O exemplo (`example/prepare`), o lançador (`scripts/prepare-launcher`) e os 14 `scripts/validate-*` só rodam por `node ~/.local/share/enois-preview/current/dist/...`.
15. **Dois idiomas sem regra.** O CLI fala inglês e o Worker fala português, então as receitas precisam explicar cada mensagem ao operador.
16. **Documentação duplicada à mão.** README, changelog, tutorial, receitas, conceitos e fluxo existem em pt-BR e en. Não foi achado teste que confira a paridade entre os dois. O `VALIDATION.md` tem cerca de 14 mil palavras.
17. **Texto de versão ainda não lançada nos guias.** O changelog tem "0.3.9 (não publicada)" e os guias dizem "a partir da 0.3.9", com o `package.json` em `0.3.8`. O plano `login-domain-and-cancel-timeout.md` registra que o changelog lista só versões lançadas e que os guias não têm notas por versão.
18. **`enois-preview install` usa sempre o prefixo padrão.** Quem instalou com `--prefix` recebe a versão nova em `~/.local/share/enois-preview`.

## Menores

19. **`SeedTool.java` é recompilado a cada chamada** em `preview/capture.ts:89`, três ou quatro vezes por captura.
20. **Segredo comparado com `!==`** em `src/worker.ts:22`, e o limite de 16 KB do registro só olha o cabeçalho `Content-Length`.
21. **`externalRead` resolve o DNS e depois faz o `fetch` em separado** (`preview/validation.ts:149`), então a checagem de endereço público não vale para a conexão real.
22. **Suíte unitária lenta e densa.** Leva 102 segundos, e `test/publication-journey.test.ts` tem 54 KB em 602 linhas.
23. **Leituras síncronas por requisição no gateway.** `runtime/gateway.ts` lê `reset-worker-bundle.js` e `activity-bundle.js` do disco a cada pedido.

## Por onde começar

Sugestão de quem avaliou: 1, 2 e 4. O primeiro protege todo o resto, o segundo é o único que pode expor algo no link público, e o quarto encurta todo diagnóstico futuro.
