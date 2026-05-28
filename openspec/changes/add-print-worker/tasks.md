## 1. Migração SQL — status IMPRIMINDO

- [x] 1.1 Criar a migration que adiciona `IMPRIMINDO` ao `CHECK` de `fila_impressao.status` (drop + recreate do constraint com o novo conjunto de valores).
- [x] 1.2 Definir a numeração final da migration no apply, considerando coexistência com as migrations do hardening (0002/0003) em outra branch.
- [ ] 1.3 Rodar a migration no SQL Editor do Supabase (produção) e confirmar sem erros. *(manual)*

## 2. Estrutura do worker

- [x] 2.1 Criar diretório `print-worker/` com `worker.py`, `requirements.txt`, `.env.example`, `README.md`.
- [x] 2.2 Declarar dependências em `requirements.txt`: `supabase`, `pypdf`.
- [x] 2.3 Criar `.env.example` (sem valores reais) com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PRINTER_NAME`, `POLL_INTERVAL`, `PRINT_TIMEOUT`, `STUCK_TIMEOUT`.
- [x] 2.4 Adicionar `print-worker/.env` ao `.gitignore`.

## 3. Configuração e cliente Supabase

- [x] 3.1 Carregar config de variáveis de ambiente, com defaults (`POLL_INTERVAL=10`, `PRINT_TIMEOUT=180`, `STUCK_TIMEOUT=900`) e falha clara se faltar `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`PRINTER_NAME`.
- [x] 3.2 Inicializar o cliente `supabase-py` com a `service_role` key.
- [x] 3.3 Configurar logging estruturado para stdout (vai pro journald via systemd).

## 4. Loop principal e detecção

- [x] 4.1 Implementar o loop contínuo que dorme `POLL_INTERVAL` entre ciclos e nunca encerra em erro transitório (try/except por ciclo).
- [x] 4.2 Consultar `fila_impressao` por `status = 'PAGO'` ordenado por `paid_at` ascendente (FIFO).

## 5. Claim atômico

- [x] 5.1 Implementar o claim: `UPDATE ... SET status='IMPRIMINDO' WHERE id=:id AND status='PAGO'` retornando a linha.
- [x] 5.2 Se o claim não afetar nenhuma linha (outra execução venceu), ignorar o pedido e seguir.

## 6. Download e reconferência de páginas

- [x] 6.1 Baixar o PDF de `pdfs-impressao` por `pdf_path` para um buffer em memória.
- [x] 6.2 Em falha de download (após retentativas), marcar `ERRO` e logar.
- [x] 6.3 Contar páginas com `pypdf`; se o PDF for ilegível/criptografado, marcar `ERRO` e não imprimir.
- [x] 6.4 Se a contagem real divergir de `num_paginas`, marcar `ERRO`, logar a contagem observada e não imprimir.

## 7. Impressão via CUPS

- [x] 7.1 Gravar o buffer em arquivo temporário e enviar com `lp -d $PRINTER_NAME -n 1 <arquivo>`; capturar o job id da saída.
- [x] 7.2 Logar aviso quando `modo_cor = 'COLORIDO'` (impressão sai em cinza na 135w).
- [x] 7.3 Acompanhar o job no CUPS (`lpstat`) até concluir ou estourar `PRINT_TIMEOUT`.
- [x] 7.4 Em conclusão: `UPDATE ... SET status='IMPRESSO', printed_at=now()`.
- [x] 7.5 Em timeout/erro: tentar `cancel` do job, marcar `ERRO` e logar o motivo.
- [x] 7.6 Limpar o arquivo temporário ao final (sucesso ou erro).

## 8. Recuperação de pedidos travados

- [x] 8.1 No início de cada ciclo, detectar pedidos em `IMPRIMINDO` mais antigos que `STUCK_TIMEOUT` (usar `paid_at` como referência) e devolvê-los para `PAGO`.
- [x] 8.2 Logar cada recuperação (re-fila) com o id do pedido.

## 9. Empacotamento e operação

- [x] 9.1 Criar o unit file systemd (`print-worker.service`) com `Restart=always`, `EnvironmentFile` apontando para o `.env` `0600`, e `WorkingDirectory` em `print-worker/`.
- [x] 9.2 Escrever `README.md` do worker: pré-requisitos (CUPS + HPLIP/`hp-setup` da 135w), como descobrir o `PRINTER_NAME` (`lpstat -p`), instalação de deps, criação do `.env` `0600`, instalação/habilitação do systemd, e como ver logs (`journalctl -u print-worker -f`).
- [x] 9.3 Documentar o processo manual para pedidos em `ERRO` (sem retry automático em erro de impressão).

## 10. Instalação e validação (manual, na sede)

- [ ] 10.1 Instalar CUPS + driver HPLIP da HP Laser 135w; confirmar `lp` manual de um PDF de teste. *(manual)*
- [ ] 10.2 Instalar o worker: `pip install -r requirements.txt`, criar `.env` `0600` com a `service_role` key e o `PRINTER_NAME`. *(manual)*
- [ ] 10.3 Instalar e habilitar o serviço systemd; iniciar e acompanhar o journal. *(manual)*
- [ ] 10.4 Teste end-to-end: pedido real de valor baixo → pagar → confirmar impressão física e `status = 'IMPRESSO'`. *(manual)*
- [ ] 10.5 Teste de fraude de páginas: pedido com `num_paginas` divergente do PDF → confirmar `ERRO` e que nada é impresso. *(manual)*
- [ ] 10.6 Teste de claim: rodar duas instâncias e confirmar que um pedido só é impresso uma vez. *(manual)*
