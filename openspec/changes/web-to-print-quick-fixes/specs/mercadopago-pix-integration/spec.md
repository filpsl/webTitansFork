## MODIFIED Requirements

### Requirement: Endpoint serverless `POST /api/payments/create-pix`

O sistema SHALL expor uma Vercel Serverless Function em `api/payments/create-pix.ts` (runtime Node) que recebe `{ pedidoId: string }` no body JSON e devolve `{ qr_code_base64, qr_code_copia_cola, expiration_date_to, mp_payment_id }`. A cobrança PIX SHALL ser criada com `date_of_expiration = agora + 30 minutos` (ISO com offset de fuso), de modo que `expiration_date_to` reflita uma validade de 30 minutos.

#### Scenario: Pedido válido gera PIX
- **WHEN** o cliente POSTa `{ pedidoId: "<uuid-válido-em-AGUARDANDO_PAGAMENTO>" }`
- **THEN** o endpoint chama a API do Mercado Pago, recebe o pagamento PIX, persiste `mp_payment_id` na linha, e responde 200 com o payload acima

#### Scenario: PIX expira em 30 minutos
- **WHEN** o endpoint cria a cobrança PIX
- **THEN** o `date_of_expiration` enviado ao Mercado Pago é `agora + 30 minutos` e o `expiration_date_to` devolvido reflete essa validade

#### Scenario: Pedido inexistente
- **WHEN** `pedidoId` não existe em `fila_impressao`
- **THEN** o endpoint responde 404 com `{ error: "Pedido não encontrado" }`

#### Scenario: Pedido já pago
- **WHEN** `pedidoId` está em estado diferente de `AGUARDANDO_PAGAMENTO`
- **THEN** o endpoint responde 409 com `{ error: "Pedido não está aguardando pagamento" }`
