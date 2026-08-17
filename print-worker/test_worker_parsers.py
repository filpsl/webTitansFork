"""Testes de regressão para os parsers IPP do print-worker.

Cobre `_parse_atributos_ipp`, `normalizar_razoes` e `estado_de_saude` a partir
de saídas simuladas do `ipptool -tv` (nenhum comando externo é executado —
os testes só exercitam o parsing puro em Python). Usa apenas a stdlib
(unittest), sem dependências novas.

O import de `worker` é seguro: `main()` só roda sob
`if __name__ == "__main__":`, então importar o módulo não sobe threads, não
lê variáveis de ambiente obrigatórias e não instancia `Config`.
"""

from __future__ import annotations

import os
import sys
import types
import unittest

# Garante que `worker` seja importável mesmo rodando de outro diretório
# (ex.: `python3 /caminho/para/test_worker_parsers.py`).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import worker  # noqa: E402 - import após o ajuste do sys.path acima


class ParseAtributosIppTests(unittest.TestCase):
    """`_parse_atributos_ipp`: extração de printer-state, razões e toner."""

    def test_saida_completa_idle(self) -> None:
        """idle + state-reasons + marker-levels: os três campos são extraídos."""
        saida = (
            "ipptool: ... (Get-Printer-Attributes) ...\n"
            "printer-state (enum) = idle\n"
            "printer-state-reasons (keyword) = none\n"
            "marker-levels (integer) = 87\n"
        )
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["printer_state"], worker.IDLE)
        self.assertEqual(atributos["state_reasons"], ["none"])
        self.assertEqual(atributos["toner_pct"], 87)

    def test_processing_por_nome(self) -> None:
        saida = "printer-state (enum) = processing\n"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["printer_state"], worker.PROCESSING)

    def test_stopped_por_nome(self) -> None:
        saida = "printer-state (enum) = stopped\n"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["printer_state"], worker.STOPPED)

    def test_formato_numerico_idle(self) -> None:
        """Algumas versões do ipptool imprimem o número do enum em vez do nome."""
        saida = "printer-state (enum) = 3\n"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["printer_state"], 3)

    def test_formato_numerico_stopped(self) -> None:
        saida = "printer-state (enum) = 5\n"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["printer_state"], 5)

    def test_sem_printer_state_nao_confunde_com_reasons(self) -> None:
        """Só `printer-state-reasons` na saída (sem `printer-state`):
        printer_state deve ficar None — a regex de `printer-state` não pode
        casar acidentalmente com o prefixo de `printer-state-reasons`."""
        saida = "printer-state-reasons (keyword) = media-empty-error\n"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertIsNone(atributos["printer_state"])
        self.assertEqual(atributos["state_reasons"], ["media-empty-error"])

    def test_reasons_antes_do_state_nao_confunde(self) -> None:
        """Mesmo com `-reasons` aparecendo ANTES de `printer-state` na saída,
        o valor extraído deve ser o do atributo `printer-state` de verdade."""
        saida = (
            "printer-state-reasons (keyword) = none\n"
            "printer-state (enum) = idle\n"
        )
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["printer_state"], worker.IDLE)

    def test_marker_levels_negativo_vira_none(self) -> None:
        """-1 é o valor IPP para 'desconhecido' -> toner_pct deve virar None."""
        saida = "marker-levels (integer) = -1\n"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertIsNone(atributos["toner_pct"])

    def test_saida_vazia(self) -> None:
        atributos = worker._parse_atributos_ipp("")
        self.assertEqual(atributos["state_reasons"], [])
        self.assertIsNone(atributos["toner_pct"])
        self.assertIsNone(atributos["toner_low_pct"])
        self.assertIsNone(atributos["printer_state"])

    def test_saida_ilegivel(self) -> None:
        """Texto sem nenhum atributo IPP reconhecível: tudo vazio/None."""
        saida = "@#$% saída corrompida do ipptool, nada reconhecível aqui %#@"
        atributos = worker._parse_atributos_ipp(saida)
        self.assertEqual(atributos["state_reasons"], [])
        self.assertIsNone(atributos["toner_pct"])
        self.assertIsNone(atributos["toner_low_pct"])
        self.assertIsNone(atributos["printer_state"])


class NormalizarRazoesTests(unittest.TestCase):
    """`normalizar_razoes`: remove sufixos de severidade e ruído ('none')."""

    def test_remove_sufixos_de_severidade(self) -> None:
        razoes = ["media-empty-error", "toner-empty-warning", "media-jam-report"]
        self.assertEqual(
            worker.normalizar_razoes(razoes),
            ["media-empty", "toner-empty", "media-jam"],
        )

    def test_filtra_none(self) -> None:
        self.assertEqual(worker.normalizar_razoes(["none"]), [])

    def test_preserva_razoes_sem_sufixo_conhecido(self) -> None:
        self.assertEqual(worker.normalizar_razoes(["cover-open"]), ["cover-open"])

    def test_preserva_ordem_e_mistura_casos(self) -> None:
        razoes = ["none", "media-jam-report", "toner-empty"]
        self.assertEqual(worker.normalizar_razoes(razoes), ["media-jam", "toner-empty"])

    def test_lista_vazia(self) -> None:
        self.assertEqual(worker.normalizar_razoes([]), [])


class EstadoDeSaudeTests(unittest.TestCase):
    """`estado_de_saude`: mapeia razões normalizadas + toner para o estado físico."""

    def test_toner_empty_vira_sem_toner(self) -> None:
        estado = worker.estado_de_saude(["toner-empty"], None, None)
        self.assertEqual(estado, "SEM_TONER")

    def test_media_empty_vira_sem_papel(self) -> None:
        estado = worker.estado_de_saude(["media-empty"], None, None)
        self.assertEqual(estado, "SEM_PAPEL")

    def test_media_jam_vira_manutencao(self) -> None:
        estado = worker.estado_de_saude(["media-jam"], None, None)
        self.assertEqual(estado, "MANUTENCAO")

    def test_sem_razoes_e_toner_normal_retorna_none(self) -> None:
        self.assertIsNone(worker.estado_de_saude([], 80, 10))

    def test_prioridade_toner_sobre_papel(self) -> None:
        """SEM_TONER tem prioridade sobre SEM_PAPEL quando ambas as razões
        aparecem simultaneamente (toner é a falha mais crítica)."""
        estado = worker.estado_de_saude(["toner-empty", "media-empty"], None, None)
        self.assertEqual(estado, "SEM_TONER")

    def test_toner_pct_zero_conta_como_esgotado(self) -> None:
        """Firmwares que não emitem 'toner-empty' mas zeram o percentual."""
        self.assertEqual(worker.estado_de_saude([], 0, None), "SEM_TONER")

    def test_toner_pct_no_limiar_low_conta_como_esgotado(self) -> None:
        """toner_pct <= toner_low_pct do próprio equipamento também é esgotado."""
        self.assertEqual(worker.estado_de_saude([], 5, 10), "SEM_TONER")


class LinhasDeTransicaoTests(unittest.TestCase):
    """`linhas_de_transicao`: avisos de entrada em problema e de recuperação."""

    def test_entrada_em_sem_papel_notifica_e_registra_pendente(self) -> None:
        linhas, pendente = worker.linhas_de_transicao("OK", "SEM_PAPEL", None, False, False)
        self.assertEqual(linhas, [worker.MENSAGEM_ESTADO["SEM_PAPEL"]])
        self.assertEqual(pendente, "SEM_PAPEL")

    def test_heartbeat_repetido_do_mesmo_estado_nao_repete(self) -> None:
        linhas, pendente = worker.linhas_de_transicao(
            "SEM_PAPEL", "SEM_PAPEL", "SEM_PAPEL", False, False
        )
        self.assertEqual(linhas, [])
        self.assertEqual(pendente, "SEM_PAPEL")

    def test_reentrada_apos_blip_inalcancavel_nao_repete(self) -> None:
        """SEM_PAPEL -> INALCANCAVEL -> SEM_PAPEL (Wi-Fi caiu e voltou, papel
        continua em falta): o problema pendente deduplica o aviso."""
        linhas, pendente = worker.linhas_de_transicao(
            "INALCANCAVEL", "SEM_PAPEL", "SEM_PAPEL", False, False
        )
        self.assertEqual(linhas, [])
        self.assertEqual(pendente, "SEM_PAPEL")

    def test_recuperacao_para_ok_avisa_papel_reposto(self) -> None:
        linhas, pendente = worker.linhas_de_transicao(
            "SEM_PAPEL", "OK", "SEM_PAPEL", False, False
        )
        self.assertEqual(linhas, [worker.MENSAGEM_RECUPERACAO["SEM_PAPEL"]])
        self.assertIsNone(pendente)

    def test_recuperacao_para_imprimindo_tambem_conta(self) -> None:
        linhas, pendente = worker.linhas_de_transicao(
            "SEM_TONER", "IMPRIMINDO", "SEM_TONER", False, False
        )
        self.assertEqual(linhas, [worker.MENSAGEM_RECUPERACAO["SEM_TONER"]])
        self.assertIsNone(pendente)

    def test_inalcancavel_nao_encerra_problema_pendente(self) -> None:
        """Impressora desligada não prova reposição: pendente sobrevive."""
        linhas, pendente = worker.linhas_de_transicao(
            "SEM_PAPEL", "INALCANCAVEL", "SEM_PAPEL", False, False
        )
        self.assertEqual(linhas, [])
        self.assertEqual(pendente, "SEM_PAPEL")

    def test_pausada_nao_encerra_problema_pendente(self) -> None:
        linhas, pendente = worker.linhas_de_transicao(
            "SEM_PAPEL", "PAUSADA", "SEM_PAPEL", False, False
        )
        self.assertEqual(linhas, [])
        self.assertEqual(pendente, "SEM_PAPEL")

    def test_troca_de_problema_notifica_o_novo(self) -> None:
        linhas, pendente = worker.linhas_de_transicao(
            "SEM_PAPEL", "SEM_TONER", "SEM_PAPEL", False, False
        )
        self.assertEqual(linhas, [worker.MENSAGEM_ESTADO["SEM_TONER"]])
        self.assertEqual(pendente, "SEM_TONER")

    def test_ok_sem_problema_pendente_nao_avisa(self) -> None:
        linhas, pendente = worker.linhas_de_transicao("OK", "OK", None, False, False)
        self.assertEqual(linhas, [])
        self.assertIsNone(pendente)

    def test_toner_baixo_subindo_avisa_uma_vez(self) -> None:
        linhas, _ = worker.linhas_de_transicao("OK", "OK", None, False, True)
        self.assertEqual(len(linhas), 1)
        self.assertIn("Toner acabando", linhas[0])
        linhas, _ = worker.linhas_de_transicao("OK", "OK", None, True, True)
        self.assertEqual(linhas, [])

    def test_entrada_em_problema_com_toner_baixo_junta_as_linhas(self) -> None:
        linhas, pendente = worker.linhas_de_transicao("OK", "SEM_PAPEL", None, False, True)
        self.assertEqual(len(linhas), 2)
        self.assertEqual(linhas[0], worker.MENSAGEM_ESTADO["SEM_PAPEL"])
        self.assertIn("Toner acabando", linhas[1])
        self.assertEqual(pendente, "SEM_PAPEL")


class NumeroDoJobTests(unittest.TestCase):
    """`numero_do_job`: parte numérica do job id do CUPS."""

    def test_job_id_tipico(self) -> None:
        self.assertEqual(worker.numero_do_job("Titans_Laser-196"), "196")

    def test_fila_com_hifens_e_digitos_no_nome(self) -> None:
        """Só o último grupo numérico conta — o nome da fila pode ter dígitos."""
        self.assertEqual(
            worker.numero_do_job("HP-Laser-MFP-131-133-135-138-42"), "42"
        )

    def test_sem_sufixo_numerico(self) -> None:
        self.assertIsNone(worker.numero_do_job("Titans_Laser"))


class ParseDesfechoJobTests(unittest.TestCase):
    """`_parse_desfecho_job`: job-state, razões e contagem de folhas."""

    def test_job_limpo(self) -> None:
        """Caso real do job 197: 1 folha para um pedido de 1 folha."""
        saida = (
            "        job-state (enum) = completed\n"
            "        job-state-reasons (keyword) = job-completed-successfully\n"
            "        job-impressions-completed (integer) = 1\n"
            "        job-media-sheets-completed (integer) = 1\n"
        )
        desfecho = worker._parse_desfecho_job(saida)
        self.assertEqual(desfecho["job_state"], worker.JOB_COMPLETED)
        self.assertEqual(desfecho["job_state_reasons"], ["job-completed-successfully"])
        self.assertEqual(desfecho["folhas"], 1)
        self.assertEqual(desfecho["impressoes"], 1)

    def test_job_com_lixo_conclui_mas_conta_folhas_demais(self) -> None:
        """Caso real do job 196: `completed`, porém 2 folhas para 1 pedida."""
        saida = (
            "        job-state (enum) = completed\n"
            "        job-state-reasons (keyword) = processing-to-stop-point\n"
            "        job-media-sheets-completed (integer) = 2\n"
        )
        desfecho = worker._parse_desfecho_job(saida)
        self.assertEqual(desfecho["job_state"], worker.JOB_COMPLETED)
        self.assertEqual(desfecho["folhas"], 2)

    def test_estado_numerico(self) -> None:
        saida = "job-state (enum) = 7\njob-state-reasons (keyword) = job-canceled-by-user\n"
        desfecho = worker._parse_desfecho_job(saida)
        self.assertEqual(desfecho["job_state"], worker.JOB_CANCELED)

    def test_aborted_por_nome(self) -> None:
        desfecho = worker._parse_desfecho_job("job-state (enum) = aborted\n")
        self.assertEqual(desfecho["job_state"], worker.JOB_ABORTED)

    def test_reasons_sozinho_nao_vira_state(self) -> None:
        """A regex de `job-state` não pode casar com `job-state-reasons`."""
        saida = "        job-state-reasons (keyword) = job-canceled-by-user\n"
        desfecho = worker._parse_desfecho_job(saida)
        self.assertIsNone(desfecho["job_state"])
        self.assertEqual(desfecho["job_state_reasons"], ["job-canceled-by-user"])

    def test_reasons_antes_do_state_nao_confunde(self) -> None:
        saida = (
            "        job-state-reasons (keyword) = job-completed-successfully\n"
            "        job-state (enum) = completed\n"
        )
        self.assertEqual(
            worker._parse_desfecho_job(saida)["job_state"], worker.JOB_COMPLETED
        )

    def test_multiplas_razoes(self) -> None:
        saida = "job-state-reasons (keyword) = job-canceled-by-user,resources-are-not-ready\n"
        self.assertEqual(
            worker._parse_desfecho_job(saida)["job_state_reasons"],
            ["job-canceled-by-user", "resources-are-not-ready"],
        )

    def test_folhas_negativas_viram_none(self) -> None:
        saida = "job-media-sheets-completed (integer) = -1\n"
        self.assertIsNone(worker._parse_desfecho_job(saida)["folhas"])

    def test_saida_vazia(self) -> None:
        desfecho = worker._parse_desfecho_job("")
        self.assertIsNone(desfecho["job_state"])
        self.assertIsNone(desfecho["folhas"])
        self.assertEqual(desfecho["job_state_reasons"], [])


class ConferirFolhasTests(unittest.TestCase):
    """`conferir_folhas`: veredito sobre o que a impressora produziu."""

    def _com_desfecho(self, desfecho):
        """Troca `desfecho_do_job` por um retorno fixo (nenhum ipptool roda)."""
        original = worker.desfecho_do_job
        worker.desfecho_do_job = lambda cfg, job_id: desfecho
        self.addCleanup(lambda: setattr(worker, "desfecho_do_job", original))

    def test_folhas_batem_nao_acusa(self) -> None:
        self._com_desfecho(
            {"job_state": worker.JOB_COMPLETED, "job_state_reasons": [], "folhas": 4}
        )
        self.assertIsNone(worker.conferir_folhas(None, "Titans_Laser-192", 4))

    def test_folhas_a_mais_acusa(self) -> None:
        self._com_desfecho(
            {
                "job_state": worker.JOB_COMPLETED,
                "job_state_reasons": ["processing-to-stop-point"],
                "folhas": 2,
            }
        )
        problema = worker.conferir_folhas(None, "Titans_Laser-196", 1)
        self.assertIsNotNone(problema)
        self.assertIn("2 folha(s)", problema)

    def test_job_cancelado_acusa(self) -> None:
        self._com_desfecho(
            {
                "job_state": worker.JOB_CANCELED,
                "job_state_reasons": ["job-canceled-by-user"],
                "folhas": 1,
            }
        )
        problema = worker.conferir_folhas(None, "Titans_Laser-182", 1)
        self.assertIsNotNone(problema)
        self.assertIn("canceled", problema)

    def test_leitura_indisponivel_nao_acusa(self) -> None:
        """Sem prova, degrada para o veredito da fila (comportamento anterior)."""
        self._com_desfecho(None)
        self.assertIsNone(worker.conferir_folhas(None, "Titans_Laser-196", 1))

    def test_folhas_ausentes_com_estado_ok_nao_acusa(self) -> None:
        self._com_desfecho(
            {"job_state": worker.JOB_COMPLETED, "job_state_reasons": [], "folhas": None}
        )
        self.assertIsNone(worker.conferir_folhas(None, "Titans_Laser-198", 1))


class SnmpTests(unittest.TestCase):
    """Codificação/decodificação BER do GET SNMP v1 mínimo."""

    # Respostas reais da 135w, capturadas com o cliente mínimo.
    RESP_CONTADOR = bytes.fromhex(
        "302c02010004067075626c6963a21f0201010201000201003014301206"
        "0c2b060102012b0a020104010141020638"
    )
    # Resposta de prtInputCurrentLevel: serve aqui como caso de INTEGER
    # negativo, que é onde um decoder ingênuo devolveria 253 em vez de -3.
    RESP_INTEIRO_NEGATIVO = bytes.fromhex(
        "302b02010004067075626c6963a21e0201010201000201003013301106"
        "0c2b060102012b0802010a01010201fd"
    )

    def test_contador32_da_impressora(self) -> None:
        """Counter32 (tag 0x41) = 0x0638 = 1592 páginas."""
        self.assertEqual(worker._valor_do_varbind(self.RESP_CONTADOR), 1592)

    def test_inteiro_negativo_nao_vira_positivo(self) -> None:
        """INTEGER -3 tem de sair -3, não 253 (byte 0xfd lido sem sinal)."""
        self.assertEqual(worker._valor_do_varbind(self.RESP_INTEIRO_NEGATIVO), -3)

    def test_oid_codifica_primeiros_dois_arcos_juntos(self) -> None:
        self.assertEqual(worker._ber_oid("1.3.6.1")[2:], b"\x2b\x06\x01")

    def test_oid_codifica_arco_grande_em_base128(self) -> None:
        self.assertEqual(worker._ber_oid("1.3.9999")[2:], b"\x2b\xce\x0f")

    def test_erro_no_pdu_vira_none(self) -> None:
        """error-status != 0 não pode virar um número inventado."""
        corrompida = bytearray(self.RESP_CONTADOR)
        corrompida[20] = 0x02  # valor de error-status: 0 -> noSuchName
        self.assertIsNone(worker._valor_do_varbind(bytes(corrompida)))


class FolhasGastasPeloMotorTests(unittest.TestCase):
    """`folhas_gastas_pelo_motor`: delta do contador, esperando estabilizar."""

    class _Cfg:
        snmp_community = "public"
        reachability_timeout = 3

    def _com_leituras(self, leituras):
        """Enfileira retornos de `paginas_do_motor` e anula o sleep.

        Esgotada a fila, repete a última leitura — o contador de uma impressora
        parada não muda mais.
        """
        seq = list(leituras)
        ultima = leituras[-1]
        original = worker.paginas_do_motor
        worker.paginas_do_motor = lambda cfg, fila: seq.pop(0) if seq else ultima
        self.addCleanup(lambda: setattr(worker, "paginas_do_motor", original))
        sono = worker.time.sleep
        worker.time.sleep = lambda _s: None
        self.addCleanup(lambda: setattr(worker.time, "sleep", sono))

    def test_job_limpo_delta_bate(self) -> None:
        self._com_leituras([1592, 1593, 1593])
        self.assertEqual(
            worker.folhas_gastas_pelo_motor(self._Cfg(), "Titans_SPL", 1592, 1), 1
        )

    def test_espera_o_motor_parar_de_subir(self) -> None:
        """Ler no meio do despejo daria 3; o certo é esperar chegar a 11."""
        leituras = [1592, 1595, 1599, 1603, 1603]
        self._com_leituras(leituras)
        self.assertEqual(
            worker.folhas_gastas_pelo_motor(self._Cfg(), "Titans_SPL", 1592, 2), 11
        )

    def test_sem_marco_inicial_nao_conclui_nada(self) -> None:
        self._com_leituras([1592, 1592])
        self.assertIsNone(
            worker.folhas_gastas_pelo_motor(self._Cfg(), "Titans_SPL", None, 1)
        )

    def test_contador_ilegivel_vira_none(self) -> None:
        self._com_leituras([None])
        self.assertIsNone(
            worker.folhas_gastas_pelo_motor(self._Cfg(), "Titans_SPL", 1592, 1)
        )


class ConferirFolhasMotorTests(unittest.TestCase):
    """O contador do motor manda no veredito — inclusive em fila socket."""

    def _sem_desfecho_do_cupsd(self):
        """Fila socket: o cupsd não tem contagem vinda do equipamento."""
        original = worker.desfecho_do_job
        worker.desfecho_do_job = lambda cfg, job_id: None
        self.addCleanup(lambda: setattr(worker, "desfecho_do_job", original))

    def test_delta_bate_nao_acusa(self) -> None:
        self._sem_desfecho_do_cupsd()
        self.assertIsNone(
            worker.conferir_folhas(None, "Titans_SPL-215", 2, folhas_motor=2)
        )

    def test_papel_acaba_depois_da_ultima_folha_nao_e_erro(self) -> None:
        """Garantia pedida: bandeja zerar no fim de um job COMPLETO não é falha.

        O veredito só olha folhas produzidas — o estado do papel depois não
        entra na conta. Delta == esperado => IMPRESSO, bandeja vazia ou não.
        """
        self._sem_desfecho_do_cupsd()
        self.assertIsNone(
            worker.conferir_folhas(None, "Titans_SPL-216", 3, folhas_motor=3)
        )

    def test_lixo_queimando_a_bandeja_acusa(self) -> None:
        """Caso real do job 211: 11 folhas para um pedido de 2."""
        self._sem_desfecho_do_cupsd()
        problema = worker.conferir_folhas(None, "Titans_SPL-211", 2, folhas_motor=11)
        self.assertIsNotNone(problema)
        self.assertIn("11 folha(s)", problema)
        self.assertIn("lixo binário", problema)

    def test_impressao_incompleta_acusa_sem_falar_em_lixo(self) -> None:
        self._sem_desfecho_do_cupsd()
        problema = worker.conferir_folhas(None, "Titans_SPL-217", 5, folhas_motor=2)
        self.assertIsNotNone(problema)
        self.assertIn("incompleta", problema)
        self.assertNotIn("lixo binário", problema)

    def test_motor_ilegivel_cai_para_o_cupsd(self) -> None:
        """Sem SNMP, o veredito antigo (fila IPP) continua valendo."""
        original = worker.desfecho_do_job
        worker.desfecho_do_job = lambda cfg, job_id: {
            "job_state": worker.JOB_COMPLETED,
            "job_state_reasons": ["processing-to-stop-point"],
            "folhas": 2,
        }
        self.addCleanup(lambda: setattr(worker, "desfecho_do_job", original))
        problema = worker.conferir_folhas(None, "Titans_Laser-196", 1, folhas_motor=None)
        self.assertIsNotNone(problema)
        self.assertIn("2 folha(s)", problema)


class AlvoIppDaFilaTests(unittest.TestCase):
    """`alvo_ipp_da_fila`: para onde vão as consultas de saúde de cada fila."""

    def _com_device_uri(self, uri):
        """Fixa o device-uri da fila (nenhum `lpstat` roda)."""
        original = worker.device_uri_da_fila
        worker.device_uri_da_fila = lambda fila: uri
        self.addCleanup(lambda: setattr(worker, "device_uri_da_fila", original))

    def test_fila_ipp_usa_o_proprio_device_uri(self) -> None:
        self._com_device_uri("ipp://HPE4E749FC401D.local/ipp/print")
        self.assertEqual(
            worker.alvo_ipp_da_fila("Titans_Laser"),
            "ipp://HPE4E749FC401D.local/ipp/print",
        )

    def test_fila_socket_consulta_o_mesmo_equipamento_por_ipp(self) -> None:
        """Driver nativo na porta RAW: a saúde ainda tem de vir do equipamento."""
        self._com_device_uri("socket://10.74.1.109:9100")
        self.assertEqual(
            worker.alvo_ipp_da_fila("Titans_SPL"), "ipp://10.74.1.109:631/ipp/print"
        )

    def test_fila_socket_com_ipv6_leva_colchetes(self) -> None:
        self._com_device_uri("socket://[fe80::1]:9100")
        self.assertEqual(
            worker.alvo_ipp_da_fila("Titans_SPL"), "ipp://[fe80::1]:631/ipp/print"
        )

    def test_fila_usb_cai_para_a_fila_local(self) -> None:
        self._com_device_uri("usb://HP/Laser%20MFP%20135w?serial=ABC")
        self.assertEqual(
            worker.alvo_ipp_da_fila("HP_USB"),
            "ipp://localhost:631/printers/HP_USB",
        )

    def test_sem_device_uri_cai_para_a_fila_local(self) -> None:
        self._com_device_uri(None)
        self.assertEqual(
            worker.alvo_ipp_da_fila("Titans_SPL"),
            "ipp://localhost:631/printers/Titans_SPL",
        )


class MensagemErroPedidoTests(unittest.TestCase):
    """`mensagem_erro_pedido`: o aviso que a equipe recebe no Telegram."""

    PEDIDO = {
        "id": "a1b2c3d4-1111-2222-3333-444455556666",
        "num_paginas": 11,
        "quantidade_copias": 2,
    }

    def test_protocolo_e_o_mesmo_da_fila_publica(self) -> None:
        """8 primeiros caracteres do UUID em maiúsculas, como `fila_publica`."""
        self.assertEqual(
            worker.protocolo_do_pedido("a1b2c3d4-1111-2222-3333-444455556666"),
            "A1B2C3D4",
        )

    def test_traz_protocolo_esperado_impresso_fila_e_comando(self) -> None:
        texto = worker.mensagem_erro_pedido(
            self.PEDIDO,
            "o motor gastou 30 folha(s) para um pedido de 22",
            fila="Titans_Laser",
            job_id="Titans_Laser-211",
            folhas_impressas=30,
        )
        self.assertIn("Protocolo: A1B2C3D4", texto)
        self.assertIn("Motivo: o motor gastou 30 folha(s) para um pedido de 22", texto)
        self.assertIn("Esperado: 11 pág. × 2 cópias = 22 folha(s)", texto)
        self.assertIn("Impresso: 30 folha(s)", texto)
        self.assertIn("Fila: Titans_Laser (job Titans_Laser-211)", texto)
        self.assertIn("/reimprimir A1B2C3D4", texto)

    def test_uma_copia_no_singular(self) -> None:
        texto = worker.mensagem_erro_pedido(
            {"id": "abcdef01-0000-0000-0000-000000000000", "num_paginas": 3},
            "PDF inválido",
            folhas_impressas=0,
        )
        self.assertIn("Esperado: 3 pág. × 1 cópia = 3 folha(s)", texto)
        self.assertIn("Impresso: 0 folha(s)", texto)

    def test_sem_prova_de_folhas_diz_nao_confirmado(self) -> None:
        """Timeout com job em voo: não inventamos um número de folhas."""
        texto = worker.mensagem_erro_pedido(
            self.PEDIDO, "o job não concluiu em 180s", fila="Titans_Laser"
        )
        self.assertIn("Impresso: não confirmado", texto)
        self.assertIn("Fila: Titans_Laser", texto)
        self.assertNotIn("(job", texto)


class EnviarTelegramTests(unittest.TestCase):
    """`enviar_telegram`: best-effort — sem envs não tenta rede e não levanta."""

    def test_sem_envs_apenas_loga(self) -> None:
        cfg = types.SimpleNamespace(telegram_bot_token="", telegram_chat_id="")
        chamou = []
        original = worker.urlopen
        worker.urlopen = lambda *a, **k: chamou.append(a)  # type: ignore[assignment]
        try:
            worker.enviar_telegram(cfg, "❌ Pedido em ERRO\nProtocolo: A1B2C3D4")
        finally:
            worker.urlopen = original  # type: ignore[assignment]
        self.assertEqual(chamou, [])


if __name__ == "__main__":
    unittest.main()
