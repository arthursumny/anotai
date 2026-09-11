# Rotas HTTP

A API usa JSON. Mutações exigem `Origin` igual à origem da aplicação e sessão quando indicado. `x-organization-id` seleciona uma organização da qual o usuário é membro. Downloads aceitam o seletor `?org=ID`, com a mesma verificação de vínculo. Respostas empresariais usam `Cache-Control: no-store`.

Erros têm `{ "error": "mensagem" }`: 400 para entrada inválida, 401 para sessão ausente/expirada, 403 para permissão, 404 para recurso não visível, 409 para conflito, 410 para link expirado/consumido, 413 para tamanho, 415 para mídia, 429 para frequência e 503 para integração pendente. Limites do runtime podem retornar 413 em texto; o cliente trata esse caso.

| Método e rota                      | Contrato/efeito                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/me`                      | Identidade, organizações e disponibilidade das integrações. Sem sessão, retorna `user: null`.                        |
| `POST /api/auth/request`           | `{email,name?}`. Nome obrigatório apenas para cadastro sem conta ou vínculo interno prévio. Envia link de acesso. Retorna `localLink` exclusivamente no modo local de teste.                     |
| `POST /api/auth/verify`            | `{token}`. Consome link e cria cookie de sessão.                                                                     |
| `POST /api/auth/logout`            | Revoga a sessão e limpa o cookie.                                                                                    |
| `POST /api/organizations`          | `{name,business?,timezone?}`. Cria empresa e vínculo de administrador.                                                 |
| `PATCH /api/organization`          | `{name,business?}`. Administrador.                                                                                    |
| `GET, POST /api/participants`      | Lista/cria participante com `{name,email,kind,role,department?,responsibilities?}`. `kind`: `internal` ou `external`; `role`: `admin` ou `member`. |
| `PATCH /api/participants/:id`      | Atualiza nome, tipo, papel, setor e responsabilidades. E-mail identifica a pessoa e não pode ser trocado.           |
| `GET, POST /api/meetings`          | Lista reuniões visíveis ou cria uma reunião.                                                                         |
| `GET, PATCH /api/meetings/:id`     | Consulta o espaço completo ou atualiza preparação antes do primeiro áudio armazenado/envio de conteúdo.                                     |
| `PATCH /api/meetings/:id/presence` | `{participantId,present}`. Confirma presença manualmente.                                                            |
| `POST /api/meetings/:id/invite`    | Enfileira convites aos participantes atuais.                                                                         |
| `POST /api/meetings/:id/files`     | Multipart com `file`, até 20 MB. Retorna o identificador do arquivo.                                                 |
| `GET /api/files/:id`               | Lê o áudio após verificação de acesso à reunião.                                                                     |
| `POST /api/meetings/:id/process`   | `{requestKey,text,attendanceConfirmed:true}` ou `{requestKey,fileId,attendanceConfirmed:true}`. Retorna `{id,state}`. Nunca enviar as duas fontes simultaneamente.     |
| `GET /api/jobs/:id`                | Consulta etapa, estado, resultado e erro do processamento.                                                           |
| `POST /api/jobs/:id/retry`         | Retoma processamento que falhou, reutilizando checkpoints.                                                           |
| `POST /api/jobs/:id/apply`         | `{revision}`. Incorpora resultado ao rascunho explicitamente.                                                        |
| `PATCH /api/meetings/:id/draft`    | `{revision,draft}`. Salva revisão otimista.                                                                          |
| `POST /api/meetings/:id/finalize`  | `{revision}`. Cria versão imutável e confirma decisões/tarefas.                                                      |
| `POST /api/meetings/:id/revise`    | `{revision}`. Abre revisão com a última versão somente antes do primeiro envio para aceite.                                                     |
| `POST /api/meetings/:id/send`      | `{participantIds}`. Envia a versão finalizada para aceite. Todos os destinatários selecionados são obrigatórios.     |
| `POST /api/acceptances/:id/resend` | Renova um link pendente da versão atual.                                                                             |
| `GET /api/acceptance?token=...`    | Consulta externa limitada à versão e destinatário do link.                                                           |
| `POST /api/acceptance?token=...`   | `{status,comment}`. `accepted` ou `changes_requested`; comentário obrigatório ao pedir ajustes.                      |
| `GET /api/work`                    | Decisões e tarefas ativas de reuniões acessíveis.                                                                    |
| `PATCH /api/tasks/:id`             | `{status}`: `open`, `in_progress`, `done` ou `cancelled`.                                                            |
| `POST /api/deliveries/:id/retry`   | Retoma um envio pendente/falho, respeitando a deduplicação do provedor.                                              |
| `GET /api/deliveries/:id/local`    | Link do e-mail de teste, apenas em desenvolvimento e para organizador/administrador.                                 |
| `/api/inngest`                     | Endpoint do SDK Inngest; assinatura verificada pelo SDK. Não é uma rota de sessão de usuário.                        |

## Preparação

Para gravação longa: `POST /api/meetings/:id/recordings` com `{requestId}` reserva idempotentemente a única sessão de áudio. `POST /api/meetings/:id/recordings/:fileId/parts/:sequence` recebe multipart `file` (WebM/MP4, até 20 MB por parte, sequência 0–999); repetições com bytes diferentes retornam 409. `GET` na mesma rota baixa a parte após ACL. `GET /api/meetings/:id/recordings/:fileId` lista sequência/tamanho e estado. `POST .../:fileId/finish` exige `{partCount}` e sequência contígua, é idempotente e bloqueia partes novas. Só sessões concluídas entram em `/process`, com o `fileId` da sessão e conferência de presença. Leitura exige acesso à reunião; escrita exige organizador/administrador.

Conhecimento: `GET /api/knowledge` lista até 100 registros da organização (membros veem apenas confirmados). `POST /api/knowledge` exige administrador e multipart `{title,category,date?,content?,file?}`. Categorias: `minutes`, `team`, `project`, `process`, `business`. Anexo opcional: PDF com texto/TXT/Markdown até 5 MB; extração até 100 mil caracteres e 100 páginas de PDF. Entrada salva como rascunho. `PATCH /api/knowledge/:id` exige os campos, `revision`, `state: draft|confirmed|archived` e `reviewed:true` ao confirmar. Compartilhamento é organizacional, não por reunião. `GET /api/knowledge/:id` baixa o original autorizado. Fontes do chat usam `kind: knowledge` e ID `knowledge:ID:REVISION`; revisões antigas/arquivadas invalidam respostas derivadas.

`{title, objective, scheduledAt, duration, location, topic, agenda, participantIds}`. `scheduledAt` é ISO UTC. A interface converte o horário informado no fuso da organização. Cada item da pauta é `{id,title,taskId}`; `taskId` é nulo ou referência a uma pendência acessível. PATCH também exige `revision`.

## Rascunho

`{summary,topics,decisions,tasks,uncertainties}`. Decisões são `{id,description,evidence}`. Tarefas são `{id,description,evidence,assigneeId,dueDate}`. Datas são `YYYY-MM-DD` ou null; responsáveis não confirmados são null. IDs estáveis são preservados durante revisões para manter o progresso operacional.

## Versão da ata

`{draft,meeting,organization,participants}` é um snapshot. Metadados de versão, autor e instante da finalização ficam na entidade `minutes`. Respostas de aceite ficam separadas, vinculadas ao ID exato dessa versão.


## Assistente de reuniões

Todas as rotas abaixo exigem sessão e organização; a autorização das reuniões é aplicada no servidor. O chat pertence ao usuário, inclusive quando o solicitante é administrador. O chat é a superfície principal da consulta; filtros podem ser enviados somente por clientes antigos e são opcionais. Mensagens persistem somente a conversa e nunca alteram registros da reunião.

| Método e rota | Contrato/efeito |
| --- | --- |
| `POST /api/memory/search` | `{query?,filters?}` → `{sources,limited,ambiguous}`. Compatibilidade para clientes antigos; não é exibida na interface principal. |
| `GET /api/memory/chats?before=ID` | Até 100 conversas próprias, mais recentes primeiro. `before` opcional é o ID da última conversa recebida. |
| `POST /api/memory/chats` | Cria conversa privada vazia; retorna `{id}`. |
| `GET /api/memory/chats/:id?before=ID` | `{chat,turns,hasMore}`. Até 100 mensagens em ordem cronológica, revalidando as dependências. `before` opcional é o ID do turno mais antigo recebido. |
| `POST /api/memory/chats/:id/messages` | `{requestId,question,filters?}`. `filters` é opcional e interno. Persiste pergunta e resposta com síntese, citações e, quando aplicável, proposta/ação; retorna a página recente da conversa. |

`query` tem até 2.000 caracteres. `question` é obrigatória, de 1 a 2.000 caracteres. `requestId` é UUID criado pelo cliente e reutilizado em tentativas da mesma pergunta com os mesmos filtros. Reutilização incompatível ou processamento em curso retorna 409. Falhas do provedor retornam 502/503, mantendo a pergunta com `state: failed`; uma solicitação interrompida em `pending` pode ser retomada após dois minutos. O limite de frequência retorna 429.

`filters` é mantido para compatibilidade. Quando ausente, a aplicação infere assunto, período, responsável e situação da mensagem; rascunhos continuam excluídos por padrão. Períodos invertidos e datas inexistentes retornam 400.

Cada fonte contém `id`, `kind`, `meetingId` (nulo para empresa), `title`, `date`, `topic`, `body`, `state`, `href`, `assignee`, `status`. URLs são internas, criadas no servidor, com organização e versão/registro de origem. Fontes da busca são limitadas; `limited: true` não permite concluir ausência de outros registros.

A resposta salva contém `mode` (`ai`, `local`, `search`), `outcome` (`evidence`, `insufficient`, `ambiguous`), `summary` opcional, `citations`/`excerpts` (`sourceId`, `quote`), `sources`, `limited` e uma ação opcional de apresentação. O servidor verifica IDs e trechos literais contra o contexto autorizado; URLs continuam sendo criadas pelo servidor. No modo `local`, a interface informa que nenhuma IA foi consultada. Se o acesso a uma dependência for revogado, o turno é retornado como `restricted`, com pergunta genérica, `answer: null` e `filters: null`.

## Propostas de pauta

- `POST /api/agenda-proposals`: `{requestId,objective,subject?,meetingId?}`. UUID idempotente, objetivo de 3–2000 caracteres, assunto até 160. Reunião alvo opcional deve admitir preparação e edição. Retorna proposta imutável, não uma reunião.
- `GET /api/agenda-proposals/:id`: lê proposta própria após revalidar fontes.
- `GET /api/meetings/:id/agenda-origins`: origens dos itens incorporados, limitadas às fontes autorizadas para o leitor.
- `POST/PATCH /api/meetings`: aceita `agenda[].origin?: {proposalId,itemId}`. Títulos são editáveis; origem e taskId são verificados no servidor. A preparação só muda ao salvar explicitamente.
- Pedidos de pauta em `POST /api/memory/chats/:id/messages` retornam `answer.proposal`. Não criam reuniões nem modificam pautas.

Proposta: `{id,objective,topic,meetingId,mode,items,sources,limited,createdAt}`. `mode` é `ai`, `local` ou `objective`. Cada item inclui `id,title,taskId,category,reason,sourceIds`; `category` é `objective`, `pending`, `overdue`, `recurring` ou `context`. Geração concorrente retorna 409. Falhas retornam 502/503, podem retomar com o mesmo requestId; perda de permissão retorna 403.

## Materiais de apoio

O apresentador integrado usa `GET /api/meetings/:id/materials` e a leitura `?format=json` abaixo, com os mesmos controles de acesso. Abrir, selecionar slides ou entrar em tela cheia não gera material nem inicia gravação automaticamente. Pedidos de criação de reunião no chat retornam `answer.proposal`; a confirmação usa o `POST /api/meetings` existente. Nenhuma reunião fonte é selecionada implicitamente como destino de slides.

| Método e rota | Contrato e autorização |
| --- | --- |
| `POST /api/meetings/:id/materials` | `{requestId,revision,agendaReviewed:true}`. Organizador/administrador, pauta salva não vazia. Retorna `{id}`. Não altera reunião/ata. |
| `GET /api/meetings/:id/materials` | Até 100 materiais autorizados, com id, revisão e data. |
| `GET /api/meetings/:id/materials/:materialId` | Preview HTML autenticado. Exige acesso ao destino e a todas as fontes. |
| `GET /api/meetings/:id/materials/:materialId?download=1` | Mesmo controle, com Content-Disposition attachment. Arquivo HTML independente. |
| `GET /api/meetings/:id/materials/:materialId?format=json` | Snapshot estruturado do material, com os mesmos controles. |

Downloads aceitam `org` como seletor autorizado. Revisão divergente e requestId incompatível retornam 409. Pauta vazia/ausência da confirmação retornam 400. Há limite de 30 gerações por usuário/organização por hora e 160 slides por material. Falha de R2 não é apresentada como material concluído. PDF depende do comando de impressão do navegador; não é um PDF previamente persistido.

## Convites de acesso e perfis (10/09/2026)

`POST /api/participants/:id/invite` exige sessão de administrador, organização correta e participante interno. Retorna `{ok:true}` após confirmação do serviço de envio; `localLink` existe somente no modo local. O link usa a rota de confirmação existente, expira em sete dias e só pode ser consumido uma vez. A frequência é limitada a cinco convites por participante/hora. Solicitar outro convite cria outro link; falha do serviço não retorna sucesso. Não se envia convite de login para externos. `POST /api/auth/verify` retorna também `orgId` para um convite de membro, usado para abrir a empresa correta.

`GET /api/participants` inclui `department`, `responsibilities`, `revision` e `access_state` (`active`, `pending`, `external`). `department` aceita até 150 caracteres e `responsibilities` até 3.000. Em PATCH, campos omitidos preservam os valores atuais; uma atualização incrementa a revisão. Converter para externo remove memberships e invalida auth_tokens vinculados ao participante. O e-mail permanece imutável.

Fontes de perfis usam `kind: participant`, ID `participant:ID:REVISION` e referência interna ao cadastro. A recuperação exige organização antes do ranking. Chat, pautas e materiais revalidam a revisão ao ler conteúdo derivado. Perfis não são evidência de uma tarefa assumida. O contexto de `/process` inclui somente os participantes selecionados da reunião autorizada, com setor, responsabilidades e presença.

Não foram criadas rotas de cobrança, teste gratuito ou ativação de assinatura. O campo `business` continua no contrato para compatibilidade e preservação dos registros anteriores; a nova interface não o solicita.
