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
