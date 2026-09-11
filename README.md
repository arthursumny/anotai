# Anota Aí

Piloto SaaS de governança de reuniões para PMEs. Reúne planejamento, pauta, participantes, gravação/upload, processamento, revisão de atas, decisões, tarefas, aceite simples e continuidade entre reuniões.

## Executar localmente

Requisitos: Node.js 22.13+ e npm. O projeto usa o runtime local de Cloudflare Workers, D1 e R2.

```bash
npm ci
cp .env.example .env
npm run db:migrate:local
npm run dev
```

Abra o endereço exibido pelo servidor (normalmente `http://localhost:3000`). Em `.env`, `APP_URL` deve corresponder a esse endereço. O modo local é explícito: `APP_MODE=test`, válido somente quando `import.meta.env.DEV` também é verdadeiro.

1. Escolha **Criar conta** e informe nome e e-mail. Depois, use **Entrar** com apenas o e-mail. Use um endereço fictício terminado em `@example.test` para experimentar.
2. Abra o link local exibido e confirme o acesso. Nenhum e-mail é enviado nesse modo.
3. Cadastre sua empresa. Em **Equipe e participantes**, adicione internos ou externos com setor e responsabilidades. Use **Convidar para acessar** para enviar o convite de entrada aos internos.
4. Crie uma reunião, prepare a pauta e envie os convites de teste.
5. Em **Gravação e presença**, confira os presentes e ausentes, confirme a lista e cole o conteúdo da reunião para preparar um rascunho. O serviço local copia o texto para revisão manual; **não simula extração por IA**.
6. Confira o resultado, incorpore ao rascunho e adicione/revise decisões e tarefas. Salve e finalize.
7. Envie a ata para aceite. Em **Histórico**, obtenha o link do e-mail de teste e registre uma manifestação na página externa.
8. Acompanhe tarefas em **Pendências e decisões** e selecione uma pendência ao preparar outra reunião.

O upload e o armazenamento de áudio são reais no R2 local; a transcrição real de áudio exige os serviços de produção. Na gravação pelo navegador, partes concluídas são enviadas durante a reunião. O trecho em captura e partes ainda pendentes continuam locais; não feche a página antes de concluir os envios.

A gravação pelo navegador usa partes independentes de aproximadamente cinco minutos, mantendo uma única reunião e uma única ata. Não encerra ao somar 20 MB nem aos 60 minutos. Cada parte aceita até 20 MB, com teto operacional de 1.000 partes; não se anuncia duração ilimitada. O envio de um arquivo pronto continua limitado a 20 MB. Ao iniciar a sessão, a preparação é encerrada explicitamente. Encerre a captura e conclua a gravação antes de conferir presença e gerar a ata. Partes transcritas são preservadas nas novas tentativas. A retomada após fechar a página permite concluir com as partes já armazenadas; não recupera o trecho ainda não enviado.

## Conhecimento da empresa

Em **Organização → Conhecimento da empresa**, administradores cadastram atas anteriores, projetos, processos e informações do negócio. Equipe, setor e responsabilidades são cadastrados diretamente em **Equipe e participantes**. É possível escrever/colar texto ou anexar PDF com texto, TXT e Markdown (até 5 MB, 100 páginas de PDF e 100 mil caracteres extraídos). Não há OCR nem importação DOCX nesta entrega. O original fica privado no R2. O conteúdo entra como rascunho, precisa de revisão e confirmação explícita para ficar disponível a todos os membros da organização e à IA. Não publique documentos restritos a uma reunião nessa área compartilhada.

O conhecimento revisado aparece com referências no chat e pode orientar pautas e o contexto da ata. Atas importadas não criam reuniões, decisões, tarefas ou aceites automaticamente. Equipe/cargos ajudam a contextualizar nomes, sem atribuir tarefas pelo cargo. Arquivar ou alterar um documento invalida respostas e propostas dependentes da revisão anterior. O cadastro de participantes continua definindo identidades e permissões.

## Testar

```bash
npm run typecheck
npm run lint
npm test
# Com o servidor local e APP_MODE=test:
npm run test:integration
npm run build
```

Os testes de integração criam organizações isoladas com dados fictícios. Recusam execução se o servidor não confirmar o modo local de teste. Não enviam e-mails ou áudio a serviços externos. Consulte [a matriz de validação](docs/validation.md).

## Configuração do piloto real

OpenAI, Resend e Inngest já estão configurados no Site existente e seu funcionamento foi confirmado pelo usuário. A tabela abaixo é uma referência de configuração para manutenção e novos ambientes; não indica pendências de implementação. Preserve os valores existentes e mantenha segredos fora do navegador e do repositório.

| Variável                     | Uso                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_MODE`                   | `production` no ambiente hospedado. Teste também é bloqueado pela compilação de produção.                                                                                                         |
| `APP_URL`                    | Origem HTTPS da aplicação, sem barra final. Deve ser alcançável pelos usuários e pelo Inngest.                                                                                                    |
| `APP_ENCRYPTION_KEY`         | Chave de 32 bytes em hexadecimal para proteger corpos de e-mail pendentes. Pode ser gerada com `openssl rand -hex 32`. Não trocar enquanto existirem envios pendentes sem uma migração de chaves. |
| `OPENAI_API_KEY`             | Chave da API OpenAI com acesso aos modelos escolhidos.                                                                                                                                            |
| `OPENAI_TRANSCRIPTION_MODEL` | Padrão `gpt-transcribe`.                                                                                                                                                                          |
| `OPENAI_TEXT_MODEL`          | Padrão `gpt-4.1-mini`.                                                                                                                                                                            |
| `RESEND_API_KEY`             | Chave para envio transacional.                                                                                                                                                                    |
| `MAIL_FROM`                  | Remetente autorizado em um domínio verificado no Resend.                                                                                                                                          |
| `INNGEST_EVENT_KEY`          | Publicação de eventos de processamento e e-mail.                                                                                                                                                  |
| `INNGEST_SIGNING_KEY`        | Verificação das chamadas de execução.                                                                                                                                                             |

Configure o aplicativo no Inngest usando `https://SEU-ENDERECO/api/inngest`. As funções processam transcrição e ata em etapas, enviam e-mails e recuperam a caixa de saída a cada cinco minutos. O Inngest precisa alcançar esse endpoint; um bloqueio de acesso privado do Sites impede o piloto externo. Para acesso próprio por e-mail, a entrada da hospedagem deve ser pública, mantendo a autorização da aplicação ativa em todas as rotas empresariais.

Sites fornece os bindings `DB` (D1) e `FILES` (R2). O identificador da aplicação está em `.openai/hosting.json`; reutilize-o. Use o fluxo Sites para publicar a versão exata validada e aplicar suas migrações. Nenhuma credencial de OpenAI, Resend ou Inngest acompanha o projeto. Sem configuração real, a aplicação não anuncia geração ou envio como bem-sucedidos.

## Produto e arquitetura

- [Domínio, fluxos e arquitetura](docs/architecture.md)
- [Contrato das rotas](docs/api.md)
- [Validação e limites](docs/validation.md)

## Assistente de reuniões

A conversa ocupa a área principal, com mensagens acima do campo de escrita e histórico privado na lateral. Use **Nova conversa** para começar outra; **Enter** envia e **Shift+Enter** insere uma linha. A mensagem aparece imediatamente enquanto a resposta é preparada. Fontes e trechos ficam disponíveis em uma seção expansível de cada resposta.

Abra **Assistente de reuniões** no menu. Faça perguntas em linguagem natural sobre pendências, decisões, responsáveis, assuntos recorrentes e projetos. O assistente também pode sugerir uma pauta e encaminhar a preparação de uma apresentação. Não há filtros visíveis: assunto, período, responsável e situação são inferidos quando aparecem na mensagem.

As conversas são persistidas por usuário e organização. As fontes são autorizadas antes da recuperação e verificadas novamente ao ler respostas antigas; perder acesso a uma reunião oculta respostas derivadas dela. Respostas novas trazem uma síntese curta e referências com trechos literais; o servidor rejeita citações inexistentes. Falhas preservam a pergunta e permitem retomada. A busca relacional normaliza acentos e prioriza conteúdo confirmado; não usa índice vetorial. Uma consulta com poucas evidências não é apresentada como conclusão sobre todo o histórico.

Exemplos: “O que ficou pendente da última reunião?”, “Quais decisões foram tomadas sobre a proposta comercial?”, “Quem ficou responsável por enviar a proposta?”, “Quais assuntos deveriam entrar na próxima reunião?”, “Resuma tudo que já foi discutido sobre o projeto Órbita”, “Crie uma pauta para a reunião comercial da próxima semana” e “Gere uma apresentação para essa pauta”.

As migrações incrementais `0001`–`0006` preservam os dados existentes e acrescentam chat, propostas, materiais, gravações em partes, conhecimento da empresa e índices. Rode `npm run db:migrate:local` antes de testar localmente. O modo local identifica a recuperação direta de trechos e não simula resposta de IA.

A Etapa 2 acrescenta propostas editáveis de pauta com origens. No chat, peça “Crie uma pauta para a reunião comercial da próxima semana”; revise e abra a proposta em uma nova reunião. A criação, data e participantes continuam manuais. Um pedido de apresentação retorna um cartão que encaminha para a reunião ou para a preparação da pauta; a geração só acontece depois da revisão explícita da pauta. O HTML fica armazenado de forma privada e vinculado à revisão da reunião. Você pode visualizar, baixar para uso offline ou abrir e imprimir em PDF pelo navegador. As fontes continuam sujeitas às permissões, inclusive para quem participa da reunião de destino. Assinatura certificada, cobrança, calendário externo e identificação de pessoas pela voz permanecem fora do escopo.

### Etapas da reunião

O fluxo assistido é **conversa → reunião confirmada → pauta revisada → slides opcionais → apresentação com gravação → ata**. Peça “Crie uma reunião comercial para a próxima semana” no assistente. A proposta abre o formulário com objetivo e assunto; título, data e participantes precisam ser conferidos, e os itens sugeridos são incorporados por seleção. Só **Confirmar e criar reunião** salva o encontro. Depois, revise e salve a pauta; confirme sua revisão para gerar os slides opcionais.

Em **Gravação e presença**, escolha uma apresentação salva ou conduza sem slides. O modo de tela cheia mantém os controles de gravação; trocar slides não reinicia o microfone. Encerre a captura e conclua o envio das partes antes de trocar de etapa. Confira a presença e solicite a ata pelo processamento existente. A revisão humana e o aceite simples continuam obrigatoriamente separados da apresentação.

A preparação é encerrada ao armazenar o primeiro áudio ou enviar o conteúdo. Só é permitido um áudio armazenado e um processamento por reunião. Depois do envio, preparação e presença ficam disponíveis apenas para consulta; falhas são retomadas no mesmo processamento. A ata é editável após incorporar o resultado. Revisões são permitidas somente antes do primeiro envio para aceite, preservando decisões e tarefas. Após o envio, a ata fica bloqueada para novas revisões; uma ata totalmente aceita não pode ser enviada novamente. Reuniões antigas mantêm seus registros e versões.

## Conta, empresa e convites de acesso

A entrada separa **Entrar** e **Criar conta**. O administrador confirma seu e-mail, cadastra a empresa e segue para **Equipe e participantes**. Um interno adicionado pelo administrador pode solicitar seu primeiro link apenas com o e-mail, mesmo antes de ter uma conta. O botão **Convidar para acessar** envia um link individual de uso único, válido por sete dias, que abre diretamente a empresa do convite. Contas existentes são reutilizadas; o convidado não precisa cadastrar outra empresa.

Internos podem criar suas próprias reuniões e atas, respeitando as permissões das demais reuniões. Externos ficam no cadastro de participantes e recebem convites e links de aceite, sem login e sem vínculo de acesso à organização. Se esse e-mail criar uma conta independente, isso não dá acesso à empresa que o cadastrou como externo. Converter um interno em externo remove seu vínculo e invalida convites de acesso pendentes.

Setor e responsabilidades são dados do participante. No processamento, a IA recebe somente os perfis selecionados para aquela reunião e a presença conferida. Perfis relevantes também podem fundamentar sugestões de pauta e respostas do assistente, com referências. Cargo não equivale a tarefa atribuída nem presença equivale a identificação de voz. Alterar o perfil invalida respostas e propostas que dependiam da revisão anterior.

O campo separado de contexto do negócio saiu do cadastro e da tela da organização. Informações antigas continuam consultáveis dentro de Conhecimento da empresa; documentos antigos de equipe também são preservados. Clientes antigos continuam compatíveis. **Cobrança, assinatura e teste de cinco dias foram adiados por decisão do usuário**: serão definidos pelo meio de pagamento escolhido, sem contagem ou bloqueio nesta versão.
