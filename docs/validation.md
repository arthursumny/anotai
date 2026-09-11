# Validação do piloto

## Gravações longas, conhecimento e acesso

Esta continuação acrescenta testes de identidade existente em “Criar conta”, login desconhecido, convite interno antes do cadastro e participante externo que cria conta sem ganhar vínculo empresarial. A implementação preserva essas regras; não altera o comportamento de autenticação.

Os testes de áudio cobrem reserva única de sessão, repetição idempotente, bytes divergentes, partes faltantes, encerramento, bloqueio de novas partes, isolamento e download R2. Um provedor controlado falha na segunda parte e confirma que a retomada não retranscreve a primeira; o resultado é consolidado em ordem. Não foi transcrito áudio real nem validada a captura física longa; a transição entre segmentos, suspensão do navegador, precisão e qualidade sonora permanecem verificações de campo.

Conhecimento é testado em rascunho/confirmado/arquivado, com ACL organizacional, confirmação humana, referência recuperável, download privado e ocultação de respostas após arquivamento. A integração extrai texto de um PDF simples no Worker local; PDFs digitalizados e DOCX ficam fora do suporte desta entrega. Importação e contexto não comprovam precisão semântica da IA real.

Validação: 42 testes de domínio/serviço e 284 verificações HTTP D1/R2, além de TypeScript, lint e build de produção. As migrações 0004–0006 são aditivas, mantendo dados e configurações existentes.

## Cobertura automatizada

Os testes de domínio verificam campos desconhecidos/nulos, responsáveis fora da reunião, datas inexistentes, identificadores duplicados, preservação do andamento e agregação de aceites.

O teste integrado usa os endpoints reais da aplicação local, D1 e R2. Cria dados fictícios em organizações separadas e percorre:

- Login por link, consumo único, expiração e logout.
- Cadastro de empresa/pessoas; isolamento de consultas, arquivos, tarefas e resultados de processamento.
- Restrição de edição para membros participantes e restrição de acesso a reuniões não compartilhadas.
- Preparação e convites deduplicados.
- Processamento de texto no serviço local explicitamente identificado, incorporação do resultado e rejeição de aplicação repetida.
- Revisão otimista, conflito de revisão, finalização e proteção contra repetição.
- Tarefas/decisões confirmadas e preservação do status de tarefa entre versões.
- Aceite por destinatário, leitura sem manifestação, ajustes obrigatoriamente comentados, bloqueio de revisão após envio, bloqueio de envio após aceite total, renovação e expiração de links.
- Continuidade por vínculo entre a pauta da próxima reunião e a tarefa de origem.
- Upload e leitura de áudio, limite de tamanho, formato inválido e acesso de outra organização.
- Rejeição de mutações de outra origem.

## Validação pela interface

Foi verificado no navegador o acesso com e-mail fictício, a criação de organização, o painel, a preparação de reunião com pauta/participante, o processamento de texto de teste e a revisão explícita do candidato antes da incorporação ao editor.

## Dependências externas e limites da verificação

A continuação do fluxo assistido acrescenta teste de pedido de reunião com proposta persistida e repetição idempotente sem criar encontro. O teste de apresentação foi corrigido para exigir destino nulo quando a única reunião conhecida é fonte histórica. O apresentador usa a leitura JSON já coberta pela integração D1/R2 e por testes de ACL, revisão e revogação. Troca de slides, captura física, tela cheia e pausa/retomada ainda precisam de validação com microfone real; não foram simuladas como uma reunião realizada.

- OpenAI, Resend e Inngest já estão configurados e seu funcionamento foi confirmado pelo usuário. As verificações locais desta continuação não repetem nem certificam a operação externa.
- O serviço local de texto produz um rascunho marcado, sem extrair decisões ou inventar responsáveis. A transcrição de áudio real fica indisponível nesse modo.
- As funções Inngest incluem checkpoints, novas tentativas, deduplicação e recuperação da caixa de saída. A configuração hospedada existente foi preservada nesta continuação.
- Os testes locais validam os contratos, o armazenamento e a consistência. Não certificam precisão da IA ou entrega real de e-mail.
- Não foi realizada uma reunião com microfone físico. Antes do uso com empresas, validar captura real, permissão negada, pausa/retomada, desconexão, áudio capturado e reprodução em Chrome, Edge e Safari. Testes de upload não substituem essa etapa.
- A captura pelo navegador usa partes independentes de aproximadamente cinco minutos, enviadas progressivamente. O limite de 20 MB é por parte; arquivos prontos enviados manualmente continuam limitados a 20 MB. Não há transcodificação de arquivos grandes. O trecho em curso e partes ainda pendentes podem ser perdidos ao fechar a página. É necessário medir eventuais lacunas entre segmentos em teste físico, além de navegador suspenso, microfone desconectado e rede indisponível.
- Impressão usa o diálogo do navegador para PDF. O snapshot da ata permanece no D1; o PDF não é anexado automaticamente aos e-mails.
- O aceite é simples, identificado pelo acesso ao link individual, sem certificação de assinatura digital.

## Referência para novos ambientes

1. Configurar origem HTTPS, chave de proteção da caixa de saída e provedores.
2. Registrar `/api/inngest` e verificar execução das três funções.
3. Validar um áudio real em português, revisar atribuições e prazos relativos e confirmar o resultado.
4. Enviar convites e atas somente para destinatários de teste autorizados; verificar aceite e pedido de ajuste.
5. Confirmar que processamento continua após fechar a página e que falhas retomam os checkpoints.
6. Conferir permissões com duas empresas distintas e liberar o piloto aos participantes previstos.

A lista acima serve para novos ambientes e revisões operacionais. Não representa integrações pendentes no Site atual.


## Etapa 1 — memória institucional

A nova suíte `tests/memory.test.ts` executa o SQL do serviço em SQLite real com as migrações versionadas. Sessão/runtime e transporte externo são controlados pelo teste. Cobre isolamento por empresa e participação antes do ranking, filtros e acentos, datas inválidas, rascunhos opcionais, estados de aceite, última reunião, ambiguidade, limites de contexto, registros inativos, versões, ausência de histórico, citações inventadas, configuração da chamada de IA sem ferramentas, persistência/idempotência, retomada de falha, conversas privadas e revogação durante/depois da geração. Timeout, recusa e JSON inválido do provedor são injetados, sem chamadas reais à IA.

O teste HTTP existente foi ampliado para busca e chat no D1 local: fontes e links, filtro de responsável/período/situação, isolamento entre organizações/membros, perguntas sem evidência, rascunhos identificados, persistência, deduplicação, revogação e origem de mutações. Continua cobrindo o ciclo de reunião, arquivos e preservação dos bloqueios após envio e aceite total.

As migrações incrementais `0004` e `0005` adicionam três tabelas (`recordings`, `recording_parts` e `knowledge_documents`) e os índices correspondentes; não alteram tabelas ou dados existentes. Foram aplicadas no D1 local. A compilação de produção e os controles estáticos fazem parte da entrega. Não foi realizada nova inspeção visual automatizada do navegador nesta etapa. O preview local foi aberto a partir da aplicação existente.

A recuperação é lexical e a resposta nova pode conter síntese fundamentada: as citações continuam sendo verificadas literalmente, mas os testes não certificam precisão semântica, verdade dos registros ou exaustividade. Os testes locais não comprovam qualidade da IA real, entrega de e-mails ou aceite por destinatários reais. A avaliação em uso deve conferir as perguntas de exemplo sobre histórico autorizado conhecido, referências, inferência de escopo e sinalização de insuficiência/ambiguidade. As configurações e os dados de produção não são usados pelos testes.

Resultado desta continuação (08/09/2026): 23 testes automatizados de domínio/serviço e 167 verificações HTTP passaram, além de TypeScript, lint e build de produção. A suíte também cobre continuidade com andamento atualizado, paginação, cursor de outra conversa, pedidos de ação sem mutação e concorrência no mesmo turno. A versão 4 foi publicada no Site público existente em 08/09/2026, após autorização do usuário. O Sites confirmou a conclusão da publicação; essa confirmação não substitui a avaliação da IA real com histórico autorizado.

## Etapa 2 — preparação com histórico

29 testes de domínio/serviço e 192 verificações HTTP passaram, além de TypeScript e lint. Os novos casos cobrem sugestões com fontes, pendências vencidas e recorrência, ausência de histórico, isolamento da proposta, perda de acesso, vínculo de tarefa adulterado, citações forjadas, falha retomável, geração sem alterar pauta, incorporação por PATCH e bloqueio após áudio/finalização. O pedido de pauta no chat preserva a contagem de reuniões. A migração 0002 acrescenta uma tabela e um índice, preservando as migrações e dados anteriores.

## Etapa 3 — materiais de apoio

A validação passou em 33 testes de domínio/serviço e 209 verificações HTTP. Os novos casos cobrem HTML e snapshot persistidos, fontes de tarefas, confirmação explícita da pauta, revisão divergente, geração idempotente, ausência de mutação da reunião, falha do armazenamento, isolamento entre empresas e participantes sem acesso às fontes, perda de acesso e rejeição de links externos/HTML executável. Textos extensos são distribuídos em páginas, sem remover os itens da pauta. O teste HTTP usa R2 local real para geração e download.

A saída é HTML, com impressão para PDF pelo navegador. A validação automatizada não comprova layout em todos os navegadores, precisão da IA real nem entrega de e-mail. Não houve nova inspeção visual automatizada do navegador nesta continuação. As migrações 0002 e 0003 são aditivas; as configurações de produção permanecem preservadas.

Publicação: versão 5, com as Etapas 2 e 3, concluída no Site existente em 08/09/2026. O Sites confirmou sucesso mantendo a revisão de configuração do ambiente existente.

## Chat como copiloto

A interface usa histórico lateral, compositor na base da conversa, envio por Enter (preservando Shift+Enter e composição de texto), mensagem imediata e retomada com o mesmo identificador após falha. A apresentação não simula streaming. Esta alteração visual preserva os contratos de autorização e persistência; testes locais não comprovam precisão semântica da IA real.

A interface da memória foi convertida em um chat privado por membro. Os filtros e a busca direta permanecem somente como compatibilidade interna; novas mensagens inferem o escopo a partir da linguagem natural. A suíte cobre pedidos de próxima reunião, apresentação, síntese fundamentada, citações literais, ausência de evidência, ações sem mutação automática e compatibilidade com respostas antigas. Após esta alteração, 36 testes de domínio/serviço passaram.

Os pedidos de pauta continuam retornando uma proposta editável. Pedidos de apresentação retornam um cartão de encaminhamento e não criam material antes da revisão explícita da pauta. A resposta de IA pode conter síntese curta, mas sempre preserva fontes e citações validadas pelo servidor. A validação local não certifica qualidade semântica do modelo real nem layout de apresentação em todos os navegadores.

## Conta empresarial e perfis (10/09/2026)

A suíte cobre login inicial de interno apenas com e-mail, convite de acesso por administrador, rejeição de convite para externo e organização incorreta, criação/processamento de reunião por membro, revogação de convite e de sessão empresarial ao converter para externo, preservação da identidade existente e preservação do contexto legado quando o novo formulário salva somente o nome da empresa.

Os testes de serviço verificam que o processamento recebe somente os perfis selecionados da reunião autorizada, com presença, setor e responsabilidades. Verificam também referências de perfis no chat e pautas, isolamento organizacional e invalidação de respostas/propostas após revisão do perfil. Convites de reunião para externos não incluem botão de login. Nenhum teste envia e-mail real ou verifica precisão semântica da IA.

O teste comercial de cinco dias e a assinatura foram retirados do escopo a pedido do usuário. Não há limite de teste nem simulação de pagamento. A migração 0006 é exclusivamente aditiva.

Resultado desta entrega: TypeScript, lint, 42 testes de domínio/serviço, 284 verificações HTTP em D1/R2 local e build de produção aprovados. Esses resultados não comprovam entrega de e-mails reais nem precisão semântica da IA.
