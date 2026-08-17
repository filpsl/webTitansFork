# Tasks — conferencia-tolerante-a-papel

## 1. Causa do falso PRONTO

- [x] 1.1 `resolver_host`: IP literal devolve a si mesmo, sem subprocesso (era resolução
      reversa pela rede, que falha em blip de Wi-Fi)
- [x] 1.2 A espera resolve o host UMA vez e depois só emite datagramas SNMP
- [x] 1.3 Leitura falha mantém o último delta bom; `None` só quando nenhuma leitura funcionou
- [x] 1.4 `conferir_folhas` devolve `Veredito(problema, verificado)`; a contagem do cupsd
      local só condena, nunca aprova
- [x] 1.5 `avisar_sem_conferencia`: pedido sem prova sai `IMPRESSO` com aviso à equipe

## 2. Espera guiada por progresso

- [x] 2.1 `bandeja_vazia(nivel, status)` a partir dos valores medidos na 135w (-3/0 com
      papel, 0/11 vazia)
- [x] 2.2 `decidir_espera(...)` pura: `continuar` / `concluido` / `desistir`
- [x] 2.3 `aguardar_folhas_do_motor` substitui `folhas_gastas_pelo_motor` e o teto fixo
      `ESPERA_MOTOR_ESTABILIZAR`
- [x] 2.4 Motivo de ERRO específico para papel não reposto ("saíram N de M folha(s)")
- [x] 2.5 Envs: `PAPER_WAIT_TIMEOUT=600` (nova) e `STUCK_TIMEOUT` 900 -> 1200

## 3. Visibilidade durante a espera

- [x] 3.1 `Heartbeat.reportar_fisico`: a espera publica `SEM_PAPEL` durante o job, o que a
      sondagem leve não enxerga em fila `socket://`
- [x] 3.2 Aviso no Telegram e estado no kiosk reusam a máquina de transição existente

## 4. Testes e documentação

- [x] 4.1 Testes: IP literal sem subprocesso, `bandeja_vazia`, matriz de `decidir_espera`,
      laço com relógio falso (papel reposto, papel não reposto, leitura falha no meio)
- [x] 4.2 Teste de regressão do 44C56F93: cupsd sozinho não aprova
- [x] 4.3 README (seção "Conferência do que a impressora realmente imprimiu") e `.env.example`
- [ ] 4.4 Validação em campo: repetir o teste de 1 folha nas duas variantes (repondo e não
      repondo o papel) e um pedido grande saudável
