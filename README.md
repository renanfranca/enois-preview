# enois-preview

Ferramenta específica ao Énóis para publicar revisões imutáveis de desenvolvimento e teste por um Worker HTTPS e Codespaces privados. A publicação só informa sucesso após as verificações públicas. Consulte o resultado individual dos critérios em [VALIDATION.md](VALIDATION.md) antes de considerar uma revisão pronta para compartilhar.

[English](docs/en/README.md) · [Tutorial](docs/pt-BR/TUTORIAL.md) · [Guia para LLM](docs/pt-BR/LLM.md) · [Diagnóstico](docs/diagnostics/README.md)

```sh
npm ci
npx playwright install chromium
npm link
npm run example:prepare -- /caminho/novo/workspace-ficticio
enois-preview setup --config /caminho/novo/workspace-ficticio/.preview/config.json
enois-preview publish meu-cenario
enois-preview publish meu-cenario --refresh-data
enois-preview resume <revisao-completa>
```

A preparação do exemplo cria cópias isoladas dos três projetos públicos nos commits de [example/sources.json](example/sources.json). Ela não usa o catálogo operacional, H2 ou imagens privadas. As quatro personagens são fictícias; os retratos são ilustrações vetoriais originais. A semente contém oito posts, três com imagens, seis comentários, duas respostas e oito reações. Lia e Rui são as contas selecionadas; as senhas são criadas no boot e aparecem somente na entrada do ambiente. Maya e Davi preservam perfil e conteúdo, com login desabilitado.

Configure suas próprias contas e infraestrutura privada antes de executar `setup`. A instalação usa Linux e precisa de Node 22.12 ou posterior, Python 3.10 ou posterior, Git, Java 25/Javac, Docker, `fuser`, GitHub CLI e autenticação Cloudflare. O driver H2 deve corresponder ao banco configurado. A receita fornece `ffmpeg` e o modelo local de classificação de imagens na imagem, sem serviço externo de escrita de mídia.

O primeiro `publish` captura dados após fechar somente o backend identificado. Publicações seguintes usam os commits atuais e os dados congelados, sem ler ou parar o banco local. `--refresh-data` solicita outra captura; uma falha preserva a versão completa anterior. As fontes são exportadas por commit e o pacote do design system é construído novamente. A ferramenta não comita nem altera as três aplicações.

Os visitantes compartilham contas, dados e capacidade: 20 MiB por arquivo novo e 256 MiB por ambiente. As mídias da semente não gastam essa capacidade. O boot restaura a semente e gera novas senhas; alterações e uploads são descartáveis. Dez minutos sem interação reconhecida iniciam a exclusão. Polling não renova o prazo. Disponibilidade e franquias das plataformas limitam essa proteção; um link imutável não garante um ambiente permanentemente ativo.

A conferência de planos gratuitos e bloqueio de gastos ocorre somente na instalação. Publicar, retomar e abrir links não exigem renovação. A ferramenta não solicita cartão, contrata recursos nem ativa planos pagos. A confirmação humana não audita faturamento por API. Consulte [a cobrança do Codespaces](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) e [os limites gratuitos de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Este é um uso temporário associado ao desenvolvimento e teste do projeto. Os [termos do Codespaces](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restringem uso desproporcional como servidor e hospedagem de aplicações de produção. O funcionamento técnico não demonstra aprovação desta arquitetura pelo GitHub.

Código sob [GPLv3](LICENSE), preservando os avisos dos projetos consumidos. Dados locais e credenciais devem permanecer fora do repositório público. Sanitizar autenticação não anonimiza o conteúdo escolhido pelo operador.
