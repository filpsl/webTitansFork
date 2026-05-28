# Print Worker — HP Laser MFP 135w

Serviço Python que roda na máquina da sede ligada à impressora. Ele consome pedidos
**PAGO** da tabela `fila_impressao` do Supabase, baixa o PDF do bucket privado,
reconfere a contagem de páginas, imprime via CUPS e marca o pedido como **IMPRESSO**
(ou **ERRO** em caso de falha).

Fluxo de status: `PAGO` → `IMPRIMINDO` (claim atômico) → `IMPRESSO` / `ERRO`.

> **NUNCA** commite o `.env` com valores reais. Ele contém a `service_role` key, que
> dá acesso total ao projeto Supabase. Mantenha-o com permissão `0600`.

## Pré-requisitos

Antes de tudo, a migration `supabase/migrations/0004_print_worker.sql` precisa ter sido
rodada no Supabase (adiciona o status `IMPRIMINDO`).

Na máquina (Linux):

1. **CUPS + driver da HP Laser 135w (HPLIP).**
   ```bash
   sudo apt install cups hplip
   sudo systemctl enable --now cups
   # Detecta e instala a impressora (USB ou rede):
   hp-setup
   ```
2. **Confirme a fila e imprima um teste manual:**
   ```bash
   lpstat -p              # lista as filas; anote o nome exato (PRINTER_NAME)
   lp -d <PRINTER_NAME> /usr/share/cups/data/testprint
   ```
   Se sair papel, o CUPS está ok.

3. **Python 3.10+** disponível.

## Instalação do worker

```bash
# Coloque o worker em um caminho estável (ex.: /opt/print-worker).
sudo cp -r print-worker /opt/print-worker
cd /opt/print-worker

# Ambiente virtual + dependências.
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Configuração (NUNCA commitar este arquivo).
cp .env.example .env
chmod 600 .env
# edite .env e preencha SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRINTER_NAME
```

Teste rodando em primeiro plano antes de instalar como serviço:
```bash
set -a; source .env; set +a
.venv/bin/python worker.py
```

## Serviço systemd

```bash
# Edite o unit: ajuste User=, WorkingDirectory=, EnvironmentFile=, ExecStart=.
sudo cp print-worker.service /etc/systemd/system/print-worker.service
sudo nano /etc/systemd/system/print-worker.service

sudo systemctl daemon-reload
sudo systemctl enable --now print-worker

# Acompanhar logs:
journalctl -u print-worker -f
```

O serviço tem `Restart=always`: sobe no boot e se recupera de crashes. Pedidos presos
em `IMPRIMINDO` por mais de `STUCK_TIMEOUT` (padrão 15 min) voltam sozinhos para `PAGO`.

## Configuração (.env)

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `SUPABASE_URL` | sim | — | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | — | service_role key (segredo; bypassa RLS) |
| `PRINTER_NAME` | sim | — | Nome da fila CUPS (`lpstat -p`) |
| `POLL_INTERVAL` | não | `10` | Segundos entre consultas à fila |
| `PRINT_TIMEOUT` | não | `180` | Segundos de espera pela conclusão do job |
| `STUCK_TIMEOUT` | não | `900` | Segundos até re-filar um pedido travado em IMPRIMINDO |

## Operação: pedidos em ERRO

O worker marca `status = 'ERRO'` (sem retry automático) quando:

- o **download** do PDF falha após retentativas;
- o **PDF é inválido/criptografado**;
- a **contagem real de páginas diverge** de `num_paginas` (proteção contra fraude);
- a **impressão não conclui** dentro de `PRINT_TIMEOUT` (impressora offline, sem papel,
  atolada).

Tratamento manual de um pedido em `ERRO`:

1. Veja o motivo nos logs: `journalctl -u print-worker | grep <id-do-pedido>`.
2. Resolva a causa (papel/toner/atolamento, ou contato com o cliente se o PDF for inválido).
3. Para reimprimir um pedido cuja causa foi resolvida, volte-o para `PAGO` no Supabase
   (Table Editor ou SQL): `update fila_impressao set status='PAGO' where id='<id>';` —
   o worker o pegará no próximo ciclo.
4. Pedidos com PDF realmente inválido ou divergência de páginas devem permanecer em
   `ERRO` e ser tratados com o cliente (reembolso/contato).

> Pedidos em `IMPRIMINDO` não voltam sozinhos antes do `STUCK_TIMEOUT`; se precisar
> reprocessar imediatamente, mude o status para `PAGO` manualmente.

## Limitações conhecidas

- A 135w é **monocromática**. Pedidos `COLORIDO` (legados) são impressos em tons de
  cinza, com aviso no log. A remoção da opção COLORIDO do checkout é uma mudança separada.
- O worker confirma que o CUPS **concluiu** o job, não a qualidade física da impressão.
