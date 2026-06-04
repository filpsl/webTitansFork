## ADDED Requirements

### Requirement: Seleção da quantidade de cópias

O checkout SHALL oferecer um campo numérico "Quantidade de cópias" com valor mínimo 1 e padrão 1. O sistema SHALL impedir o avanço com quantidade menor que 1 ou não inteira, normalizando entradas inválidas para o mínimo.

#### Scenario: Usuário define 3 cópias
- **WHEN** o usuário informa `3` no campo de quantidade de cópias
- **THEN** o checkout registra `quantidade_copias = 3` e o usa no INSERT do pedido e no cálculo do total

#### Scenario: Quantidade padrão
- **WHEN** o usuário não altera o campo de quantidade
- **THEN** o checkout assume `quantidade_copias = 1`

#### Scenario: Quantidade inválida é normalizada
- **WHEN** o usuário tenta informar `0`, vazio ou um valor não inteiro
- **THEN** o checkout normaliza para `1` (mínimo) e não permite gerar PIX com quantidade menor que 1

## MODIFIED Requirements

### Requirement: Seleção de modo de cor e cálculo de preço

O sistema SHALL oferecer escolha entre `P&B` e `COLORIDO` e calcular o valor total como `num_paginas * quantidade_copias * valor_centavos_por_pagina[modo]`, com os valores por página carregados da tabela `config_precos` do Supabase. O total exibido SHALL recalcular imediatamente quando a quantidade de cópias mudar.

#### Scenario: Cálculo P&B com cópias
- **WHEN** o PDF tem 10 páginas, `config_precos.PB = 50` centavos, o usuário escolhe P&B e informa 2 cópias
- **THEN** o total exibido é `R$ 10,00` (`10 * 2 * 50` centavos)

#### Scenario: Troca de modo de cor recalcula
- **WHEN** o usuário alterna de P&B para COLORIDO em um pedido de 10 páginas, 1 cópia, com preços 50 e 200
- **THEN** o total exibido muda imediatamente de `R$ 5,00` para `R$ 20,00`

#### Scenario: Mudar a quantidade de cópias recalcula
- **WHEN** o usuário aumenta a quantidade de cópias de 1 para 3 em um pedido de 10 páginas P&B a 50 centavos
- **THEN** o total exibido muda imediatamente de `R$ 5,00` para `R$ 15,00`

### Requirement: Upload direto para Supabase Storage e criação do pedido

O sistema SHALL fazer upload do PDF diretamente do navegador para o bucket `pdfs-impressao` do Supabase Storage usando a anon key, e ao concluir SHALL inserir uma linha em `fila_impressao` com `status='AGUARDANDO_PAGAMENTO'`, `pdf_path` apontando para o arquivo no Storage, `num_paginas`, `quantidade_copias`, `modo_cor` e `valor_centavos`.

#### Scenario: Upload bem-sucedido
- **WHEN** o cliente clica em "Pagar" e o upload do PDF conclui sem erro
- **THEN** uma nova linha aparece em `fila_impressao` com `quantidade_copias` preenchido (>= 1) e status `AGUARDANDO_PAGAMENTO`, e o cliente recebe o `id` do pedido

#### Scenario: Falha de rede durante upload
- **WHEN** o upload do PDF falha por timeout/conexão
- **THEN** nenhum registro é criado em `fila_impressao` e o cliente vê "Falha no envio, tente novamente"
