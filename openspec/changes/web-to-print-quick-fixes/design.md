## Context

Bloco A de ajustes pós-lançamento do web-to-print (em produção). Três itens independentes, de baixo risco. Estado atual:
- O checkout oferece COLORIDO embora a HP 135w seja monocromática.
- O `create-pix` não envia `date_of_expiration` (o MP usa o default, ~30 min) e o `usePedidoStatus` tem `TIMEOUT_MS = 10 min` — o acompanhamento desiste antes mesmo de o PIX expirar.
- O banco Postgres opera em UTC.

## Goals / Non-Goals

**Goals:**
- Remover a opção COLORIDO do checkout (UI + validação de preços).
- Tornar a validade do PIX e a janela de acompanhamento coerentes em **30 minutos** (a janela do front deriva da expiração real do QR).
- Operar o banco em horário de Brasília (`America/Sao_Paulo`).

**Non-Goals:**
- Remover COLORIDO do banco (`CHECK` e linha `config_precos` ficam, por compatibilidade com pedidos legados).
- Cópias e frente-e-verso (Bloco B) e retry de `ERRO` (Bloco C).
- Mudar o modelo de preços ou qualquer regra de RLS/segredos/webhook.

## Decisions

### D1. COLORIDO sai só da UI
Remover o radio COLORIDO de `ConfiguracaoImpressao.tsx` (sobra "Preto e branco"; `modo` é sempre `PB`) e relaxar `pricing.ts` para exigir só a linha `PB` de `config_precos`. O type `ModoCor` mantém a união `"PB" | "COLORIDO"` para ler pedidos legados sem mentir o tipo, e o `CHECK modo_cor in ('PB','COLORIDO')` permanece. **Alternativa descartada:** migrar dados/constraint para só `PB` — desnecessário e arriscaria pedidos antigos.

### D2. PIX de 30 min = duas mudanças coordenadas
1. **Backend:** `create-pix` passa a enviar `date_of_expiration = agora + 30 min` no corpo do `mpPayment.create`. O MP exige esse campo em ISO **com offset de fuso** (ex.: `2026-06-02T15:04:05.000-03:00`); gerar com cuidado no Node (que roda em UTC na Vercel). 30 min foi a duração escolhida (bate com o default do MP; tempo de sobra para pagar sem segurar pedidos parados).
2. **Frontend:** o acompanhamento (`usePedidoStatus`) deixa de usar o corte fixo `TIMEOUT_MS = 10 min` e passa a **derivar o timeout de `expiration_date_to`** — a janela termina exatamente quando o QR expira. `TelaPagamento` passa a expiração ao hook. Assim há **uma só fonte de verdade** (a expiração real do QR): o front nunca desiste antes (o bug atual) nem espera além. **Alternativa descartada:** trocar o `TIMEOUT_MS` fixo de 10 para 30 min — ainda seria um número mágico que poderia divergir da validade real do QR.

### D3. Timezone no banco
`alter database postgres set timezone to 'America/Sao_Paulo'` (migration `0006`). Colunas `timestamptz` continuam em **UTC** no armazenamento; a mudança afeta exibição e `now()::timestamp`. O cron (`'0 * * * *'`) e os intervalos da `cleanup-fila` (`now() - interval`) são **tz-independentes** em `timestamptz`, então não mudam de comportamento. **Alternativa descartada:** formatar só no app — o pedido é que o **banco** opere em Brasília (para queries e dashboard).

## Risks / Trade-offs

- **[Formato de `date_of_expiration` recusado pelo MP]** → o MP é exigente com o offset. Mitigação: gerar ISO com offset `-03:00` explícito e validar com um pedido real (o `expiration_date_to` devolvido deve mostrar ~30 min).
- **[`alter database ... set timezone` exige reconexão]** → o novo default vale para **novas** conexões; conexões em pool podem demorar a pegar. Mitigação: aplicar via SQL e conferir com `show timezone;` numa sessão nova.
- **[Pedidos legados COLORIDO]** → seguem válidos (constraint + `config_precos` mantidos); o worker imprime em tons de cinza.
- **[Vercel roda em UTC]** → a geração de `date_of_expiration` no Node independe do timezone do banco; é só aritmética de `Date`. Sem conflito com D3.

## Migration Plan

1. Deploy do código (frontend + `create-pix`) via `feat/Impressora` (Vercel de teste).
2. Rodar `0006_timezone_brasilia.sql` no SQL Editor do Supabase.
3. Validar: checkout sem COLORIDO; contador do PIX ~30 min; pagamento não expira aos 10 min; `show timezone;` e `select now();` em Brasília.

**Rollback:** reverter o commit do código; timezone volta com `set timezone to 'UTC'`.

## Open Questions

- Nenhuma crítica. O timer continua refletindo `expiration_date_to` (que passa a ser 30 min após o fix), em vez de um fixo local.
