## Why

A primeira versão do web-to-print está em produção, mas acumulou três ajustes pendentes que afetam a experiência e a operação: (1) a opção **COLORIDO** aparece no checkout embora a HP 135w seja monocromática; (2) o **tempo do PIX está incoerente** — o contador começa em ~25 min (default do Mercado Pago) e o acompanhamento desiste aos 10 min mesmo com o PIX ainda válido, mandando o cliente para a tela de "Pagamento não confirmado" sem motivo; (3) o banco opera em **UTC**, dificultando a leitura operacional dos horários (a equipe está em Brasília).

## What Changes

- **Remover COLORIDO do checkout.** A tela de configuração passa a oferecer apenas "Preto e branco" (modo sempre `PB`); `pricing.ts` passa a exigir só a linha `PB` de `config_precos`. O CHECK `modo_cor in ('PB','COLORIDO')` e a linha `COLORIDO` de `config_precos` **permanecem** (compatibilidade com pedidos legados). O `create-pix` é genérico e não muda.
- **PIX com validade de 30 minutos + fim do corte prematuro.** O `create-pix` passa a enviar `date_of_expiration = agora + 30 min` no `mpPayment.create`. O acompanhamento no front (`usePedidoStatus`) deixa de usar o corte fixo de 10 min e passa a **durar até a expiração real do QR** (`expiration_date_to`) — assim nunca desiste antes do tempo nem espera além do QR. Corrige o "Pagamento não confirmado" prematuro.
- **Banco em horário de Brasília.** Timezone do Postgres = `America/Sao_Paulo` (via migration `0006`). Colunas `timestamptz` continuam em UTC; muda apenas exibição e `now()::timestamp`. Sem impacto no cron de limpeza (`'0 * * * *'` alinha no minuto 0 em qualquer fuso) nem nos intervalos da `cleanup-fila` (`now() - interval`, tz-independente em `timestamptz`).

## Capabilities

### New Capabilities

(nenhuma)

### Modified Capabilities

- `web-to-print-checkout`: remove a seleção de modo COLORIDO do checkout; o acompanhamento do pagamento passa a durar até a expiração real do QR (em vez do corte fixo de 10 min).
- `mercadopago-pix-integration`: a cobrança PIX passa a expirar em 30 minutos, via `date_of_expiration` explícito no `create-pix`.
- `print-queue-storage`: o banco passa a operar no fuso `America/Sao_Paulo`.

## Impact

- **Frontend:** `src/components/impressao/ConfiguracaoImpressao.tsx` (remove o radio COLORIDO), `src/hooks/usePedidoStatus.ts` (timeout derivado de `expiration_date_to` em vez do `TIMEOUT_MS` fixo) + `src/components/impressao/TelaPagamento.tsx` (passa a expiração ao hook), `src/lib/pricing.ts` (exigir só `PB`), `src/lib/types.ts` (`ModoCor` mantém a união por compatibilidade de leitura de pedidos legados).
- **Backend:** `api/payments/create-pix.ts` (envia `date_of_expiration = agora + 30 min`).
- **Banco:** migration `0006_timezone_brasilia.sql` (`alter database ... set timezone`).
- **Sem breaking changes** para pedidos existentes; sem mudança de RLS, segredos ou contrato do webhook.
