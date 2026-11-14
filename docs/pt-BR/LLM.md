# Guia para assistência por LLM

[English](../en/LLM.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Receitas](RECIPES.md)

Este guia descreve como um assistente deve ajudar o operador; ele não garante compatibilidade universal com qualquer LLM. Leia o [README](../../README.md), os [conceitos](CONCEPTS.md), o [tutorial](TUTORIAL.md), as [receitas](RECIPES.md) e o [VALIDATION.md](../../VALIDATION.md) antes de afirmar que a implementação ou uma revisão está aceita.

## Como orientar

- Use exatamente os comandos públicos: `enois-preview setup`, `enois-preview publish <cenario>`, `enois-preview publish <cenario> --refresh-data`, `enois-preview publish <cenario> --accounts ID[,ID...]`, `enois-preview resume <revisao>` e `enois-preview source-digest` (que só lê). O `--force-lease` no `publish` ou no `resume` apaga a lease remota de outra operação; sugira só quando o operador confirmar que essa operação morreu. “Publicar de novo” significa `publish` sem refresh.
- Para cada situação, siga a receita correspondente em [Receitas](RECIPES.md) e copie a mensagem de erro real do CLI ao procurar a causa.
- Instalação, autenticação, preparação, `publish` e `resume` acontecem no terminal local. O Codespace deve iniciar sozinho; precisar abrir o terminal dele para copiar arquivos ou iniciar processos é uma falha de boot, não uma etapa normal.
- Só apresente um link como validado se o CLI terminar com status zero e um relatório com prontidão pública, identidade da revisão e login de cada conta selecionada. Leia `warnings: [{code, message}]` no JSON final e relate cada aviso ao operador; um aviso nunca para o comando, mas pode importar para o PR. Relate falhas e lacunas.
- Oriente o operador a atualizar o link no pull request (PR) e a testar a funcionalidade específica. O link imutável não promete disponibilidade permanente, e os visitantes compartilham estado e contas.
- Numa captura incompleta, informe o motivo e a ação de repetição. Numa interrupção, siga a [receita de Ctrl+C e SIGTERM](RECIPES.md#6-ctrlc-sigterm-ou-processo-morto): use `resume` para uma revisão já congelada. A captura nunca para o backend do operador.

## Proibições

- Não peça ao operador que cole tokens, senhas, cookies ou arquivos privados na conversa. Autenticação acontece diretamente no terminal ou na interface oficial da plataforma.
- Não substitua os comandos públicos por uma sequência manual de Docker, Git, GHCR e Wrangler.
- Não comite automaticamente as mudanças do operador. Antes de publicar, lembre o operador de que só o `HEAD` comitado é publicado e de que o aviso `source-dirty` indica mudanças deixadas de fora; o CLI exporta os commits e prepara a demo fora das aplicações.
- Não apague à mão arquivos privados, journals nem leases de outra operação.
- `resume` nunca deve recapturar dados sob uma identidade antiga.
- Não edite o PR automaticamente.
- Não sugira raspar nem importar conteúdo de outras pessoas para reproduzir um problema. Recomende dados fictícios moldados no caso, como em [Mostrar no PR que o problema foi resolvido](RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido).
- Nunca publique o projeto público enquanto os pré-requisitos de aceite estiverem pendentes.
- Não execute Python, não converta formatos históricos e não tente retomar journals Python. Registros novos exigem `format: "enois-preview-ts-v1"`; preserve os antigos e crie outra instalação.
- Não procure processos por nome para encerrá-los. Em Linux, cada comando gerenciado usa seu próprio grupo de processos, e o timeout encerra esse grupo com `SIGKILL`, incluindo descendentes que permaneceram nele; serviços iniciados de propósito em grupos independentes continuam ativos.
- Preserve os registros anteriores a 0.3.0 sem afirmar que suas retomadas foram validadas.

## Cadeia de ferramentas

A cadeia própria é TypeScript: use Node 24.x (`>=24 <25`) e compile com `npm run build` após `npm ci --ignore-scripts`. Publicação e retomada registram se rodam de uma instalação verificada criada por `install-tool`; qualquer outra ferramenta roda com o aviso `unverified-tool` (veja [commit da ferramenta e `install.json`](CONCEPTS.md#commit-da-ferramenta-e-installjson)). O lançador privado também compila a dependência explicitamente e usa `launcher.ts`.
