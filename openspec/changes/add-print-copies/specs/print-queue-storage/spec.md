## MODIFIED Requirements

### Requirement: Tabela `fila_impressao` no Supabase

O Supabase SHALL conter uma tabela `fila_impressao` com os seguintes campos: `id` (uuid, primary key, default `gen_random_uuid()`), `created_at` (timestamptz default now()), `pdf_path` (text not null), `num_paginas` (int not null check >0), `quantidade_copias` (int not null default 1 check >=1), `modo_cor` (text not null check in ('PB','COLORIDO')), `valor_centavos` (int not null check >0), `status` (text not null default 'AGUARDANDO_PAGAMENTO' check in ('AGUARDANDO_PAGAMENTO','PAGO','IMPRESSO','ERRO','CANCELADO')), `mp_payment_id` (text nullable), `mp_preference_id` (text nullable), `paid_at` (timestamptz nullable), `printed_at` (timestamptz nullable).

#### Scenario: Schema criado conforme migração
- **WHEN** a migração SQL é executada em um banco limpo
- **THEN** `\d fila_impressao` mostra exatamente esses campos com os check constraints, incluindo `quantidade_copias int not null default 1 check (quantidade_copias >= 1)`

#### Scenario: Linha com status inválido é rejeitada
- **WHEN** tenta-se inserir `status='RECUSADO'`
- **THEN** o Postgres rejeita por check constraint

#### Scenario: Quantidade de cópias inválida é rejeitada
- **WHEN** tenta-se inserir `quantidade_copias = 0`
- **THEN** o Postgres rejeita por check constraint

#### Scenario: Pedido legado sem quantidade assume 1
- **WHEN** um INSERT não informa `quantidade_copias`
- **THEN** o Postgres aplica o default `1`

### Requirement: Políticas RLS para INSERT anônimo restrito

O Supabase SHALL ter RLS habilitado em `fila_impressao` com policy que permite ao role `anon` somente `INSERT` com `WITH CHECK (status = 'AGUARDANDO_PAGAMENTO' AND mp_payment_id IS NULL AND paid_at IS NULL AND printed_at IS NULL AND quantidade_copias >= 1)`.

#### Scenario: Cliente anônimo insere pedido inicial
- **WHEN** o frontend insere linha com status `AGUARDANDO_PAGAMENTO` e `quantidade_copias = 2` usando anon key
- **THEN** o insert é aceito

#### Scenario: Cliente anônimo tenta inserir já como PAGO
- **WHEN** o frontend tenta inserir linha com `status='PAGO'`
- **THEN** o insert é negado pela RLS

#### Scenario: Cliente anônimo tenta inserir quantidade inválida
- **WHEN** o frontend tenta inserir linha com `quantidade_copias = 0` usando anon key
- **THEN** o insert é negado (pela RLS e/ou pelo check constraint)
