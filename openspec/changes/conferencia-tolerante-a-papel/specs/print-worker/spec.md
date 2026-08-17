# Delta — print-worker (conferencia-tolerante-a-papel)

## MODIFIED Requirements

### Requirement: Conferência do que a impressora realmente imprimiu
Antes de marcar um pedido como `IMPRESSO`, o worker SHALL conferir quantas folhas a
impressora produziu, comparando o delta do contador de vida do motor (SNMP
`prtMarkerLifeCount`, lido antes da submissão e acompanhado até o fim do job) com
`páginas × cópias`.

O delta do contador do motor SHALL ser a única evidência capaz de **aprovar** um pedido. A
contagem do cupsd local (`job-media-sheets-completed`) SHALL poder apenas **condenar**: em
fila `socket://` ela reflete o que o filtro empurrou para o socket, não o que o
equipamento produziu.

Quando não houver nenhuma leitura do contador, o pedido SHALL ser marcado `IMPRESSO` e a
equipe SHALL ser notificada de que aquele pedido ficou **sem conferência**. O worker NÃO
SHALL marcar `ERRO` por ausência de prova.

Uma leitura SNMP que falhe no meio do acompanhamento NÃO SHALL descartar as medições já
feitas: o worker SHALL manter o maior delta lido e seguir acompanhando.

O worker NÃO SHALL resolver por consulta de rede um host que já esteja em forma de
endereço IP literal.

#### Scenario: Contagem local não aprova job de fila socket
- **WHEN** um job de 2 folhas em fila `socket://` é registrado pelo cupsd como `completed`
  com `job-media-sheets-completed = 2`, mas não há leitura do contador do motor
- **THEN** o pedido é marcado `IMPRESSO` como "não verificado" e a equipe recebe o aviso de
  pedido impresso sem conferência

#### Scenario: Leitura falha no meio não apaga a medição
- **WHEN** o contador é lido com sucesso, uma leitura seguinte falha e as posteriores
  voltam a funcionar
- **THEN** o veredito usa o delta medido, e não "sem leitura"

### Requirement: Espera pelo desfecho do job guiada por progresso
A espera pelo motor terminar o job SHALL ser limitada por **ausência de progresso**, e não
por um teto fixo de tempo: enquanto o contador do motor subir, o worker SHALL continuar
esperando, independentemente do tamanho do pedido.

O worker SHALL aprovar o pedido apenas quando o delta alcançar o total esperado **e** o
contador parar de subir, de modo a detectar despejo de folhas ainda em curso.

Falta de papel durante um job NÃO SHALL ser tratada como falha enquanto houver tolerância:
com a bandeja vazia (`prtInputCurrentLevel = 0`) e o job incompleto, o pedido SHALL
permanecer em `IMPRIMINDO` por até `PAPER_WAIT_TIMEOUT`, e o estado `SEM_PAPEL` SHALL ser
publicado em `impressora_status` e notificado à equipe para que alguém reponha o papel. Se
o papel for reposto e a impressora concluir o job dentro da tolerância, o pedido SHALL ser
marcado `IMPRESSO`.

O sensor da bandeja SHALL apenas estender a espera; ele NÃO SHALL, em nenhuma hipótese,
antecipar a marcação de `ERRO`.

Parada do contador abaixo do esperado **sem** falta de papel (job cancelado no painel,
atolamento) SHALL levar o pedido a `ERRO` após uma janela curta, informando quantas folhas
saíram.

`STUCK_TIMEOUT` SHALL ser maior que `PRINT_TIMEOUT + PAPER_WAIT_TIMEOUT` somados à janela
curta, para que um restart do worker durante a espera não devolva o pedido a `PAGO` e o
reimprima.

#### Scenario: Papel reposto salva o pedido
- **WHEN** o papel acaba com 26 de 35 folhas impressas e é reposto 3 minutos depois, e a
  impressora conclui as 9 folhas restantes
- **THEN** o pedido permanece em `IMPRIMINDO` durante a espera e termina como `IMPRESSO`,
  sem reimpressão

#### Scenario: Pedido grande não é reprovado por demorar
- **WHEN** um pedido de 35 folhas leva mais de 60 segundos para ser impresso, com o
  contador do motor subindo continuamente
- **THEN** o worker continua esperando e o pedido é aprovado ao final

#### Scenario: Papel não reposto dentro da tolerância
- **WHEN** o papel acaba com 1 de 2 folhas impressas e ninguém repõe dentro de
  `PAPER_WAIT_TIMEOUT`
- **THEN** o pedido é marcado `ERRO` com motivo específico de falta de papel e o aviso
  informa que saíram 1 de 2 folhas
