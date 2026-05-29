# 07 — Operação (runbook)

[← Índice](README.md)

Guia prático para quem opera a impressão na sede. O passo a passo completo de instalação
está em `print-worker/README.md`; aqui fica o essencial e o dia a dia.

## Instalar o worker na sede

**Pré-requisito:** a migration `supabase/migrations/0004_print_worker.sql` precisa ter sido
rodada no Supabase (adiciona o status `IMPRIMINDO`). Sem ela, o claim atômico viola o
CHECK constraint.

1. **CUPS + driver HP (HPLIP):**
   ```bash
   sudo apt install cups hplip
   sudo systemctl enable --now cups
   hp-setup                 # detecta/instala a 135w (USB ou rede)
   lpstat -p                # anote o nome exato da fila → PRINTER_NAME
   lp -d <PRINTER_NAME> /usr/share/cups/data/testprint   # teste físico
   ```
2. **Worker em caminho estável + venv:**
   ```bash
   sudo cp -r print-worker /opt/print-worker
   cd /opt/print-worker
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   cp .env.example .env && chmod 600 .env
   # edite .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRINTER_NAME
   ```
3. **systemd:**
   ```bash
   sudo cp print-worker.service /etc/systemd/system/print-worker.service
   sudo nano /etc/systemd/system/print-worker.service   # ajuste User=, paths
   sudo systemctl daemon-reload
   sudo systemctl enable --now print-worker
   journalctl -u print-worker -f
   ```

## Atualizar o worker após uma correção

O worker quase sempre muda só código (`worker.py`); só é preciso recriar a `.venv` quando
o `requirements.txt` muda.

**Se `/opt/print-worker` foi instalado por cópia (`cp`):** leve o `worker.py` novo até a
máquina e
```bash
sudo cp /caminho/worker.py /opt/print-worker/worker.py
sudo chown <usuario-de-servico>:<usuario-de-servico> /opt/print-worker/worker.py
sudo systemctl restart print-worker
```

**Se `/opt/print-worker` for um clone git:**
```bash
sudo -u <usuario-de-servico> git -C /opt/print-worker pull
sudo systemctl restart print-worker
```
(`-C` roda o git dentro da pasta; `sudo -u` mantém os arquivos com o dono certo.)

## Pedidos em `ERRO`

O worker marca `ERRO` (sem retry automático) quando: o download falha após retentativas; o
PDF é inválido/criptografado; **a contagem real diverge** de `num_paginas`; ou a impressão
não conclui dentro de `PRINT_TIMEOUT` (impressora offline, sem papel, atolada).

**Diagnóstico:**
```bash
journalctl -u print-worker | grep <id-do-pedido>
```
A linha de log indica a causa (download, PDF inválido, divergência, timeout).

**Tratamento:**

- **Causa resolvível** (papel/toner/atolamento, impressora estava offline): volte o pedido
  para a fila —
  ```sql
  update fila_impressao set status='PAGO' where id='<id>';
  ```
  o worker o pega no próximo ciclo.
- **PDF inválido ou divergência de páginas:** mantenha em `ERRO` e trate com o cliente
  (reembolso/contato). Não force a impressão.
- **Já imprimiu mas ficou `ERRO`** (ex.: falhou só o parsing pós-impressão): marque como
  impresso para não reimprimir —
  ```sql
  update fila_impressao set status='IMPRESSO', printed_at=now() where id='<id>';
  ```

> Pedidos presos em `IMPRIMINDO` voltam sozinhos para `PAGO` só após `STUCK_TIMEOUT`
> (padrão 15 min). Para reprocessar antes, mude o status para `PAGO` manualmente.

## Monitoramento no dia a dia

- **Logs ao vivo:** `journalctl -u print-worker -f`.
- **Saúde do serviço:** `systemctl status print-worker`.
- **Fila da impressora:** `lpstat -o <PRINTER_NAME>`.
- **Fila de pedidos:** no Supabase, observar linhas em `PAGO` que não avançam (worker
  parado?) e acúmulo de `ERRO`.
- **Worker fantasma:** garanta que o worker rode em **uma** máquina só. Uma instância
  esquecida (ex.: num notebook) compete pelos pedidos e pode gerar `ERRO`/estados
  inesperados. O claim atômico evita impressão dupla, mas dois workers ainda confundem o
  diagnóstico.

---

Anterior: [06 — Print worker](06-print-worker.md) · Próximo: [08 — Segurança](08-seguranca.md)
