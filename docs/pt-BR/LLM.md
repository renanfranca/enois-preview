# Guia para assistência por LLM

Este guia descreve o fluxo do operador; ele não garante compatibilidade universal com qualquer LLM. Leia o README, o tutorial e VALIDATION.md antes de afirmar que a implementação ou uma revisão está aceita.

Trabalhe no terminal local. Não peça ao operador que cole tokens, senhas, cookies ou arquivos privados na conversa. Para autenticação ou confirmação financeira inicial, oriente a interação diretamente no terminal ou na interface oficial da plataforma. Não renove a conferência financeira em publish, resume ou após passagem de tempo.

Use exatamente os comandos públicos: `enois-preview setup`, `enois-preview publish <cenario>`, `enois-preview publish <cenario> --refresh-data` e `enois-preview resume <revisao>`. “Publicar de novo” significa publish sem refresh. Não substitua esses comandos por uma sequência manual de Docker, Git, GHCR e Wrangler.

Antes de publicar, confira que as três aplicações têm commits e fontes limpas. Não comite mudanças do operador automaticamente. O CLI exporta os commits e prepara a demo fora das aplicações. Preserve arquivos privados e o journal. Se houver captura incompleta, informe o estado da restauração e a ação de repetição; resume nunca deve recapturar dados sob uma identidade antiga.

Diferencie os terminais: instalação, autenticação, preparação, publish e resume ocorrem localmente. O Codespace deve iniciar automaticamente. Uma necessidade de abrir seu terminal e copiar arquivos ou iniciar processos é uma falha de boot, não uma etapa normal.

Só apresente um link como validado se o CLI terminar com status zero e relatório de saúde pública, identidades, mídia e revisão correspondentes. Relate falhas e lacunas. Nunca publique o projeto público enquanto os pré-requisitos de aceite estiverem pendentes. O link imutável não promete disponibilidade permanente, e os visitantes compartilham estado e contas. Oriente o operador a atualizar o link no PR e testar a funcionalidade específica; não edite o PR automaticamente.

A cadeia própria é TypeScript: use Node 24.x (`>=24 <25`) e compile com `npm run build` após `npm ci --ignore-scripts`. O consumidor privado também compila a dependência explicitamente e usa `launcher.ts`. Não execute Python, não converta formatos históricos e não tente retomar seus journals. Registros novos exigem `format: "enois-preview-ts-v1"`; preserve os antigos e crie outra instalação.

Em Linux, cada comando gerenciado usa seu próprio grupo de processos. O timeout encerra esse grupo com SIGKILL, incluindo descendentes que permaneceram nele; serviços iniciados intencionalmente em grupos independentes continuam ativos. Não procure processos por nome para encerrar. Preserve os registros anteriores a 0.3.0 sem afirmar que suas retomadas foram validadas.

Na versão 0.3.1, `Ctrl+C` (`SIGINT`) e `SIGTERM` cancelam comandos ativos e impedem novas etapas. O primeiro sinal determina a saída: `130` ou `143`, respectivamente. Aguarde a restauração do backend; sinais adicionais não a interrompem. Se ela falhar dentro dos prazos existentes, preserve `restoration.json`: a próxima execução de publicação ou retomada tenta a recuperação antes de avaliar fontes. Uma captura incompleta mantém os dados completos anteriores. Após congelar uma revisão, use o identificador informado com `enois-preview resume <revisao-completa>`; um push ou deploy aceito pode precisar de reconciliação, pois cancelar a espera local não desfaz o efeito remoto. Não remova leases de outra operação. `SIGKILL` depende da recuperação durável na próxima execução.
