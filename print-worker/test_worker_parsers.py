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
        self.assertIsNone(worker.conferir_folhas(None, "Titans_Laser-192", 4).problema)

    def test_folhas_a_mais_acusa(self) -> None:
        self._com_desfecho(
            {
                "job_state": worker.JOB_COMPLETED,
                "job_state_reasons": ["processing-to-stop-point"],
                "folhas": 2,
            }
        )
        problema = worker.conferir_folhas(None, "Titans_Laser-196", 1).problema
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
        problema = worker.conferir_folhas(None, "Titans_Laser-182", 1).problema
        self.assertIsNotNone(problema)
        self.assertIn("canceled", problema)

    def test_leitura_indisponivel_nao_acusa(self) -> None:
        """Sem prova, degrada para o veredito da fila (comportamento anterior)."""
        self._com_desfecho(None)
        self.assertIsNone(worker.conferir_folhas(None, "Titans_Laser-196", 1).problema)

    def test_folhas_ausentes_com_estado_ok_nao_acusa(self) -> None:
        self._com_desfecho(
            {"job_state": worker.JOB_COMPLETED, "job_state_reasons": [], "folhas": None}
        )
        self.assertIsNone(worker.conferir_folhas(None, "Titans_Laser-198", 1).problema)


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


class ResolverHostTests(unittest.TestCase):
    """IP literal não pode virar consulta de rede."""

    def _sem_subprocesso(self):
        """Qualquer subprocesso aqui é o bug: `getent hosts <ip>` sai na rede."""
        original = worker.subprocess.run

        def proibido(*args, **kwargs):
            raise AssertionError(f"resolveu IP literal por subprocesso: {args}")

        worker.subprocess.run = proibido
        self.addCleanup(lambda: setattr(worker.subprocess, "run", original))

    def test_ipv4_literal_devolve_a_si_mesmo(self) -> None:
        self._sem_subprocesso()
        self.assertEqual(worker.resolver_host("10.74.1.109", 3), "10.74.1.109")

    def test_ipv6_literal_devolve_a_si_mesmo(self) -> None:
        self._sem_subprocesso()
        self.assertEqual(worker.resolver_host("::1", 3), "::1")


class BandejaVaziaTests(unittest.TestCase):
    """Valores medidos na 135w (ver OID_NIVEL_BANDEJA)."""

    def test_com_papel(self) -> None:
        self.assertIs(worker.bandeja_vazia(-3, 0), False)

    def test_vazia(self) -> None:
        self.assertIs(worker.bandeja_vazia(0, 11), True)

    def test_sem_leitura_nenhuma(self) -> None:
        self.assertIsNone(worker.bandeja_vazia(None, None))

    def test_so_o_status_critico(self) -> None:
        self.assertIs(worker.bandeja_vazia(None, 11), True)
        self.assertIs(worker.bandeja_vazia(None, 0), False)


class DecidirEsperaTests(unittest.TestCase):
    """Política da espera pelo motor. Falta de papel só ESTENDE a paciência."""

    TOLERANCIA = 600

    def _decidir(self, **kwargs) -> str:
        args = {
            "delta": 0,
            "folhas_esperadas": 2,
            "estavel": False,
            "vazia": False,
            "s_sem_progresso": 0.0,
            "s_sem_papel": 0.0,
            "tolerancia_sem_papel": self.TOLERANCIA,
        }
        args.update(kwargs)
        return worker.decidir_espera(**args)

    def test_alcancou_e_parou_conclui(self) -> None:
        self.assertEqual(self._decidir(delta=2, estavel=True), "concluido")

    def test_alcancou_mas_ainda_subindo_espera(self) -> None:
        """Despejo de lixo em curso: ler agora daria um número pequeno demais."""
        self.assertEqual(self._decidir(delta=2, estavel=False), "continuar")

    def test_job_grande_demorando_nao_e_reprovado(self) -> None:
        """35 folhas levam ~100s: enquanto o contador sobe, a espera continua."""
        self.assertEqual(
            self._decidir(delta=26, folhas_esperadas=35, s_sem_progresso=3.0),
            "continuar",
        )

    def test_sem_papel_dentro_da_tolerancia_continua(self) -> None:
        """Alguém pode repor e o job termina — o pedido segue IMPRIMINDO."""
        self.assertEqual(
            self._decidir(delta=1, vazia=True, s_sem_progresso=300.0, s_sem_papel=300.0),
            "continuar",
        )

    def test_sem_papel_alem_da_tolerancia_desiste(self) -> None:
        self.assertEqual(
            self._decidir(delta=1, vazia=True, s_sem_progresso=700.0, s_sem_papel=600.0),
            "desistir",
        )

    def test_parado_com_papel_desiste_no_prazo_curto(self) -> None:
        """Cancelado no painel/atolamento: nada explica a parada."""
        self.assertEqual(self._decidir(delta=1, s_sem_progresso=60.0), "desistir")
        self.assertEqual(self._decidir(delta=1, s_sem_progresso=59.0), "continuar")

    def test_papel_acaba_depois_da_ultima_folha_conclui(self) -> None:
        """Bandeja vazia com o pedido completo não impede a conclusão."""
        self.assertEqual(
            self._decidir(delta=2, estavel=True, vazia=True, s_sem_papel=1.0),
            "concluido",
        )


class AguardarFolhasDoMotorTests(unittest.TestCase):
    """`aguardar_folhas_do_motor`: laço de sondagem sobre a política acima."""

    class _Cfg:
        snmp_community = "public"
        reachability_timeout = 3
        paper_wait_timeout = 600

    class _Relogio:
        """Relógio falso: cada sleep avança o tempo, sem esperar de verdade."""

        def __init__(self) -> None:
            self.agora = 0.0

        def monotonic(self) -> float:
            return self.agora

        def dormir(self, segundos: float) -> None:
            self.agora += segundos

    def _com_snmp(self, contador, bandeja=(-3, 0)):
        """Enfileira leituras do contador; a bandeja é fixa (nível, status).

        Esgotada a fila, repete a última: contador de impressora parada não muda.
        `bandeja` pode ser uma lista, para simular reposição no meio da espera.
        """
        seq = list(contador)
        ultima = contador[-1]
        bandejas = list(bandeja) if isinstance(bandeja, list) else [bandeja]
        ciclo = [0]  # cada leitura do contador abre um ciclo de sondagem

        def falso(host, oid, community, timeout):
            if oid == worker.OID_PAGINAS_MOTOR:
                ciclo[0] += 1
                return seq.pop(0) if seq else ultima
            atual = bandejas[min(ciclo[0] - 1, len(bandejas) - 1)]
            return atual[0] if oid == worker.OID_NIVEL_BANDEJA else atual[1]

        original_snmp = worker.snmp_get_int
        worker.snmp_get_int = falso
        self.addCleanup(lambda: setattr(worker, "snmp_get_int", original_snmp))
        original_host = worker.host_da_fila
        worker.host_da_fila = lambda cfg, fila: "10.74.1.109"
        self.addCleanup(lambda: setattr(worker, "host_da_fila", original_host))
        relogio = self._Relogio()
        mono, sono = worker.time.monotonic, worker.time.sleep
        worker.time.monotonic = relogio.monotonic
        worker.time.sleep = relogio.dormir
        self.addCleanup(lambda: setattr(worker.time, "monotonic", mono))
        self.addCleanup(lambda: setattr(worker.time, "sleep", sono))

    def test_job_limpo_delta_bate(self) -> None:
        self._com_snmp([1593, 1593])
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 1),
            (1, "concluido"),
        )

    def test_espera_o_motor_parar_de_subir(self) -> None:
        """Ler no meio do despejo daria 3; o certo é esperar chegar a 11."""
        self._com_snmp([1595, 1599, 1603, 1603])
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 2),
            (11, "concluido"),
        )

    def test_leitura_falha_no_meio_nao_apaga_o_delta(self) -> None:
        """Regressão do 44C56F93: era aqui que a medição se perdia inteira."""
        self._com_snmp([1593, None, 1593, 1593])
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 1),
            (1, "concluido"),
        )

    def test_snmp_mudo_desde_o_comeco_e_sem_leitura(self) -> None:
        self._com_snmp([None])
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 1),
            (None, "sem_leitura"),
        )

    def test_sem_marco_inicial_nao_conclui_nada(self) -> None:
        self._com_snmp([1592])
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", None, 1),
            (None, "sem_leitura"),
        )

    def test_papel_nao_reposto_devolve_o_que_saiu(self) -> None:
        """Teste de 1 folha: sai 1 de 2, bandeja vazia, ninguém repõe."""
        self._com_snmp([1593], bandeja=(0, 11))
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 2),
            (1, "sem_papel"),
        )

    def test_papel_reposto_a_tempo_conclui(self) -> None:
        """O caso que gerou 35 folhas reimpressas: repor tem de salvar o job."""
        self._com_snmp(
            [1593, 1593, 1593, 1594, 1594],
            bandeja=[(0, 11), (0, 11), (-3, 0), (-3, 0), (-3, 0)],
        )
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 2),
            (2, "concluido"),
        )

    def test_espera_longa_por_papel_nao_estoura_o_prazo_curto(self) -> None:
        """Reposição depois de 80s não pode cair no prazo de parada sem explicação.

        O relógio curto (60s) só corre com papel na bandeja; senão a reposição
        chegaria com ele já estourado e o pedido cairia em ERRO no ato.
        """
        vazia, cheia = (0, 11), (-3, 0)
        self._com_snmp(
            # 80s de bandeja vazia, alguns ciclos de aquecimento depois da
            # reposição (contador ainda parado) e só então a última folha.
            [1593] * 40 + [1593] * 5 + [1594, 1594],
            bandeja=[vazia] * 40 + [cheia],
        )
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 2),
            (2, "concluido"),
        )

    def test_parado_com_papel_desiste(self) -> None:
        self._com_snmp([1593])
        self.assertEqual(
            worker.aguardar_folhas_do_motor(self._Cfg(), "Titans_SPL", 1592, 2),
            (1, "parado"),
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
            worker.conferir_folhas(None, "Titans_SPL-215", 2, folhas_equipamento=2).problema
        )

    def test_papel_acaba_depois_da_ultima_folha_nao_e_erro(self) -> None:
        """Garantia pedida: bandeja zerar no fim de um job COMPLETO não é falha.

        O veredito só olha folhas produzidas — o estado do papel depois não
        entra na conta. Delta == esperado => IMPRESSO, bandeja vazia ou não.
        """
        self._sem_desfecho_do_cupsd()
        self.assertIsNone(
            worker.conferir_folhas(None, "Titans_SPL-216", 3, folhas_equipamento=3).problema
        )

    def test_lixo_queimando_a_bandeja_acusa(self) -> None:
        """Caso real do job 211: 11 folhas para um pedido de 2."""
        self._sem_desfecho_do_cupsd()
        problema = worker.conferir_folhas(None, "Titans_SPL-211", 2, folhas_equipamento=11).problema
        self.assertIsNotNone(problema)
        self.assertIn("11 folha(s)", problema)
        self.assertIn("lixo binário", problema)

    def test_impressao_incompleta_acusa_sem_falar_em_lixo(self) -> None:
        self._sem_desfecho_do_cupsd()
        problema = worker.conferir_folhas(None, "Titans_SPL-217", 5, folhas_equipamento=2).problema
        self.assertIsNotNone(problema)
        self.assertIn("incompleta", problema)
        self.assertNotIn("lixo binário", problema)

    def test_cupsd_sozinho_nao_aprova(self) -> None:
        """Regressão do 44C56F93: o cupsd registrou 2 folhas num job que deu 1.

        Em fila `socket://` esse número é o que o filtro empurrou para o socket,
        não o que a impressora fez. Sem o motor, o desfecho é "não verificado" —
        nunca "saiu certo".
        """
        original = worker.desfecho_do_job
        worker.desfecho_do_job = lambda cfg, job_id: {
            "job_state": worker.JOB_COMPLETED,
            "job_state_reasons": ["processing-to-stop-point"],
            "folhas": 2,
        }
        self.addCleanup(lambda: setattr(worker, "desfecho_do_job", original))
        veredito = worker.conferir_folhas(None, "Titans_SPL-224", 2, folhas_equipamento=None)
        self.assertIsNone(veredito.problema)
        self.assertFalse(veredito.verificado)

    def test_motor_aprova_de_verdade(self) -> None:
        self._sem_desfecho_do_cupsd()
        self.assertTrue(
            worker.conferir_folhas(None, "Titans_SPL-215", 2, folhas_equipamento=2).verificado
        )

    def test_sem_papel_tem_motivo_proprio(self) -> None:
        self._sem_desfecho_do_cupsd()
        problema = worker.conferir_folhas(
            None, "Titans_SPL-224", 2, folhas_equipamento=1, sem_papel=True
        ).problema
        self.assertIn("sem papel", problema)
        self.assertIn("1 de 2", problema)
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
        problema = worker.conferir_folhas(None, "Titans_Laser-196", 1, folhas_equipamento=None).problema
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


class FilaContaPorIppTests(unittest.TestCase):
    """`fila_conta_por_ipp`: em que filas a impressora registra o job dela."""

    def _com_device_uri(self, uri):
        original = worker.device_uri_da_fila
        worker.device_uri_da_fila = lambda fila: uri
        self.addCleanup(lambda: setattr(worker, "device_uri_da_fila", original))

    def test_fila_de_cabo_conta(self) -> None:
        """A ponte ippusbxd é IPP de verdade — o equipamento registra o job."""
        self._com_device_uri("ipp://127.0.0.1:60000/ipp/print")
        self.assertTrue(worker.fila_conta_por_ipp("Titans_USB"))

    def test_fila_ipp_de_rede_conta(self) -> None:
        self._com_device_uri("ipp://HPE4E749FC401D.local/ipp/print")
        self.assertTrue(worker.fila_conta_por_ipp("Titans_Laser"))

    def test_fila_socket_nao_conta(self) -> None:
        """Porta RAW: o fluxo entra sem virar job na lista IPP da impressora."""
        self._com_device_uri("socket://10.74.1.109:9100")
        self.assertFalse(worker.fila_conta_por_ipp("Titans_SPL"))

    def test_sem_device_uri_nao_conta(self) -> None:
        self._com_device_uri(None)
        self.assertFalse(worker.fila_conta_por_ipp("Titans_SPL"))


class ParseJobsEquipamentoTests(unittest.TestCase):
    """`_parse_jobs_equipamento`: saída real de um Get-Jobs na 135w."""

    # Capturado de `ipptool -tv ipp://127.0.0.1:60000/ipp/print` (fila de cabo).
    # Os dois jobs vieram de um celular por AirPrint — servem justamente para
    # provar que job de terceiro é enxergado e precisa ser filtrado.
    SAIDA = """    jobs                                                                 [PASS]
        RECEIVED: 472 bytes in response
        status-code = successful-ok (successful-ok)
        attributes-charset (charset) = utf-8
        printer-uri (uri) = ipp://127.0.0.1:60000/ipp/print
        job-id (integer) = 880
        job-state (enum) = completed
        job-name (nameWithoutLanguage) = Cartaz_Impressao.png
        job-media-sheets-completed (integer) = 1
        -- separator --
        job-id (integer) = 881
        job-state (enum) = completed
        job-name (nameWithoutLanguage) = Cartaz_Impressao.png
        job-media-sheets-completed (integer) = 8
"""

    def test_le_os_dois_jobs(self) -> None:
        jobs = worker._parse_jobs_equipamento(self.SAIDA)
        self.assertEqual([j["job_id"] for j in jobs], [880, 881])
        self.assertEqual([j["folhas"] for j in jobs], [1, 8])
        self.assertEqual({j["nome"] for j in jobs}, {"Cartaz_Impressao.png"})

    def test_eco_da_requisicao_nao_vira_job(self) -> None:
        """A linha `requested-attributes` cita `job-id` sem ser um job."""
        eco = (
            "    Get-Jobs:\n"
            "        which-jobs (keyword) = all\n"
            "        requested-attributes (1setOf keyword) = "
            "job-id,job-name,job-state,job-media-sheets-completed\n"
        )
        self.assertEqual(worker._parse_jobs_equipamento(eco), [])

    def test_job_state_reasons_nao_e_lido_como_job_state(self) -> None:
        saida = (
            "        job-id (integer) = 900\n"
            "        job-state-reasons (keyword) = job-completed-successfully\n"
            "        job-media-sheets-completed (integer) = 2\n"
        )
        self.assertIsNone(worker._parse_jobs_equipamento(saida)[0]["job_state"])

    def test_job_sem_contagem_fica_com_folhas_none(self) -> None:
        saida = "        job-id (integer) = 887\n        job-state (enum) = pending-held\n"
        job = worker._parse_jobs_equipamento(saida)[0]
        self.assertIsNone(job["folhas"])
        self.assertEqual(job["job_state"], 4)


class FolhasDoEquipamentoTests(unittest.TestCase):
    """`folhas_do_equipamento`: a contagem que sustenta a fila de cabo."""

    NOSSO = "print-worker-ab12cd.pdf"

    def _com_jobs(self, jobs):
        original = worker.jobs_do_equipamento
        worker.jobs_do_equipamento = lambda cfg, fila: jobs
        self.addCleanup(lambda: setattr(worker, "jobs_do_equipamento", original))

    @staticmethod
    def _job(job_id, nome, folhas):
        return {"job_id": job_id, "nome": nome, "folhas": folhas, "job_state": 9}

    def test_soma_so_o_nosso_job(self) -> None:
        self._com_jobs([self._job(890, self.NOSSO, 3)])
        self.assertEqual(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO), 3
        )

    def test_job_de_terceiro_nao_entra_na_conta(self) -> None:
        """AirPrint de celular caindo entre o marco e a leitura."""
        self._com_jobs(
            [
                self._job(890, "Cartaz_Impressao.png", 8),
                self._job(891, self.NOSSO, 2),
            ]
        )
        self.assertEqual(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO), 2
        )

    def test_job_anterior_ao_marco_nao_entra(self) -> None:
        """Reimpressão do mesmo pedido: o nome repete, o marco é que separa."""
        self._com_jobs([self._job(880, self.NOSSO, 5), self._job(890, self.NOSSO, 2)])
        self.assertEqual(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO), 2
        )

    def test_lixo_binario_e_acusado(self) -> None:
        """O equipamento contando mais folhas que o pedido é a assinatura."""
        self._com_jobs([self._job(890, self.NOSSO, 11)])
        self.assertEqual(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO), 11
        )

    def test_nenhum_job_nosso_vira_none_e_nao_zero(self) -> None:
        """Zero condenaria um pedido correto; ignorância tem de dizer None."""
        self._com_jobs([self._job(890, "Cartaz_Impressao.png", 8)])
        self.assertIsNone(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO)
        )

    def test_job_nosso_sem_contagem_vira_none(self) -> None:
        """Somar só a parte legível daria um número baixo demais."""
        self._com_jobs(
            [self._job(890, self.NOSSO, 2), self._job(891, self.NOSSO, None)]
        )
        self.assertIsNone(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO)
        )

    def test_lista_ilegivel_vira_none(self) -> None:
        self._com_jobs(None)
        self.assertIsNone(
            worker.folhas_do_equipamento(None, "Titans_USB", 889, self.NOSSO)
        )

    def test_sem_marco_nao_ha_o_que_comparar(self) -> None:
        """Marco None (fila socket, ou leitura falhou): não se inventa contagem."""
        self._com_jobs([self._job(890, self.NOSSO, 3)])
        self.assertIsNone(
            worker.folhas_do_equipamento(None, "Titans_USB", None, self.NOSSO)
        )


class MarcoJobsDoEquipamentoTests(unittest.TestCase):
    """`marco_jobs_do_equipamento`: o marco zero da contagem por IPP."""

    def _com_jobs(self, jobs):
        original = worker.jobs_do_equipamento
        worker.jobs_do_equipamento = lambda cfg, fila: jobs
        self.addCleanup(lambda: setattr(worker, "jobs_do_equipamento", original))

    def test_maior_id_da_lista(self) -> None:
        self._com_jobs(
            [
                {"job_id": 880, "nome": "a", "folhas": 1, "job_state": 9},
                {"job_id": 887, "nome": "b", "folhas": 0, "job_state": 4},
            ]
        )
        self.assertEqual(worker.marco_jobs_do_equipamento(None, "Titans_USB"), 887)

    def test_lista_vazia_e_leitura_boa_e_vale_zero(self) -> None:
        """Impressora sem job nenhum: qualquer job novo terá id maior que 0."""
        self._com_jobs([])
        self.assertEqual(worker.marco_jobs_do_equipamento(None, "Titans_USB"), 0)

    def test_lista_ilegivel_vira_none(self) -> None:
        """None e 0 são coisas diferentes: um é ignorância, o outro é medida."""
        self._com_jobs(None)
        self.assertIsNone(worker.marco_jobs_do_equipamento(None, "Titans_USB"))


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
