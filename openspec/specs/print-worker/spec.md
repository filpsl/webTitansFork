# print-worker Specification

## Purpose
TBD - created by archiving change add-print-worker. Update Purpose after archive.
## Requirements
### Requirement: Detecção de pedidos pagos
O worker SHALL consultar periodicamente a tabela `fila_impressao` por pedidos com
`status = 'PAGO'`, processando-os em ordem de `paid_at` crescente (FIFO). O intervalo de
consulta SHALL ser configurável via variável de ambiente, com padrão de 10 segundos.

#### Scenario: Pedido pago disponível
- **WHEN** existe ao menos uma linha com `status = 'PAGO'`
- **THEN** o worker seleciona a mais antiga por `paid_at` e inicia o processamento dela

#### Scenario: Fila vazia
- **WHEN** não há nenhuma linha com `status = 'PAGO'`
- **THEN** o worker aguarda o intervalo configurado e consulta novamente, sem erro

### Requirement: Claim atômico do pedido
O worker SHALL reivindicar um pedido de forma atômica antes de imprimir, executando um
`UPDATE` condicional de `status = 'PAGO'` para `status = 'IMPRIMINDO'` na mesma operação.
Apenas a execução cujo UPDATE afetar a linha SHALL prosseguir com a impressão.

#### Scenario: Claim bem-sucedido
- **WHEN** o worker tenta reivindicar um pedido `PAGO` e o UPDATE retorna a linha
- **THEN** o worker passa a ser o dono do pedido e segue para download e impressão

#### Scenario: Claim perdido para outra execução
- **WHEN** o worker tenta reivindicar um pedido que já foi mudado de `PAGO` por outra execução
- **THEN** o UPDATE não afeta nenhuma linha e o worker ignora esse pedido sem imprimir

### Requirement: Download seguro do PDF
O worker SHALL baixar o PDF do bucket privado `pdfs-impressao` usando o caminho `pdf_path`
do pedido e a `service_role` key do Supabase. A `service_role` key NÃO SHALL ser exposta a
clientes nem commitada no repositório.

#### Scenario: PDF baixado com sucesso
- **WHEN** o `pdf_path` aponta para um objeto existente no bucket
- **THEN** o worker carrega o conteúdo do PDF em memória para conferência e impressão

#### Scenario: PDF ausente ou inacessível
- **WHEN** o download falha (objeto inexistente, erro de rede após retentativas)
- **THEN** o worker marca o pedido como `status = 'ERRO'` e registra o motivo no log

### Requirement: Reconferência de páginas antes da impressão
O worker SHALL contar as páginas reais do PDF baixado e SHALL recusar a impressão se o PDF
for ilegível/criptografado ou se a contagem real divergir de `num_paginas` registrado no
pedido.

#### Scenario: Contagem confere
- **WHEN** a contagem real de páginas do PDF é igual a `num_paginas` do pedido
- **THEN** o worker prossegue para a impressão

#### Scenario: Contagem diverge
- **WHEN** a contagem real de páginas difere de `num_paginas`
- **THEN** o worker marca `status = 'ERRO'`, registra a contagem observada no log e não imprime

#### Scenario: PDF inválido
- **WHEN** o PDF não pode ser lido (corrompido ou criptografado)
- **THEN** o worker marca `status = 'ERRO'` e não imprime

### Requirement: Impressão na HP Laser MFP 135w via CUPS
O worker SHALL enviar o PDF para impressão na fila CUPS configurada (`PRINTER_NAME`) usando o
utilitário `lp` do sistema. Por a impressora ser monocromática, todo pedido SHALL ser impresso
em preto-e-branco.

#### Scenario: Envio aceito pelo CUPS
- **WHEN** o worker chama `lp` para o PDF e o CUPS aceita o trabalho
- **THEN** o worker captura o identificador do job para acompanhar a conclusão

#### Scenario: Pedido COLORIDO em impressora mono
- **WHEN** o pedido tem `modo_cor = 'COLORIDO'`
- **THEN** o worker registra um aviso no log e imprime o documento em tons de cinza

### Requirement: Confirmação de conclusão com timeout
O worker SHALL acompanhar o job no CUPS até a conclusão ou até estourar um tempo limite
configurável (`PRINT_TIMEOUT`, padrão 180 segundos). Somente após a conclusão confirmada o
worker SHALL marcar o pedido como impresso.

#### Scenario: Impressão concluída
- **WHEN** o CUPS reporta o job como concluído dentro do tempo limite
- **THEN** o worker atualiza o pedido para `status = 'IMPRESSO'` com `printed_at = now()`

#### Scenario: Tempo limite excedido
- **WHEN** o job não conclui dentro de `PRINT_TIMEOUT` (impressora offline, sem papel, atolada)
- **THEN** o worker tenta cancelar o job, marca `status = 'ERRO'` e registra o motivo no log

### Requirement: Recuperação de pedidos travados
O worker SHALL, no início de cada ciclo, detectar pedidos presos em `status = 'IMPRIMINDO'`
por mais tempo que um limite configurável (`STUCK_TIMEOUT`, padrão 15 minutos) e devolvê-los à
fila para nova tentativa, sem deixá-los presos indefinidamente.

#### Scenario: Pedido órfão em IMPRIMINDO
- **WHEN** um pedido permanece em `IMPRIMINDO` além de `STUCK_TIMEOUT` (ex.: queda da máquina)
- **THEN** o worker devolve o pedido para `status = 'PAGO'` para ser reprocessado

#### Scenario: Pedido PAGO nunca é tocado por outro estado
- **WHEN** um pedido está em `status = 'PAGO'` e ainda não foi reivindicado
- **THEN** o worker apenas o reivindica via claim atômico, nunca o apaga ou altera fora do fluxo

### Requirement: Execução resiliente e contínua
O worker SHALL rodar continuamente como serviço de longa duração, tolerando erros
transitórios (rede, Supabase indisponível) sem encerrar, e SHALL ser executável como serviço
systemd com reinício automático.

#### Scenario: Erro transitório de rede
- **WHEN** uma consulta ao Supabase falha por erro de rede
- **THEN** o worker registra o erro, aguarda e tenta novamente no próximo ciclo, sem encerrar

#### Scenario: Reinício do serviço
- **WHEN** o processo do worker é encerrado (crash ou reboot da máquina)
- **THEN** o systemd reinicia o serviço automaticamente e o worker retoma o processamento da fila

### Requirement: Nunca imprimir o mesmo pedido duas vezes
O sistema SHALL garantir que cada pedido seja impresso no máximo uma vez, mesmo com múltiplas
execuções concorrentes do worker ou reinícios no meio do processamento.

#### Scenario: Duas instâncias concorrentes
- **WHEN** duas instâncias do worker veem o mesmo pedido `PAGO` ao mesmo tempo
- **THEN** apenas uma vence o claim atômico e imprime; a outra ignora o pedido

