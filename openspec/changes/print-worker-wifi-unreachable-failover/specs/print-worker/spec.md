## ADDED Requirements

### Requirement: Verificação de alcançabilidade real do destino antes de submeter
Para filas de rede (device-uri `ipp://`, `ipps://`, `http://` ou `socket://`), o worker SHALL
verificar a **alcançabilidade real do destino físico da impressora antes de submeter o job**,
e NÃO SHALL confiar apenas no estado `enabled` reportado por `lpstat -p`, que permanece
`enabled` mesmo quando o host da fila Wi-Fi está inalcançável.

A verificação SHALL obter o device-uri da fila (ex.: `lpstat -v <fila>`), resolver o host
(incluindo nomes mDNS `.local`) e tentar uma conexão TCP à porta IPP do destino, ambas com
timeout curto. Uma fila de rede cujo host não resolve ou cuja porta não aceita conexão SHALL
ser considerada **inalcançável**, classificada como falha de PRÉ-SUBMISSÃO (nada foi enviado à
impressora), e NÃO SHALL receber o job. Para filas USB/locais (`usb://`, `hp:/usb/...`,
`file://`), essa verificação de rede NÃO SHALL ser aplicada; mantém-se o health-check existente
de fila habilitada. Se o device-uri não puder ser interpretado, o worker SHALL degradar para o
health-check existente em vez de bloquear a impressão.

#### Scenario: Primária Wi-Fi com host inalcançável
- **WHEN** a fila primária é de rede e o host (mDNS `.local`) não resolve ou a porta IPP não
  aceita conexão dentro do timeout
- **THEN** o worker considera a primária inalcançável, NÃO submete o job a ela, e registra a
  falha como pré-submissão (nada impresso)

#### Scenario: Primária alcançável
- **WHEN** o host da fila primária resolve e a porta IPP aceita conexão dentro do timeout
- **THEN** o worker prossegue para a submissão normal do job à primária

#### Scenario: Fila USB de fallback não sofre checagem de rede
- **WHEN** a fila candidata tem device-uri USB/local (ex.: `usb://`, `hp:/usb/...`)
- **THEN** o worker NÃO aplica a verificação de alcançabilidade de rede e usa o health-check de
  fila habilitada existente

#### Scenario: Device-uri não interpretável
- **WHEN** o worker não consegue extrair host/porta do device-uri da fila
- **THEN** o worker degrada para o health-check existente e não bloqueia a impressão por causa
  do parsing

## MODIFIED Requirements

### Requirement: Impressão na HP Laser MFP 135w via CUPS
O worker SHALL enviar o PDF para impressão na fila CUPS configurada (`PRINTER_NAME`) usando o
utilitário `lp` do sistema, produzindo a quantidade de cópias do pedido. A quantidade SHALL ser
lida do campo `quantidade_copias` da linha (>= 1), com fallback para 1 caso ausente.

Como a HP Laser MFP 135w ignora a opção de cópias do CUPS (`lp -n` / `-o copies`), o worker SHALL
materializar as cópias no próprio arquivo — concatenando o documento `quantidade_copias` vezes num
único PDF — e enviá-lo como um único job de uma cópia, em vez de depender da opção de cópias do
driver. A reconferência de páginas (`num_paginas`) SHALL ocorrer sobre o PDF original, antes da
replicação. Por a impressora ser monocromática, todo pedido SHALL ser impresso em preto-e-branco.

Quando uma fila de fallback (`PRINTER_NAME_FALLBACK`) estiver configurada, o worker SHALL tentar
a fila primária e, se ela for **comprovadamente inalcançável antes de qualquer byte chegar à
impressora**, SHALL fazer failover para a fila de fallback. Um destino de rede que não resolve ou
cuja porta IPP não aceita conexão SHALL ser tratado como falha de PRÉ-SUBMISSÃO (nada impresso),
autorizando o failover — mesmo que o `lpstat -p` reporte a fila como `enabled` e mesmo que o CUPS
aceitaria o job no spool. Uma vez que o job tenha sido aceito por uma fila cujo destino foi (ou
pôde ter sido) contatado, o worker NÃO SHALL fazer failover para outra fila; falhas posteriores
(ex.: timeout de conclusão) SHALL resultar em cancelamento do job e `status = 'ERRO'`, nunca em
reimpressão automática, para preservar o invariante de nunca imprimir o mesmo pedido duas vezes.

#### Scenario: Envio aceito pelo CUPS
- **WHEN** o worker envia o PDF (já com as cópias materializadas) e o CUPS aceita o trabalho
- **THEN** o worker captura o identificador do job para acompanhar a conclusão

#### Scenario: Pedido com múltiplas cópias
- **WHEN** o pedido tem `quantidade_copias = 3` e o PDF original tem N páginas
- **THEN** o worker imprime um único job contendo `3 * N` páginas (o documento repetido 3 vezes)

#### Scenario: Pedido sem quantidade definida
- **WHEN** a linha do pedido não traz `quantidade_copias` (pedido legado)
- **THEN** o worker imprime 1 cópia (fallback), sem replicar o PDF

#### Scenario: Pedido COLORIDO em impressora mono
- **WHEN** o pedido tem `modo_cor = 'COLORIDO'`
- **THEN** o worker registra um aviso no log e imprime o documento em tons de cinza

#### Scenario: Failover quando a primária está inalcançável
- **WHEN** a fila primária de rede está comprovadamente inalcançável (host não resolve ou porta
  IPP recusa conexão) e há uma fila de fallback configurada
- **THEN** o worker NÃO submete à primária, faz failover para a fila de fallback e imprime o
  pedido uma única vez, sem duplicar

#### Scenario: Sem failover após o destino ter sido contatado
- **WHEN** o job foi aceito por uma fila cujo destino respondeu (ou cuja ausência de impressão
  não pode ser comprovada) e a conclusão falha por timeout
- **THEN** o worker cancela o job, marca `status = 'ERRO'` e NÃO tenta outra fila, evitando
  reimpressão duplicada
