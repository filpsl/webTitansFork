## MODIFIED Requirements

### Requirement: Impressão na HP Laser MFP 135w via CUPS
O worker SHALL enviar o PDF para impressão na fila CUPS configurada (`PRINTER_NAME`) usando o
utilitário `lp` do sistema, solicitando a quantidade de cópias do pedido via `lp -n <quantidade_copias>`.
A quantidade SHALL ser lida do campo `quantidade_copias` da linha (>= 1), com fallback para 1 caso
ausente. Por a impressora ser monocromática, todo pedido SHALL ser impresso em preto-e-branco.

#### Scenario: Envio aceito pelo CUPS
- **WHEN** o worker chama `lp -n <quantidade_copias>` para o PDF e o CUPS aceita o trabalho
- **THEN** o worker captura o identificador do job para acompanhar a conclusão

#### Scenario: Pedido com múltiplas cópias
- **WHEN** o pedido tem `quantidade_copias = 3`
- **THEN** o worker envia `lp -n 3` e o CUPS imprime 3 cópias do documento

#### Scenario: Pedido sem quantidade definida
- **WHEN** a linha do pedido não traz `quantidade_copias` (pedido legado)
- **THEN** o worker imprime 1 cópia (fallback)

#### Scenario: Pedido COLORIDO em impressora mono
- **WHEN** o pedido tem `modo_cor = 'COLORIDO'`
- **THEN** o worker registra um aviso no log e imprime o documento em tons de cinza
