## MODIFIED Requirements

### Requirement: Seleção de modo de cor e cálculo de preço

O checkout SHALL oferecer **apenas** o modo `PB` (a HP 135w é monocromática) e calcular o valor total como `num_paginas * config_precos.PB`, com o preço por página carregado da tabela `config_precos`. A interface NÃO SHALL oferecer a opção COLORIDO, e a validação de preços SHALL exigir apenas a linha `PB`.

#### Scenario: Cálculo P&B
- **WHEN** o PDF tem 10 páginas e `config_precos.PB = 50` centavos
- **THEN** o total exibido é `R$ 5,00`

#### Scenario: COLORIDO não é oferecido no checkout
- **WHEN** o usuário está na tela de configuração da impressão
- **THEN** não existe opção de modo COLORIDO e o `modo_cor` enviado é sempre `PB`

### Requirement: Atualização em tempo real do status do pedido

O sistema SHALL assinar o canal Supabase Realtime filtrado pela linha do pedido e SHALL adicionalmente fazer polling do status a cada 5 segundos como fallback; quando o status passar a `PAGO`, SHALL navegar automaticamente para a tela de sucesso. A janela de acompanhamento SHALL durar até a **expiração real do QR** (`expiration_date_to`), e não um valor fixo independente da validade do PIX.

#### Scenario: Webhook chega e Realtime entrega
- **WHEN** o `/api/webhooks/mercadopago` atualiza o pedido para `PAGO`
- **THEN** o cliente recebe o evento Realtime em menos de 2 segundos e exibe a tela de sucesso sem refresh

#### Scenario: Realtime indisponível, polling cobre
- **WHEN** o canal Realtime falha em conectar mas o pedido é marcado como `PAGO`
- **THEN** o polling de 5 s detecta a mudança e a tela de sucesso é exibida em até 10 segundos após o webhook

#### Scenario: Pagamento não chega até a expiração do QR
- **WHEN** o pedido permanece em `AGUARDANDO_PAGAMENTO` até o `expiration_date_to` do QR
- **THEN** o sistema exibe "Pagamento não confirmado" e oferece botão "Voltar ao início" — e não antes disso (em particular, não aos 10 min)
