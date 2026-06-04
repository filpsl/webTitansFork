## MODIFIED Requirements

### Requirement: Impressão na HP Laser MFP 135w via CUPS
O worker SHALL enviar o PDF para impressão numa **fila CUPS primária** configurada
(`PRINTER_NAME`) usando o utilitário `lp` do sistema, produzindo a quantidade de cópias do
pedido. A quantidade SHALL ser lida do campo `quantidade_copias` da linha (>= 1), com fallback
para 1 caso ausente.

O worker SHALL aceitar uma **fila de fallback opcional** (`PRINTER_NAME_FALLBACK`). Quando
definida, a fila primária representa o caminho preferencial (Wi-Fi / IPP Everywhere, ex.:
`Titans_Laser`) e a fila de fallback representa o caminho secundário (Cabo/USB, ex.:
`HP_Laser_MFP_131_133_135_138`). Quando `PRINTER_NAME_FALLBACK` NÃO estiver definida, o worker
SHALL operar apenas com a fila primária, sem failover (retrocompatibilidade com a configuração
de fila única).

Antes de submeter um job, o worker SHALL verificar a saúde da fila candidata (existência e
estado habilitado via `lpstat`) e SHALL escolher a primeira fila saudável na ordem
primária → fallback, evitando submeter a uma fila comprovadamente parada/desabilitada.

Como a impressora ignora a opção de cópias do CUPS (`lp -n` / `-o copies`), o worker SHALL
materializar as cópias no próprio arquivo — concatenando o documento `quantidade_copias` vezes
num único PDF — e enviá-lo como um único job de uma cópia, em vez de depender da opção de
cópias do driver. A reconferência de páginas (`num_paginas`) SHALL ocorrer sobre o PDF
original, antes da replicação. Por a impressora ser monocromática, todo pedido SHALL ser
impresso em preto-e-branco.

O worker SHALL registrar em log qual fila foi escolhida para cada pedido.

#### Scenario: Envio aceito pela fila primária
- **WHEN** a fila primária está saudável e o CUPS aceita o trabalho
- **THEN** o worker captura o identificador do job nessa fila e acompanha a conclusão, sem
  tentar a fila de fallback

#### Scenario: Fila de fallback não configurada
- **WHEN** `PRINTER_NAME_FALLBACK` não está definida e a fila primária aceita o job
- **THEN** o worker imprime apenas pela fila primária, exatamente como na configuração de fila
  única, sem comportamento de failover

#### Scenario: Pedido com múltiplas cópias
- **WHEN** o pedido tem `quantidade_copias = 3` e o PDF original tem N páginas
- **THEN** o worker imprime um único job contendo `3 * N` páginas (o documento repetido 3 vezes)

#### Scenario: Pedido sem quantidade definida
- **WHEN** a linha do pedido não traz `quantidade_copias` (pedido legado)
- **THEN** o worker imprime 1 cópia (fallback), sem replicar o PDF

#### Scenario: Pedido COLORIDO em impressora mono
- **WHEN** o pedido tem `modo_cor = 'COLORIDO'`
- **THEN** o worker registra um aviso no log e imprime o documento em tons de cinza

## ADDED Requirements

### Requirement: Failover automático entre filas restrito à pré-submissão
O worker SHALL fazer failover automático da fila primária para a fila de fallback APENAS quando
a falha ocorrer **antes de o job ser aceito pelo CUPS** (falha de pré-submissão), em que é
seguro afirmar que nada foi impresso. São falhas de pré-submissão: a fila estar
desabilitada/parada/inalcançável no health-check; o nome de host `.local` (mDNS) não resolver;
a impressora estar inalcançável; o `lp` retornar erro de submissão; ou o `lp` retornar sucesso
mas sem job id rastreável.

O worker SHALL registrar em log cada failover, indicando a fila de origem, a fila de destino e
o motivo da pré-submissão.

#### Scenario: Failover por fila primária inalcançável
- **WHEN** a fila primária (Wi-Fi) falha na submissão por host `.local` não resolver ou
  impressora inalcançável, e a fila de fallback está configurada e saudável
- **THEN** o worker submete o mesmo job à fila de fallback e prossegue acompanhando a conclusão
  nessa fila

#### Scenario: Failover por fila primária desabilitada no health-check
- **WHEN** o health-check indica que a fila primária está desabilitada/parada e a fila de
  fallback está saudável
- **THEN** o worker não submete à primária, submete à fila de fallback e registra o motivo no log

#### Scenario: Todas as filas falham na pré-submissão
- **WHEN** nenhuma fila (primária nem fallback) aceita o job, todas falhando antes da aceitação
- **THEN** o worker marca o pedido como `status = 'ERRO'` e registra que nenhuma fila aceitou o
  trabalho, sem ter impresso nada

### Requirement: Proibição de failover após aceitação do job (anti-duplicação)
O worker SHALL NOT fazer failover nem reimprimir automaticamente um pedido após o CUPS ter
aceitado o job (job id obtido). Após a aceitação, não há garantia de que nada foi impresso, de
modo que reenviar o documento — que pode conter múltiplas cópias materializadas — arriscaria
duplicar a impressão. Qualquer falha pós-aceitação (notadamente o timeout de conclusão) SHALL
manter o comportamento de cancelar o job e marcar `status = 'ERRO'` para tratamento manual,
nunca reimprimir.

#### Scenario: Timeout após aceitação não dispara failover
- **WHEN** o job foi aceito pela fila primária mas não conclui dentro de `PRINT_TIMEOUT`
- **THEN** o worker tenta cancelar o job nessa fila, marca `status = 'ERRO'` e NÃO tenta a fila
  de fallback, evitando reimpressão duplicada

#### Scenario: Falso negativo pós-aceitação é resolvido manualmente
- **WHEN** o job foi aceito e possivelmente impresso, mas o worker não confirmou a conclusão
- **THEN** o pedido permanece em `status = 'ERRO'` com a fila e o job id registrados no log,
  para que um operador decida manualmente, em vez de o worker reimprimir automaticamente

### Requirement: Confirmação de conclusão na fila escolhida
O worker SHALL acompanhar o job no CUPS na **mesma fila** em que ele foi aceito, até a
conclusão ou até estourar `PRINT_TIMEOUT`. A confirmação de conclusão e o eventual cancelamento
SHALL referir-se sempre à fila onde o job foi efetivamente submetido, e não a uma fila fixa.

#### Scenario: Conclusão confirmada na fila de fallback
- **WHEN** o job foi aceito pela fila de fallback após um failover de pré-submissão e conclui
  dentro do tempo limite
- **THEN** o worker atualiza o pedido para `status = 'IMPRESSO'` com `printed_at = now()`,
  tendo acompanhado a conclusão na fila de fallback

#### Scenario: Cancelamento na fila correta após timeout
- **WHEN** o job aceito por uma fila estoura `PRINT_TIMEOUT`
- **THEN** o worker tenta cancelar o job nessa mesma fila e marca `status = 'ERRO'`
