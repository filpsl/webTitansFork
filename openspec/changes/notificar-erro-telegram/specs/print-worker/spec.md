# Delta — print-worker (notificar-erro-telegram)

## ADDED Requirements

### Requirement: Notificação da equipe a cada pedido em ERRO
Sempre que o worker marcar um pedido como `status = 'ERRO'`, ele SHALL notificar a equipe pelo
canal de Telegram já usado para os avisos de saúde da impressora (`TELEGRAM_BOT_TOKEN` e
`TELEGRAM_CHAT_ID`), em uma mensagem por ocorrência.

A mensagem SHALL conter, no mínimo:
1. o **protocolo** do pedido — os 8 primeiros caracteres do UUID em maiúsculas, idênticos aos
   exibidos pela view `fila_publica` ao cliente;
2. o **motivo** da falha, na mesma granularidade registrada no log (download, PDF inválido,
   divergência de páginas, nenhuma fila aceitou, timeout, ou divergência de folhas na conferência);
3. o **esperado** para o pedido: páginas × cópias e o total de folhas;
4. as **folhas efetivamente impressas**, quando houver prova;
5. a **fila** e o **job id**, quando o job chegou a ser submetido;
6. o **comando de reimpressão** correspondente ao protocolo.

O número de folhas impressas SHALL refletir apenas o que é comprovado: `0` quando a falha ocorreu
antes de qualquer submissão à impressora, o delta do contador do motor quando a conferência de
folhas foi executada, e uma indicação explícita de **não confirmado** quando não há leitura válida
— notadamente no timeout, em que o job pode continuar em voo e o equipamento não pode ser
consultado. O worker NÃO SHALL estimar ou inferir esse número.

A notificação SHALL ser best-effort e posterior à marcação de status: envs ausentes, Bot API
indisponível ou falha de rede SHALL apenas gerar log, sem alterar o status do pedido, sem levantar
exceção e sem interromper o ciclo do worker.

#### Scenario: Divergência de folhas na conferência avisa com o que saiu
- **WHEN** um pedido de 11 páginas × 2 cópias conclui na fila mas o contador do motor acusa 30
  folhas gastas
- **THEN** o pedido é marcado como `ERRO` e a equipe recebe uma mensagem com o protocolo, o motivo
  da divergência, o esperado (22 folhas), as 30 folhas impressas, a fila/job e o comando de
  reimpressão

#### Scenario: Falha antes da submissão informa zero folhas
- **WHEN** o download do PDF falha, o PDF é inválido, a contagem de páginas diverge do declarado ou
  nenhuma fila aceita o job
- **THEN** a mensagem informa `0` folha(s) impressa(s), deixando claro que nada foi consumido na
  impressora

#### Scenario: Timeout não inventa número de folhas
- **WHEN** o job é aceito pela fila mas não conclui dentro de `PRINT_TIMEOUT` e é cancelado
- **THEN** a mensagem informa que o total impresso não foi confirmado, e o worker não consulta o
  contador do equipamento nessa janela

#### Scenario: Telegram indisponível não altera o desfecho do pedido
- **WHEN** `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` não estão configuradas ou a chamada à Bot API
  falha
- **THEN** o pedido permanece marcado como `ERRO`, a tentativa de aviso é registrada em log e o
  worker segue para o próximo ciclo normalmente
