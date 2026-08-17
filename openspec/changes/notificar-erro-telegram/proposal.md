# Notificar ERRO no Telegram — aviso imediato de pedido que falhou

## Why

Quando um pedido pago cai em `ERRO`, ninguém fica sabendo: o motivo só existe nos logs do worker
(`journalctl`) e o status só aparece para quem estiver olhando o totem ou o Supabase. Na prática o
cliente descobre antes da equipe — ele pagou, o papel não saiu, e a equipe ainda precisa achar o
protocolo, entender a causa e decidir entre reimprimir ou reembolsar. O canal de Telegram já existe
no worker (avisos de saúde da impressora) e o bot já aceita `/reimprimir <protocolo>`; falta apenas
o evento de `ERRO` chegar lá com os dados necessários para agir.

## What Changes

- Toda marcação de `status = 'ERRO'` pelo worker passa a disparar uma mensagem ao chat da equipe,
  contendo: **protocolo** (o mesmo código de 8 dígitos que o cliente vê, derivado como na view
  `fila_publica`), **motivo** da falha, **o que era esperado** (páginas × cópias = folhas),
  **quantas folhas a impressora comprovadamente produziu**, **fila e job id** (quando houve
  submissão) e o **comando de reimpressão** já pronto.
- O número de folhas impressas é honesto por construção: `0` quando a falha é anterior a qualquer
  submissão, o delta do contador do motor (SNMP) quando houve conferência, e `não confirmado` no
  timeout — caso em que o job pode ainda estar em voo e consultar o equipamento é proibido.
- O envio é best-effort e posterior à marcação: sem `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, ou com
  a Bot API fora do ar, o pedido é marcado como `ERRO` do mesmo jeito e só fica uma linha de log.

## Capabilities

### New Capabilities

_Nenhuma — a mudança acrescenta um requisito à capability existente `print-worker`._

### Modified Capabilities

- `print-worker`: novo requisito de notificação da equipe a cada transição para `ERRO`, com o
  conteúdo mínimo da mensagem e a garantia de que a notificação nunca altera o desfecho do pedido.

## Impact

- `print-worker/worker.py`: `enviar_telegram` (envio genérico, extraído de `enviar_aviso_telegram`),
  `protocolo_do_pedido`, `mensagem_erro_pedido` (pura) e `falhar_pedido` (marca + avisa); os seis
  pontos que chamavam `mark(..., "ERRO")` passam por `falhar_pedido`.
- `print-worker/test_worker_parsers.py`: testes da mensagem e do envio sem envs configuradas.
- `print-worker/README.md`: seção "Aviso de ERRO no Telegram" e envs de Telegram.
- Sem mudança de banco, de API ou de front-end. Envs já existentes — nenhuma nova configuração.
