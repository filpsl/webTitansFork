## 1. Investigação e confirmação da causa raiz

- [ ] 1.1 Reproduzir o bug na sede: desligar o Wi-Fi da impressora, submeter um pedido e
      confirmar nos logs a sequência `fila_saudavel`=ok → job id obtido → timeout (~5 min) →
      `ERRO (failover deliberadamente evitado para não duplicar)`, com a USB nunca tentada.
- [ ] 1.2 Coletar evidências do CUPS com Wi-Fi off: `lpstat -p <primária>` (deve reportar
      `enabled`), `lpstat -v <primária>` (device-uri com nome `.local`), `lpstat -o <primária>` e
      `lpstat -W not-completed -l <primária>` (job-state-reasons, ex.: `connecting-to-device`).
- [x] 1.3 Documentar no design (se necessário ajustar) o ponto exato em `worker.py` onde o job id
      é obtido (`enviar_para_impressora`) e onde o ramo pós-aceitação dispara (`processar`).

## 2. Verificação de alcançabilidade do destino (correção principal — Decisão 1)

- [x] 2.1 Adicionar função para obter o device-uri da fila via `lpstat -v <fila>` (locale C,
      timeout curto), com tratamento explícito de erro/timeout.
- [x] 2.2 Adicionar parser do device-uri que extrai esquema, host e porta (default 631 para
      `ipp`/`http`), e classifica a fila como de **rede** (`ipp`/`ipps`/`http`/`socket`) ou
      **USB/local** (`usb`/`hp:/usb`/`file`). Degradar com segurança quando não interpretável.
- [x] 2.3 Adicionar resolução de host (mDNS `.local` incluído): tentar `getent hosts <host>` e,
      se indisponível, `avahi-resolve-host-name -4 <host>`, com timeout curto.
- [x] 2.4 Adicionar TCP-connect ao `(host, porta)` resolvido via `socket.create_connection` com
      timeout curto; falha de resolução ou de conexão => destino inalcançável.
- [x] 2.5 Adicionar `REACHABILITY_TIMEOUT` (padrão ~3s) em `Config` e `.env.example`, usado pela
      resolução e pelo TCP-connect.

## 3. Integração no fluxo de failover (`processar`)

- [x] 3.1 Antes de submeter à fila primária de rede, executar a verificação de alcançabilidade;
      se inalcançável, classificar como PRÉ-SUBMISSÃO (sem submeter) e seguir para a próxima fila.
- [x] 3.2 Para filas USB/locais, NÃO aplicar a checagem de rede; manter `fila_saudavel` atual.
- [x] 3.3 Garantir que o invariante anti-duplicação permanece: failover só na pré-submissão
      (inclusive o novo caso "host inalcançável"); pós-aceitação com destino contatado continua
      `cancel` + `ERRO`, sem failover.
- [x] 3.4 Manter retrocompatibilidade: sem `PRINTER_NAME_FALLBACK`, o desfecho continua idêntico
      ao atual (uma fila; primária inalcançável => `ERRO`, nada impresso).

## 4. Logs e observabilidade

- [x] 4.1 Logar, por pedido, o motivo da inalcançabilidade da primária (host não resolve / porta
      recusada) e que o failover para a USB ocorreu **sem nada ter sido impresso**.
- [x] 4.2 Logar quando uma fila de rede é considerada alcançável e a submissão prossegue
      normalmente (nível INFO/DEBUG), para auditoria via `journalctl`.

## 5. Documentação

- [x] 5.1 Atualizar `print-worker/README.md`: novo critério de failover por inalcançabilidade,
      dependência de resolução mDNS (`getent`/Avahi) e a variável `REACHABILITY_TIMEOUT`.
- [x] 5.2 Atualizar `docs/web-to-print/06-print-worker.md` e `07-operacao.md`: descrever o
      failover por host inalcançável e o runbook de teste (desligar Wi-Fi => USB sem duplicar).

## 6. Validação

- [x] 6.1 `python -m py_compile print-worker/worker.py` (sintaxe).
- [ ] 6.2 Teste manual: Wi-Fi off => confirmar que a primária é considerada inalcançável
      (pré-submissão), que a impressão sai pela USB e que NÃO há duplicação de páginas.
- [ ] 6.3 Teste manual: Wi-Fi on => confirmar que a primária é considerada alcançável e a
      impressão volta a sair pela Wi-Fi.
- [ ] 6.4 Teste de não-regressão pós-aceitação: simular timeout após o destino responder e
      confirmar `ERRO` sem failover (invariante anti-duplicação preservado).
- [ ] 6.5 Teste de retrocompatibilidade: sem `PRINTER_NAME_FALLBACK`, comportamento idêntico ao
      atual (uma fila).
- [x] 6.6 `openspec validate print-worker-wifi-unreachable-failover --strict` passa.
