# Conferência tolerante a papel — parar de aprovar o que não saiu e de reprovar o que ainda vai sair

## Why

A conferência de folhas erra dos dois lados, e os dois erros foram medidos em produção no
mesmo dia:

**Aprova o que não saiu.** O pedido `44C56F93` entregou 1 folha de 2 (o papel acabou no
meio) e foi marcado `IMPRESSO`. A leitura do contador do motor se perdeu no meio da espera
— `folhas_gastas_pelo_motor` devolvia `None` e **apagava o delta já medido** a cada
leitura falha — e o veredito caiu no `job-media-sheets-completed` do cupsd local, que em
fila `socket://` é carimbo: registrou 35 folhas nos jobs 219 e 221 (o motor provou 12 e
26) e 2 folhas no job 224 (saiu 1). A leitura provavelmente se perdeu porque
`paginas_do_motor` refazia `resolver_host` a cada 2 s, e `getent hosts <ip>` é uma
resolução REVERSA que sai na rede mesmo para o IP literal do device-uri.

**Reprova o que ainda ia sair.** O teto fixo de 60 s da espera reprovou um pedido de 35
páginas que estava apenas demorando (~100 s de impressão) e cujo papel foi reposto a
tempo: a impressora concluiu o job, o worker já tinha marcado `ERRO`, e a reimpressão
gastou 35 folhas à toa.

Falta de papel no meio de um job não é falha: é uma pausa que um humano resolve repondo
papel. O sistema precisa esperar por isso.

## What Changes

- A espera pelo motor passa a ser guiada por **progresso**, não por relógio: enquanto o
  contador sobe, o worker espera o tempo que o job precisar.
- **Tolerância a falta de papel** (`PAPER_WAIT_TIMEOUT`, padrão 600 s): com a bandeja
  vazia e o job incompleto, o pedido continua em `IMPRIMINDO`, a equipe é avisada pelo
  canal de saúde já existente, e a reposição do papel faz o job terminar como `IMPRESSO`.
  O sensor da bandeja só ESTENDE a paciência — nunca a encurta.
- Uma leitura SNMP que falha **não apaga** a medição já feita; `None` passa a significar
  apenas "nunca deu para ler".
- IP literal não é mais resolvido por consulta de rede.
- O `job-media-sheets-completed` do cupsd local perde o poder de aprovar: sem prova do
  equipamento, o desfecho é "não verificado". O pedido segue `IMPRESSO` (reprovar sem
  prova custaria uma reimpressão) e a equipe recebe um aviso de que aquele ficou sem
  conferência.
- `STUCK_TIMEOUT` sobe de 900 s para 1200 s para caber a nova janela de espera.

## Capabilities

### New Capabilities

_Nenhuma — a mudança altera requisitos da capability existente `print-worker`._

### Modified Capabilities

- `print-worker`: a conferência do que foi impresso passa a exigir prova do equipamento
  para aprovar, e a espera pelo desfecho passa a tolerar reposição de papel.

## Impact

- `print-worker/worker.py`: `resolver_host` (IP literal), `aguardar_folhas_do_motor` +
  `decidir_espera` + `bandeja_vazia` (substituem `folhas_gastas_pelo_motor` e o teto
  `ESPERA_MOTOR_ESTABILIZAR`), `conferir_folhas` (devolve `Veredito`),
  `avisar_sem_conferencia`, `Heartbeat.reportar_fisico`, `processar`.
- `print-worker/test_worker_parsers.py`: política de espera, sensor da bandeja, IP
  literal e o veredito sem prova.
- `print-worker/README.md` e `.env.example`: nova env `PAPER_WAIT_TIMEOUT`, novo
  `STUCK_TIMEOUT` e a seção "Conferência do que a impressora realmente imprimiu".
- Sem mudança de banco, de API ou de front-end.
