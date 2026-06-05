## 1. Configuração (worker + env)

- [x] 1.1 Em `print-worker/worker.py`, adicionar `printer_name_fallback` a `Config` lendo
      `PRINTER_NAME_FALLBACK` (opcional, `.strip()`), mantendo `PRINTER_NAME` (primária)
      obrigatória e a validação de variáveis existentes.
- [x] 1.2 Adicionar um helper `filas_candidatas(cfg)` que retorna `[primária]` ou
      `[primária, fallback]` (ignorando fallback vazia/duplicada da primária).
- [x] 1.3 Atualizar `print-worker/.env.example` com `PRINTER_NAME_FALLBACK` (comentário: fila
      USB de fallback `HP_Laser_MFP_131_133_135_138`; opcional) e ajustar o comentário de
      `PRINTER_NAME` para a fila de rede `Titans_Laser`.

## 2. Funções de CUPS parametrizadas por fila

- [x] 2.1 Alterar `enviar_para_impressora` para receber o nome da fila como parâmetro e
      sinalizar falha de PRÉ-SUBMISSÃO (lp returncode != 0, ou job id não extraível) via uma
      exceção dedicada (ex.: `FalhaPreSubmissao`).
- [x] 2.2 Alterar `aguardar_conclusao` para receber o nome da fila como parâmetro
      (`lpstat -o <fila>`).
- [x] 2.3 Alterar `cancelar_job` para considerar a fila correta onde o job foi aceito.
- [x] 2.4 Adicionar `fila_saudavel(fila)` usando `lpstat -p <fila>` (fila existe e está
      habilitada/`enabled`, não `disabled`), com tratamento explícito de erro/timeout.

## 3. Orquestração do failover em `processar`

- [x] 3.1 Substituir o bloco atual de envio/espera por um laço sobre `filas_candidatas`:
      pular fila insalubre (health-check), submeter à primeira saudável.
- [x] 3.2 Capturar `FalhaPreSubmissao` no laço para tentar a próxima fila (failover seguro);
      logar origem, destino e motivo.
- [x] 3.3 Após a aceitação do job (job id obtido), NUNCA tentar outra fila: acompanhar
      conclusão na fila aceita; sucesso → `IMPRESSO` + `printed_at`; timeout → cancelar job na
      fila correta + `ERRO`, com log de que o failover foi deliberadamente evitado.
- [x] 3.4 Se todas as filas falharem em pré-submissão (nenhuma aceitou), marcar `ERRO` com log
      explícito de que nada foi impresso.
- [x] 3.5 Garantir que o caminho sem `PRINTER_NAME_FALLBACK` continue idêntico ao atual
      (uma fila, sem failover) — verificação de retrocompatibilidade.

## 4. Logs e mensagem de inicialização

- [x] 4.1 Logar, por pedido, a fila escolhida e qualquer failover (origem/destino/motivo).
- [x] 4.2 Atualizar a linha de log de inicialização do `main` para mostrar a fila primária e a
      fila de fallback (quando configurada).

## 5. Documentação

- [x] 5.1 Reescrever `print-worker/README.md`: remover `hp-setup`/HPLIP (não suportado);
      documentar a criação da fila de rede `Titans_Laser`
      (`lpadmin -p Titans_Laser -E -v ipp://NOME.local/ipp/print -m everywhere`), o uso do nome
      `.local` (IP é DHCP), a fila USB de fallback e a nova `PRINTER_NAME_FALLBACK`.
- [x] 5.2 Atualizar `docs/web-to-print/06-print-worker.md`: fila Wi-Fi primária + USB fallback,
      política de failover anti-duplicação, nova variável de ambiente na tabela de config.
- [x] 5.3 Atualizar `docs/web-to-print/07-operacao.md`: substituir o passo `hp-setup` pela
      criação das filas de rede/USB; documentar o tratamento de `ERRO` pós-aceitação (operador
      marca `IMPRESSO` se confirmar a folha, em vez de re-filar).
- [x] 5.4 Atualizar menções a "HP Laser MFP 135w"/USB em `docs/web-to-print/01-arquitetura.md`
      e `docs/web-to-print/README.md` para refletir a fila de rede + fallback.
- [x] 5.5 Revisar a descrição do unit em `print-worker/print-worker.service` se mencionar o
      modelo/USB.

## 6. Validação

- [x] 6.1 `python -m py_compile print-worker/worker.py` (sintaxe).
- [ ] 6.2 Teste manual: forçar falha de pré-submissão na primária (Wi-Fi off) e confirmar
      failover para a USB **sem duplicar** páginas.
- [ ] 6.3 Teste manual: forçar timeout pós-aceitação e confirmar `ERRO` **sem** failover.
- [ ] 6.4 Teste de retrocompatibilidade: sem `PRINTER_NAME_FALLBACK`, comportamento idêntico ao
      atual (uma fila).
- [x] 6.5 `openspec validate print-worker-dual-queue-failover --strict` passa.
