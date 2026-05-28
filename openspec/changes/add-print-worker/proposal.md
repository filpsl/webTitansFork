## Why

O fluxo web-to-print hoje termina no banco: um pedido pago fica com `status = 'PAGO'`
na tabela `fila_impressao`, mas nada o transforma em papel. Falta o elo final — um
serviço que rode na máquina da sede, ligada à impressora **HP Laser MFP 135w**, que
detecte pedidos pagos, baixe o PDF e imprima automaticamente, fechando o ciclo do
cliente sem intervenção manual.

## What Changes

- **Novo worker Python** (`print-worker/`) que roda como serviço **systemd** numa
  máquina **Linux** conectada à HP Laser MFP 135w.
- **Detecção por polling**: consulta o Supabase a cada N segundos por pedidos
  `status = 'PAGO'`, ordenados por `paid_at` (FIFO).
- **Claim atômico** via novo status `IMPRIMINDO`: o worker faz
  `UPDATE ... SET status='IMPRIMINDO' WHERE id=:id AND status='PAGO'` para garantir
  que cada pedido é impresso **exatamente uma vez**, mesmo com mais de uma instância.
  **BREAKING** no schema: o `CHECK` de `status` passa a aceitar `IMPRIMINDO` (migration).
- **Download seguro** do PDF do bucket privado `pdfs-impressao` usando a
  `service_role` key (server-side, nunca exposta no cliente).
- **Defesa de fraude de páginas**: antes de imprimir, o worker reconfere a contagem
  real de páginas do PDF; se divergir de `num_paginas`, marca `status = 'ERRO'` e não
  imprime (defesa-em-profundidade recomendada pelo hardening).
- **Impressão via CUPS** (`lp`/`lpr`) na fila da 135w. Como a 135w é monocromática,
  todo job é impresso em PB. Pedidos `COLORIDO` legados são impressos em tons de cinza
  com aviso no log (a remoção da opção COLORIDO do checkout é uma mudança separada).
- **Conclusão e erros**: ao terminar, `status = 'IMPRESSO'` com `printed_at = now()`;
  em falha de impressão ou PDF inválido, `status = 'ERRO'` para tratamento manual.
- **Recuperação de jobs travados**: pedidos presos em `IMPRIMINDO` há mais de um
  limite (ex.: 15 min) voltam para `PAGO` (ou vão para `ERRO`) para nova tentativa.

## Capabilities

### New Capabilities
- `print-worker`: serviço autônomo que consome pedidos pagos da `fila_impressao`,
  imprime o PDF na HP Laser MFP 135w via CUPS e atualiza o status do pedido, com claim
  atômico, reconferência de páginas e tratamento de erros/retentativas.

### Modified Capabilities
<!-- Nenhuma capability canônica existe ainda em openspec/specs/; nenhum requisito de spec existente muda. -->

## Impact

- **Banco (Supabase)**: nova migration adicionando o status `IMPRIMINDO` ao `CHECK` de
  `fila_impressao.status`. Sem mudança nas policies RLS (o worker usa `service_role`,
  que bypassa RLS).
- **Novo diretório** `print-worker/` no repositório: código Python, `requirements.txt`,
  `.env.example`, unit file systemd e README de instalação. (Decisão registrada:
  fica no mesmo repo, não em repositório separado.)
- **Dependências Python**: `supabase` (cliente), `pypdf` (contagem de páginas).
  Impressão usa o `lp` do CUPS do sistema (sem dependência Python de impressão).
- **Operacional**: a máquina da sede precisa de CUPS + driver da HP Laser 135w
  (HPLIP) configurado, e da `service_role` key do Supabase em variável de ambiente
  protegida (`0600`, fora do bundle, nunca commitada).
- **Segurança**: a `service_role` key passa a existir também na máquina da sede.
  Requer cuidado de permissão de arquivo e rotação se vazar.
- **Mudança companheira (fora deste escopo)**: remover a opção COLORIDO do checkout
  do site, já que a impressora é mono.
