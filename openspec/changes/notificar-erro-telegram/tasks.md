# Tasks — notificar-erro-telegram

## 1. Envio genérico ao Telegram

- [x] 1.1 Extrair `enviar_telegram(cfg, texto)` de `enviar_aviso_telegram`: mesmo `sendMessage`
      best-effort (envs ausentes/falha de rede só logam, nunca levantam)
- [x] 1.2 Manter `enviar_aviso_telegram(cfg, linhas)` como o aviso de SAÚDE, agora delegando ao
      envio genérico — nenhuma mudança no texto que a equipe já recebe

## 2. Mensagem de ERRO

- [x] 2.1 `protocolo_do_pedido(pedido_id)`: 8 primeiros caracteres do UUID em maiúsculas, mesma
      derivação da view `fila_publica`
- [x] 2.2 `mensagem_erro_pedido(pedido, motivo, *, fila, job_id, folhas_impressas)` — função pura:
      protocolo, motivo, esperado (páginas × cópias = folhas), folhas impressas
      (`não confirmado` quando `None`), fila/job e `/reimprimir <protocolo>`
- [x] 2.3 `falhar_pedido(sb, cfg, pedido, motivo, ...)`: marca `ERRO` primeiro, avisa depois

## 3. Integração nos caminhos de falha

- [x] 3.1 Substituir os seis `mark(sb, pedido_id, "ERRO")` de `processar()` por `falhar_pedido`
      com o motivo específico de cada um
- [x] 3.2 Falhas pré-submissão (download, PDF inválido, divergência de páginas, nenhuma fila
      aceitou) informam `folhas_impressas=0`
- [x] 3.3 Conferência de folhas informa o delta do contador do motor (`folhas_motor`), fila e job
- [x] 3.4 Timeout NÃO informa folhas (job possivelmente em voo — a regra de não consultar o
      equipamento durante o job, de df1b9f8, continua valendo)

## 4. Testes e documentação

- [x] 4.1 Testes de `mensagem_erro_pedido` (conteúdo, singular/plural de cópias, `não confirmado`)
      e de `protocolo_do_pedido` em `test_worker_parsers.py`
- [x] 4.2 Teste de `enviar_telegram` sem envs: não toca a rede e não levanta
- [x] 4.3 README do worker: seção "Aviso de ERRO no Telegram" com exemplo da mensagem, e envs de
      Telegram descritas como cobrindo saúde + ERRO
