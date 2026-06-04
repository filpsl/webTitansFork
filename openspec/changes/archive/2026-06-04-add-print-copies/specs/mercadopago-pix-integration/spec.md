## MODIFIED Requirements

### Requirement: Endpoint serverless `POST /api/payments/create-pix`

O sistema SHALL expor uma Vercel Serverless Function em `api/payments/create-pix.ts` (runtime Node) que recebe `{ pedidoId: string }` no body JSON e devolve `{ qr_code_base64, qr_code_copia_cola, expiration_date_to, mp_payment_id }`. O servidor SHALL ser a autoridade de preço: SHALL reconferir `num_paginas` a partir do PDF real no Storage, SHALL ler `quantidade_copias` e `modo_cor` da própria linha do pedido, e SHALL calcular `valor_centavos = num_paginas_reais * quantidade_copias * config_precos.valor_centavos_por_pagina[modo_cor]`, persistindo o valor autoritativo na linha antes de cobrar.

#### Scenario: Pedido válido gera PIX com múltiplas cópias
- **WHEN** o cliente POSTa `{ pedidoId: "<uuid-em-AGUARDANDO_PAGAMENTO com quantidade_copias=2>" }`, o PDF real tem 10 páginas e `config_precos.PB = 50`
- **THEN** o endpoint calcula `valor_centavos = 10 * 2 * 50 = 1000`, chama o Mercado Pago com `transaction_amount = 10.00`, persiste `num_paginas=10` e `valor_centavos=1000` na linha, e responde 200 com o payload de PIX

#### Scenario: Pedido com 1 cópia mantém o comportamento atual
- **WHEN** o pedido tem `quantidade_copias = 1`, PDF de 4 páginas e `config_precos.PB = 50`
- **THEN** o endpoint calcula `valor_centavos = 4 * 1 * 50 = 200`

#### Scenario: Pedido inexistente
- **WHEN** `pedidoId` não existe em `fila_impressao`
- **THEN** o endpoint responde 404 com `{ error: "Pedido não encontrado" }`

#### Scenario: Pedido já pago
- **WHEN** `pedidoId` está em estado diferente de `AGUARDANDO_PAGAMENTO`
- **THEN** o endpoint responde 409 com `{ error: "Pedido não está aguardando pagamento" }`
