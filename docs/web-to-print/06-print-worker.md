# 06 — Print worker

[← Índice](README.md) · Spec canônica: [`print-worker`](../../openspec/specs/print-worker/spec.md)

## Responsabilidade

Serviço Python que roda na máquina da sede ligada à HP Laser MFP 135w. Em loop: detecta
pedidos `PAGO`, reivindica um por vez (claim atômico), baixa o PDF, **reconfere a contagem
de páginas**, imprime via CUPS e marca `IMPRESSO` (ou `ERRO`). É o elo que transforma um
pedido pago em papel. Não fala com o Mercado Pago nem com o cliente.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `print-worker/worker.py` | O worker completo (loop, claim, download, contagem, impressão). |
| `print-worker/requirements.txt` | Dependências: `supabase`, `pypdf`. |
| `print-worker/.env.example` | Modelo de configuração (sem segredos). |
| `print-worker/print-worker.service` | Unit do systemd. |
| `print-worker/README.md` | Guia de instalação na máquina (resumido em [07](07-operacao.md)). |

## O loop (`main`)

A cada ciclo (`worker.py`):

1. `recuperar_travados` — pedidos presos em `IMPRIMINDO` além de `STUCK_TIMEOUT` voltam
   para `PAGO`.
2. `proximo_pago` — pega o pedido `PAGO` mais antigo por `paid_at` (FIFO), 1 por vez.
3. `reivindicar` — **claim atômico**: `UPDATE ... SET status='IMPRIMINDO' WHERE id=:id AND
   status='PAGO'`. Se afetou 1 linha, este worker venceu e processa; senão, ignora.
4. Se processou, busca o próximo imediatamente; senão, dorme `POLL_INTERVAL` segundos.

Erros transitórios no ciclo são logados e **não** derrubam o worker (o loop continua).

## Processamento de um pedido (`processar`)

1. **Download** (`baixar_pdf`) — baixa `pdf_path` do bucket via `service_role`, com 3
   tentativas. Falhou → `ERRO`.
2. **Contagem real** (`contar_paginas`, via `pypdf`) — PDF criptografado/ilegível → `ERRO`.
3. **Verificação anti-fraude** — se `paginas_reais != num_paginas` → `ERRO` (não imprime).
   O cliente conta páginas no navegador (falsificável); aqui é a autoridade.
4. **Impressão** (`enviar_para_impressora`) — grava o PDF num arquivo temporário e chama
   `lp -d <PRINTER_NAME> -n 1 <arquivo>`. Extrai o job id da saída do CUPS.
5. **Conclusão** (`aguardar_conclusao`) — faz polling com `lpstat -o` até o job sumir da
   fila ou estourar `PRINT_TIMEOUT`. Concluiu → `IMPRESSO` + `printed_at`. Timeout →
   cancela o job e marca `ERRO`.

> Os utilitários do CUPS rodam com `LC_ALL=C` para que a saída do `lp` fique em inglês
> ("request id is ...") e o parsing do job id funcione independentemente do locale da
> máquina.

## Configuração (`.env`)

| Variável | Obrigatória | Padrão | Descrição |
| --- | :---: | --- | --- |
| `SUPABASE_URL` | sim | — | URL do projeto. |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | — | service_role (segredo; bypassa RLS). |
| `PRINTER_NAME` | sim | — | Nome da fila CUPS (`lpstat -p`). |
| `POLL_INTERVAL` | não | `10` | Segundos entre consultas à fila. |
| `PRINT_TIMEOUT` | não | `180` | Segundos de espera pela conclusão do job. |
| `STUCK_TIMEOUT` | não | `900` | Segundos até re-filar um pedido travado em `IMPRIMINDO`. |

Se faltar uma variável obrigatória, o worker encerra na inicialização com mensagem clara.

## systemd

O `print-worker.service` roda o worker como usuário de serviço dedicado, com
`Restart=always` (sobe no boot, recupera de crashes) e `EnvironmentFile` apontando para o
`.env` `0600`. Instalação e operação em [07](07-operacao.md).

## Decisões e pontos de atenção

- **Detecção por polling, não Realtime** — mais robusto a quedas de conexão numa máquina
  de sede e trivial de raciocinar (FIFO).
- **Compatibilidade de Python** — o worker usa `from __future__ import annotations`, então
  roda em Python 3.7+ (não exige 3.10+).
- **A 135w é monocromática** — pedidos `COLORIDO` legados saem em tons de cinza, com aviso
  no log. O worker confirma que o CUPS **concluiu** o job, não a qualidade física da folha.
- **Uma única máquina** — se a sede cai, os pedidos acumulam em `PAGO` e são drenados
  quando o worker volta; o claim atômico e a recuperação de travados garantem retomada
  segura.

---

Anterior: [05 — Armazenamento Supabase](05-supabase.md) · Próximo: [07 — Operação](07-operacao.md)
