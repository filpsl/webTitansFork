## Context

O web-to-print já leva o pedido até `status = 'PAGO'` na tabela `fila_impressao` do
Supabase (PDF no bucket privado `pdfs-impressao`, valor e páginas confirmados). O que
falta é o consumidor físico: um processo na máquina da sede, ligada à **HP Laser MFP
135w**, que pegue os pedidos pagos e imprima.

Restrições conhecidas:
- A máquina roda **Linux**; a impressão padrão do ecossistema Linux é **CUPS** (`lp`).
- A **HP Laser MFP 135w é monocromática** — não imprime cor.
- O bucket é **privado**; baixar o PDF exige a **`service_role` key** (server-side).
- A `fila_impressao.status` hoje só aceita `AGUARDANDO_PAGAMENTO`, `PAGO`, `IMPRESSO`,
  `ERRO`, `CANCELADO` (constraint `CHECK`).
- Rede de sede pode ser instável; o worker precisa tolerar quedas e reiniciar sozinho.
- A contagem de páginas (`num_paginas`) pode ter sido informada pelo cliente (no fluxo
  não-endurecido), então não é totalmente confiável.

## Goals / Non-Goals

**Goals:**
- Imprimir automaticamente cada pedido `PAGO`, exatamente uma vez, na 135w.
- Garantir claim atômico para suportar reinícios e (eventualmente) múltiplas instâncias.
- Reconferir a contagem real de páginas antes de imprimir; recusar (ERRO) se divergir.
- Marcar `IMPRESSO`/`printed_at` no sucesso e `ERRO` na falha, com logs claros.
- Recuperar pedidos travados em `IMPRIMINDO` (ex.: queda de energia no meio).
- Rodar de forma resiliente como serviço systemd (restart automático).

**Non-Goals:**
- Remover a opção COLORIDO do checkout do site (mudança companheira separada).
- Reembolso/cancelamento automático de pedidos com erro (tratamento manual por ora).
- Suporte multiplataforma (Windows/macOS) — só Linux/CUPS neste escopo.
- Notificar o cliente sobre a impressão (fora do escopo atual).
- Frente/verso, grampeamento ou seleção de bandeja — impressão simples por enquanto.

## Decisions

### D1. Detecção por polling, não Realtime
O worker consulta a cada `POLL_INTERVAL` (padrão 10s) por `status = 'PAGO'` ordenado por
`paid_at` (FIFO). **Alternativa considerada:** Supabase Realtime (websocket) para latência
quase zero. **Por quê polling:** numa máquina caseira com rede instável, um websocket que
cai silenciosamente faz o worker "dormir" sem perceber; polling é stateless, trivial de
reiniciar e a latência de poucos segundos é irrelevante para impressão física.

### D2. Claim atômico via novo status `IMPRIMINDO`
Migration adiciona `IMPRIMINDO` ao `CHECK` de `status`. O worker reivindica um pedido com:
```sql
UPDATE fila_impressao SET status='IMPRIMINDO'
 WHERE id = :id AND status = 'PAGO' RETURNING *;
```
Só uma execução recebe a linha de volta; as demais veem 0 linhas e ignoram. **Alternativas:**
(a) coluna `claimed_at` — mantém o status `PAGO`, mas exige nova coluna e lógica extra para
distinguir "pago e parado" de "pago e sendo impresso"; (b) sem schema — confiar em instância
única, frágil. **Por quê `IMPRIMINDO`:** explícito, visível no painel, e habilita a detecção
de jobs travados (D7).

### D3. Impressão via CUPS (`lp`), driver HPLIP
O worker chama o binário `lp` do sistema: `lp -d $PRINTER_NAME -n 1 <arquivo.pdf>`. **Por quê
shell-out em vez de lib Python:** CUPS é o caminho nativo e estável no Linux; libs Python de
impressão (pycups) adicionam build/headers sem ganho real. O driver da 135w é instalado via
**HPLIP** (`hp-setup`), pré-requisito operacional documentado no README.

### D4. Confirmar conclusão pelo CUPS, com timeout
`lp` retorna um **job id** assim que o CUPS aceita o trabalho (não significa "impresso"). O
worker captura o id e faz polling de `lpstat -W completed -o $PRINTER_NAME` (ou checa se o id
sumiu de `not-completed`) até concluir ou estourar `PRINT_TIMEOUT` (padrão 180s). Conclusão →
`IMPRESSO`; timeout/erro (impressora offline, sem papel, atolada) → `ERRO` + tentativa de
`cancel` do job. **Por quê:** marcar `IMPRESSO` logo após `lp` mentiria se a impressora
estivesse offline; o cliente acharia que pode retirar.

### D5. Reconferência de páginas com `pypdf`
Antes de imprimir, baixa o PDF em memória, conta páginas com `pypdf`
(`len(PdfReader(buf).pages)`). Se o PDF for ilegível/criptografado, ou se a contagem divergir
de `num_paginas`, marca `ERRO` e **não imprime**. Grava a contagem real observada no log.
**Por quê:** defesa-em-profundidade contra fraude de páginas — mesmo que o pedido tenha sido
criado no fluxo não-endurecido (onde `num_paginas` veio do cliente), o worker não desperdiça
papel imprimindo um PDF de 500 páginas declarado como 1.

### D6. Impressora mono — COLORIDO vira cinza + aviso
A 135w só imprime PB. O worker não diferencia modo de cor no `lp` (a impressora rasteriza em
cinza de qualquer forma). Para pedidos `COLORIDO` (legados, antes da remoção no checkout) ele
**loga um aviso** mas imprime normalmente. **Por quê:** rejeitar travaria pedidos já pagos; a
solução de verdade é remover COLORIDO do checkout (mudança companheira).

### D7. Recuperação de jobs travados em IMPRIMINDO
No início de cada ciclo, antes de pegar novos pedidos, o worker procura linhas em
`IMPRIMINDO` com `paid_at`/marca de claim mais antiga que `STUCK_TIMEOUT` (padrão 15 min) e as
devolve para `PAGO` (re-fila) ou `ERRO` após N reciclagens. **Por quê:** se a máquina cair
entre o claim e o fim da impressão, o pedido ficaria preso em `IMPRIMINDO` para sempre. Como
não há coluna de timestamp de claim, usar `paid_at` como aproximação inicial; o design pode
adicionar `claimed_at` se a precisão importar (ver Open Questions).

### D8. Runtime: Python 3 + `supabase-py`, serviço systemd
Worker em `print-worker/` no mesmo repo. Dependências mínimas: `supabase` (REST/Storage) e
`pypdf`. Roda como serviço systemd com `Restart=always` para subir no boot e se recuperar de
crashes. Config por variáveis de ambiente (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`PRINTER_NAME`, `POLL_INTERVAL`, etc.) lidas de um arquivo `EnvironmentFile` com permissão
`0600`. **Por quê systemd:** padrão Linux para serviços de longa duração; logs vão pro
journald automaticamente.

## Risks / Trade-offs

- **service_role key na máquina da sede** → arquivo de env com `0600`, dono = usuário do
  serviço, nunca commitado; rotacionar se vazar. A key dá acesso total ao projeto Supabase.
- **`lp` reporta sucesso mas a impressão sai borrada/incompleta** → fora do que software
  detecta; mitigado parcialmente pelo timeout e pela revisão humana na retirada. Aceito.
- **Pedido em ERRO precisa de ação manual** (sem reembolso automático) → documentar processo
  operacional; aceitável no MVP.
- **Polling gera carga constante no Supabase** → intervalo de 10s e índice em `status` (já
  existe) tornam o custo desprezível no plano free.
- **Recuperação por `paid_at` pode re-filar um job que ainda está imprimindo lentamente** →
  `STUCK_TIMEOUT` de 15 min é folgado para a 135w; se virar problema, adotar `claimed_at`.
- **Duas instâncias imprimindo** → o claim atômico (D2) já protege contra impressão dupla.

## Migration Plan

1. Aplicar a migration que adiciona `IMPRIMINDO` ao `CHECK` de `status` no Supabase (prod).
   *Rollback:* reverter o `CHECK` para o conjunto anterior (só possível se não houver linhas
   em `IMPRIMINDO`).
2. Na máquina da sede: instalar CUPS + driver HPLIP da 135w, confirmar impressão de teste
   manual (`lp -d <fila> teste.pdf`).
3. Instalar o worker: clonar repo, `pip install -r requirements.txt`, criar o arquivo de env
   (`0600`) com a `service_role` key e o nome da fila CUPS.
4. Instalar e habilitar o unit systemd; `systemctl start print-worker`; acompanhar
   `journalctl -u print-worker -f`.
5. Teste end-to-end: criar um pedido real de R$ baixo, pagar, confirmar impressão e
   `status = 'IMPRESSO'`.
   *Rollback do worker:* `systemctl stop print-worker` — pedidos voltam a só acumular em
   `PAGO`, nada é perdido.

## Open Questions

- Adicionar coluna `claimed_at` (e talvez `worker_id`) para detecção de travamento mais
  precisa do que usar `paid_at`? Decisão adiável até observar comportamento real.
- Política para pedidos `ERRO`: quantas retentativas automáticas antes de exigir ação
  manual? Proposta inicial: sem retry automático em erro de impressão; só re-fila em
  travamento (IMPRIMINDO órfão).
- A migration `IMPRIMINDO` deve coexistir com as migrations do hardening (0002/0003 noutra
  branch) — definir numeração final no momento do apply.
