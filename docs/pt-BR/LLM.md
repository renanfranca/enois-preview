# Guia para assistência por LLM

[English](../en/LLM.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Receitas](RECIPES.md)

Este guia descreve como um assistente deve ajudar o operador; ele não garante compatibilidade universal com qualquer LLM. Leia o [README](../../README.md), os [conceitos](CONCEPTS.md), o [tutorial](TUTORIAL.md), as [receitas](RECIPES.md) e o [VALIDATION.md](../../VALIDATION.md) antes de afirmar que a implementação ou uma revisão está aceita.

## Como orientar

- Use exatamente os comandos públicos: `enois-preview setup`, `enois-preview publish <cenario>`, `enois-preview publish <cenario> --refresh-data`, `enois-preview resume <revisao>` e `enois-preview source-digest` (que só lê). “Publicar de novo” significa `publish` sem refresh.
- Para cada situação, siga a receita correspondente em [Receitas](RECIPES.md) e copie a mensagem de erro real do CLI ao procurar a causa.
- Instalação, autenticação, preparação, `publish` e `resume` acontecem no terminal local. O Codespace deve iniciar sozinho; precisar abrir o terminal dele para copiar arquivos ou iniciar processos é uma falha de boot, não uma etapa normal.
- Só apresente um link como validado se o CLI terminar com status zero e um relatório com saúde pública, identidades, mídia e revisão correspondentes. Relate falhas e lacunas.
- Oriente o operador a atualizar o link no pull request (PR) e a testar a funcionalidade específica. O link imutável não promete disponibilidade permanente, e os visitantes compartilham estado e contas.
- Numa captura incompleta, informe o estado da restauração e a ação de repetição. Numa interrupção, siga a [receita de Ctrl+C e SIGTERM](RECIPES.md#6-ctrlc-sigterm-ou-processo-morto): espere a restauração, preserve `restoration.json` e use `resume` para uma revisão já congelada.

## Proibições

- Não peça ao operador que cole tokens, senhas, cookies ou arquivos privados na conversa. Autenticação e confirmação financeira inicial acontecem diretamente no terminal ou na interface oficial da plataforma.
- Não renove a conferência financeira em `publish`, `resume` ou porque o tempo passou.
- Não substitua os comandos públicos por uma sequência manual de Docker, Git, GHCR e Wrangler.
- Não comite automaticamente as mudanças do operador. Antes de publicar, confira que as três aplicações têm commits e fontes limpas; o CLI exporta os commits e prepara a demo fora das aplicações.
- Não apague arquivos privados, journals, `restoration.json` nem leases de outra operação.
- `resume` nunca deve recapturar dados sob uma identidade antiga.
- Não edite o PR automaticamente.
- Nunca publique o projeto público enquanto os pré-requisitos de aceite estiverem pendentes.
- Não execute Python, não converta formatos históricos e não tente retomar journals Python. Registros novos exigem `format: "enois-preview-ts-v1"`; preserve os antigos e crie outra instalação.
- Não procure processos por nome para encerrá-los. Em Linux, cada comando gerenciado usa seu próprio grupo de processos, e o timeout encerra esse grupo com `SIGKILL`, incluindo descendentes que permaneceram nele; serviços iniciados de propósito em grupos independentes continuam ativos.
- Preserve os registros anteriores a 0.3.0 sem afirmar que suas retomadas foram validadas.

## Cadeia de ferramentas

A cadeia própria é TypeScript: use Node 24.x (`>=24 <25`) e compile com `npm run build` após `npm ci --ignore-scripts`. Publicação e retomada usam só a instalação verificada criada por `install-tool` (veja [`toolCommit` e `install.json`](CONCEPTS.md#toolcommit-e-installjson)). O lançador privado também compila a dependência explicitamente e usa `launcher.ts`.
