## ADDED Requirements

### Requirement: Banco opera no fuso de Brasília

O banco Postgres SHALL operar no fuso `America/Sao_Paulo`, de modo que `now()::timestamp` e a exibição de colunas `timestamptz` reflitam o horário de Brasília. As colunas `timestamptz` SHALL continuar armazenando UTC internamente; a configuração não altera dados já gravados, nem o agendamento da limpeza, nem os intervalos de retenção.

#### Scenario: Horário apresentado em Brasília
- **WHEN** uma query lê `now()` ou uma coluna `timestamptz` sem conversão explícita de fuso
- **THEN** o valor é apresentado no fuso `America/Sao_Paulo`

#### Scenario: Dados e cron preservados
- **WHEN** a configuração de timezone é aplicada
- **THEN** os timestamps já gravados (em UTC) permanecem corretos e o job de limpeza continua executando de hora em hora
