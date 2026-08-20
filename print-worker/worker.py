"""Print worker para a fila web-to-print.

Roda continuamente numa máquina Linux ligada à HP Laser MFP 135w. A cada ciclo:
  1. devolve para PAGO pedidos presos em IMPRIMINDO (recuperação de travados);
  2. pega o pedido PAGO mais antigo (FIFO);
  3. reivindica-o atomicamente (PAGO -> IMPRIMINDO);
  4. baixa o PDF do bucket privado, reconfere a contagem de páginas;
  5. imprime via CUPS (lp) e acompanha a conclusão do job;
  6. marca IMPRESSO (sucesso) ou ERRO (falha/divergência).

Configuração por variáveis de ambiente — ver .env.example.
"""

from __future__ import annotations

import io
import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import NamedTuple
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from pypdf import PdfReader, PdfWriter
from supabase import Client, create_client

TABLE = "fila_impressao"
BUCKET = "pdfs-impressao"

# Locale neutro nos utilitários do CUPS: a saída do `lp` é localizada
# (ex.: "id de requisição é ..." em pt-BR), e o parsing do job id depende
# do texto em inglês ("request id is ...").
CUPS_ENV = {**os.environ, "LC_ALL": "C"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("print-worker")


class FalhaPreSubmissao(Exception):
    """Falha ocorrida ANTES de o CUPS aceitar o job (nada foi impresso).

    Sinaliza que é seguro tentar a próxima fila (failover): a fila estava
    insalubre, o `lp` retornou erro de submissão, ou retornou sucesso mas sem
    job id rastreável. Distinta de qualquer falha pós-aceitação, em que o
    failover é proibido para não duplicar a impressão.
    """


class Config:
    def __init__(self) -> None:
        self.supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        self.service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.printer_name = os.environ.get("PRINTER_NAME", "").strip()
        self.printer_name_fallback = os.environ.get("PRINTER_NAME_FALLBACK", "").strip()
        self.poll_interval = int(os.environ.get("POLL_INTERVAL", "10"))
        self.print_timeout = int(os.environ.get("PRINT_TIMEOUT", "180"))
        # Quanto tempo o pedido espera, ainda em IMPRIMINDO, por alguém repor o
        # papel que acabou no meio do job (ver `decidir_espera`).
        self.paper_wait_timeout = int(os.environ.get("PAPER_WAIT_TIMEOUT", "600"))
        # Precisa caber PRINT_TIMEOUT + PAPER_WAIT_TIMEOUT + a folga da espera
        # parada (60s): um restart do worker dentro dessa janela devolveria o
        # pedido para PAGO e o reimprimiria duplicado.
        self.stuck_timeout = int(os.environ.get("STUCK_TIMEOUT", "1200"))
        self.reachability_timeout = int(os.environ.get("REACHABILITY_TIMEOUT", "3"))
        # Community SNMP v1 de leitura, usada só para o contador de páginas do
        # motor (ver `paginas_do_motor`). Vazia desliga a conferência por SNMP.
        self.snmp_community = os.environ.get("SNMP_COMMUNITY", "public").strip()
        # Notificação da equipe via Telegram Bot API (opcional): sem as duas
        # envs, as transições de saúde são apenas logadas — nada quebra.
        self.telegram_bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        self.telegram_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        # Opções `-o` passadas ao `lp`. Padrão `fit-to-page`: escala cada página
        # para a área imprimível preservando a proporção e auto-rotaciona páginas
        # em paisagem, evitando que PDFs deitados saiam cortados nas bordas em
        # filas driverless (IPP Everywhere). Tokens separados por espaço viram um
        # `-o <token>` cada (ex.: "fit-to-page media=A4"). Vazio = sem opções.
        self.lp_options = os.environ.get("LP_OPTIONS", "fit-to-page").split()

        missing = [
            name
            for name, value in (
                ("SUPABASE_URL", self.supabase_url),
                ("SUPABASE_SERVICE_ROLE_KEY", self.service_role_key),
                ("PRINTER_NAME", self.printer_name),
            )
            if not value
        ]
        if missing:
            raise SystemExit(
                "Variáveis de ambiente obrigatórias ausentes: " + ", ".join(missing)
            )


def filas_candidatas(cfg: Config) -> list[str]:
    """Filas a tentar, em ordem de prioridade: primária e, se houver, fallback.

    Retorna `[primária]` ou `[primária, fallback]`. A fallback é ignorada
    quando vazia ou idêntica à primária (failover para a mesma fila é inócuo e
    só confundiria os logs). Sem fallback, o comportamento é o de fila única.
    """
    filas = [cfg.printer_name]
    if cfg.printer_name_fallback and cfg.printer_name_fallback != cfg.printer_name:
        filas.append(cfg.printer_name_fallback)
    return filas


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mark(sb: Client, pedido_id: str, status: str, extra: dict | None = None) -> None:
    payload = {"status": status}
    if extra:
        payload.update(extra)
    sb.table(TABLE).update(payload).eq("id", pedido_id).execute()


def recuperar_travados(sb: Client, cfg: Config) -> None:
    """Devolve para PAGO pedidos presos em IMPRIMINDO além do STUCK_TIMEOUT."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=cfg.stuck_timeout)).isoformat()
    res = (
        sb.table(TABLE)
        .select("id")
        .eq("status", "IMPRIMINDO")
        .lt("paid_at", cutoff)
        .execute()
    )
    for row in res.data or []:
        pedido_id = row["id"]
        sb.table(TABLE).update({"status": "PAGO"}).eq("id", pedido_id).eq(
            "status", "IMPRIMINDO"
        ).execute()
        log.warning("Pedido %s travado em IMPRIMINDO -> re-fila como PAGO", pedido_id)


def proximo_pago(sb: Client):
    res = (
        sb.table(TABLE)
        .select("*")
        .eq("status", "PAGO")
        .order("paid_at", desc=False)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def reivindicar(sb: Client, pedido_id: str) -> bool:
    """Claim atômico PAGO -> IMPRIMINDO. True se este worker venceu."""
    res = (
        sb.table(TABLE)
        .update({"status": "IMPRIMINDO"})
        .eq("id", pedido_id)
        .eq("status", "PAGO")
        .execute()
    )
    return bool(res.data)


def baixar_pdf(sb: Client, pdf_path: str, tentativas: int = 3) -> bytes:
    ultimo_erro: Exception | None = None
    for tentativa in range(1, tentativas + 1):
        try:
            return sb.storage.from_(BUCKET).download(pdf_path)
        except Exception as err:  # noqa: BLE001 - logado e re-tentado
            ultimo_erro = err
            log.warning("Falha ao baixar %s (tentativa %d/%d): %s", pdf_path, tentativa, tentativas, err)
            time.sleep(2)
    raise RuntimeError(f"Download falhou após {tentativas} tentativas") from ultimo_erro


def contar_paginas(pdf_bytes: bytes) -> int:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    if reader.is_encrypted:
        raise ValueError("PDF criptografado")
    return len(reader.pages)


def quantidade_copias_do_pedido(pedido: dict) -> int:
    """Lê quantidade_copias da linha com fallback 1 (linhas legadas/None) e piso 1."""
    valor = pedido.get("quantidade_copias")
    if not isinstance(valor, int) or valor < 1:
        return 1
    return valor


def replicar_pdf(pdf_bytes: bytes, copias: int) -> bytes:
    """Concatena o documento `copias` vezes num único PDF (cópias intercaladas).

    Driver-independente: a HP Laser 135w ignora a opção de cópias do CUPS
    (`lp -n` / `-o copies`), então replicamos as páginas no próprio arquivo e
    imprimimos um único job de 1 cópia. Para `copias <= 1` retorna o original.
    """
    if copias <= 1:
        return pdf_bytes
    writer = PdfWriter()
    for _ in range(copias):
        # Reabrir o reader a cada volta evita reutilizar os mesmos objetos de
        # página (referências compartilhadas) entre as cópias.
        writer.append(PdfReader(io.BytesIO(pdf_bytes)))
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


# Esquemas de device-uri que apontam para um destino de REDE (alcançabilidade
# real é verificável por resolução de host + TCP-connect). Filas USB/locais
# (usb://, hp:/usb/..., file://) não entram aqui: a checagem de rede não se aplica.
REDE_SCHEMES = {"ipp", "ipps", "http", "https", "socket"}
PORTA_PADRAO = {"ipp": 631, "ipps": 631, "http": 631, "https": 631, "socket": 9100}


def device_uri_da_fila(fila: str) -> str | None:
    """Retorna o device-uri da fila via `lpstat -v <fila>`, ou None se indisponível.

    Saída típica (locale C): "device for Titans_Laser: ipp://Host.local:631/ipp/print".
    """
    try:
        proc = subprocess.run(
            ["lpstat", "-v", fila],
            capture_output=True,
            text=True,
            timeout=10,
            env=CUPS_ENV,
        )
    except Exception as err:  # noqa: BLE001 - timeout/erro => degrada p/ health-check
        log.warning("Não consegui obter device-uri da fila %s: %s", fila, err)
        return None
    if proc.returncode != 0:
        return None
    # "device for <fila>: <uri>" — o primeiro ':' encerra o nome da fila.
    match = re.search(r"device for [^:]+:\s*(\S+)", proc.stdout)
    return match.group(1) if match else None


def parse_device_uri(uri: str) -> tuple[str, str, int] | None:
    """Extrai (esquema, host, porta) do device-uri; None se não interpretável.

    Porta padrão por esquema (631 IPP/HTTP, 9100 socket). Esquemas sem host de
    rede (usb://, hp:/usb/...) retornam host vazio e são tratados como não-rede.
    """
    try:
        parsed = urlparse(uri)
    except Exception:  # noqa: BLE001 - uri malformado => não interpretável
        return None
    scheme = (parsed.scheme or "").lower()
    if not scheme:
        return None
    host = parsed.hostname or ""
    try:
        porta = parsed.port or PORTA_PADRAO.get(scheme, 631)
    except ValueError:
        porta = PORTA_PADRAO.get(scheme, 631)
    return scheme, host, porta


def resolver_host(host: str, timeout: int) -> str | None:
    """Resolve `host` (mDNS `.local` incluído) para um IP; None se não resolver.

    IP literal é devolvido como está, sem subprocesso: `getent hosts <ip>` faz
    resolução REVERSA, que sai na rede (mDNS/DNS) e falha em blip de Wi-Fi. Era
    o caminho por onde a leitura do contador do motor se perdia no meio de um
    job (`socket://10.74.1.109:9100` — o IP já estava ali) e por onde a fila
    virava INALCANCAVEL sem a impressora ter saído do ar.

    Nome: tenta `getent hosts` (cobre mDNS quando o nsswitch tem `mdns`) e, se
    falhar, `avahi-resolve-host-name -4`.
    """
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        pass  # não é IP literal: resolve de verdade
    try:
        proc = subprocess.run(
            ["getent", "hosts", host],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=CUPS_ENV,
        )
        if proc.returncode == 0 and proc.stdout.split():
            return proc.stdout.split()[0]
    except Exception as err:  # noqa: BLE001 - tenta o próximo resolvedor
        log.debug("getent hosts %s falhou: %s", host, err)
    try:
        proc = subprocess.run(
            ["avahi-resolve-host-name", "-4", host],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=CUPS_ENV,
        )
        partes = proc.stdout.split()
        if proc.returncode == 0 and len(partes) >= 2:
            return partes[1]
    except Exception as err:  # noqa: BLE001 - avahi ausente/timeout => não resolve
        log.debug("avahi-resolve-host-name %s falhou: %s", host, err)
    return None


def fila_alcancavel(cfg: Config, fila: str) -> bool:
    """Para filas de REDE, prova alcançabilidade real do destino antes de submeter.

    Diferente de `fila_saudavel` (que só vê o estado CUPS `enabled`, o qual
    permanece `enabled` mesmo com o host Wi-Fi caído), resolve o host do
    device-uri (mDNS `.local` incluído) e faz um TCP-connect curto à porta do
    destino. Retorna:
      - True  para filas USB/locais, filas de rede alcançáveis e também quando o
        device-uri não é legível/interpretável (degrada com segurança: nunca
        bloqueia a impressão por falha de parsing);
      - False só quando a fila é comprovadamente de rede e o host não resolve ou a
        porta recusa conexão -> classificar como PRÉ-SUBMISSÃO (nada enviado),
        autorizando o failover seguro para a fila de fallback.
    """
    uri = device_uri_da_fila(fila)
    if not uri:
        return True  # sem device-uri legível: degrada para o health-check
    parsed = parse_device_uri(uri)
    if not parsed:
        log.debug("Fila %s: device-uri %r não interpretável -> degrada", fila, uri)
        return True
    scheme, host, porta = parsed
    if scheme not in REDE_SCHEMES or not host:
        return True  # fila USB/local: checagem de rede não se aplica
    ip = resolver_host(host, cfg.reachability_timeout)
    if not ip:
        log.warning(
            "Fila %s: host %s não resolve (mDNS/DNS) -> destino inalcançável", fila, host
        )
        return False
    try:
        with socket.create_connection((ip, porta), timeout=cfg.reachability_timeout):
            log.debug("Fila %s: destino %s:%s alcançável", fila, host, porta)
            return True
    except OSError as err:
        log.warning(
            "Fila %s: %s:%s não aceita conexão (%s) -> destino inalcançável",
            fila,
            host,
            porta,
            err,
        )
        return False


def fila_saudavel(fila: str) -> bool:
    """Best-effort: a fila existe e está habilitada (`enabled`) no CUPS.

    Usa `lpstat -p <fila>`. Uma fila habilitada reporta "is idle"/"now printing";
    uma desabilitada/parada reporta "disabled". Erro/timeout do comando é tratado
    como insalubre. NÃO é a garantia anti-duplicação — só ajuda a escolher uma
    fila viva antes de submeter; a segurança vem da classificação de erro.
    """
    try:
        proc = subprocess.run(
            ["lpstat", "-p", fila],
            capture_output=True,
            text=True,
            timeout=10,
            env=CUPS_ENV,
        )
    except Exception as err:  # noqa: BLE001 - timeout/erro => insalubre
        log.warning("Health-check da fila %s falhou: %s", fila, err)
        return False
    if proc.returncode != 0:
        return False
    return "disabled" not in proc.stdout


def estado_da_fila(cfg: Config, fila: str) -> str:
    """Deriva o estado do heartbeat a partir dos mesmos sinais dos health-checks.

    - PAUSADA: a fila CUPS existe mas está `disabled` (pausada por um humano);
    - INALCANCAVEL: `lpstat` falhou/fila inexistente, o destino de rede não
      resolve/não aceita conexão (mesmo critério de `fila_alcancavel`), ou o
      firmware não está pronto (stopped/sem estado IPP legível na janela de
      boot) — assim a retenção segura os pedidos em PAGO até o idle, em vez de
      reivindicar e falhar. `processing` NÃO bloqueia: é o job do próprio
      worker, e o heartbeat precisa publicar IMPRIMINDO, não INALCANCAVEL.
      Atenção: `stopped` também é como o firmware apresenta falta de papel/
      toner/atolamento com job bloqueado — `saude_da_impressora` reexamina o
      INALCANCAVEL via IPP direto antes de publicá-lo;
    - OK: fila habilitada, destino alcançável e firmware pronto.
    """
    try:
        proc = subprocess.run(
            ["lpstat", "-p", fila],
            capture_output=True,
            text=True,
            timeout=10,
            env=CUPS_ENV,
        )
    except Exception as err:  # noqa: BLE001 - timeout/erro => indisponível
        log.debug("Heartbeat: lpstat -p %s falhou: %s", fila, err)
        return "INALCANCAVEL"
    if proc.returncode != 0:
        return "INALCANCAVEL"
    if "disabled" in proc.stdout:
        return "PAUSADA"
    if not fila_alcancavel(cfg, fila):
        return "INALCANCAVEL"
    if _printer_state_equipamento(cfg, fila) in (STOPPED, SEM_ESTADO):
        return "INALCANCAVEL"
    return "OK"


# --- Saúde física da impressora via IPP -------------------------------------
#
# A cada heartbeat o worker lê `printer-state-reasons` e `marker-levels` via
# `ipptool` (pacote cups-ipp-utils) e deriva estados de falha física:
# SEM_PAPEL, SEM_TONER e MANUTENCAO. Tudo best-effort: sem `ipptool`, timeout
# ou atributos ilegíveis, degrada para os health-checks existentes.

# Esquemas consultáveis diretamente por IPP. `dnssd://`/`usb://` etc. não são —
# nesses casos consultamos a fila CUPS local, que responde pelos equipamentos.
IPP_SCHEMES = {"ipp", "ipps", "http", "https"}

RAZOES_SEM_PAPEL = {"media-empty", "media-needed"}
RAZOES_MANUTENCAO = {"media-jam", "cover-open", "door-open"}

# Aviso (não bloqueia): toner a até 10% liga `detalhes.toner_baixo`.
TONER_BAIXO_PCT = 10

# Estados em que o worker NÃO deve reivindicar pedidos (ver deve_segurar_pedidos).
ESTADOS_BLOQUEANTES = {"SEM_PAPEL", "SEM_TONER", "MANUTENCAO", "INALCANCAVEL"}

# Pedido IPP mínimo para o `ipptool`: só os atributos de saúde que usamos.
ARQUIVO_IPP_SAUDE = """{
    NAME "Atributos de saude da impressora"
    OPERATION Get-Printer-Attributes
    GROUP operation-attributes-tag
    ATTR charset attributes-charset utf-8
    ATTR naturalLanguage attributes-natural-language en
    ATTR uri printer-uri $uri
    ATTR keyword requested-attributes printer-state,printer-state-reasons,marker-levels,marker-low-levels
}
"""

# Pedido IPP para o desfecho real de um job já submetido (ver conferir_folhas).
ARQUIVO_IPP_JOB = """{
    NAME "Desfecho do job"
    OPERATION Get-Job-Attributes
    GROUP operation-attributes-tag
    ATTR charset attributes-charset utf-8
    ATTR naturalLanguage attributes-natural-language en
    ATTR uri job-uri $uri
    ATTR keyword requested-attributes job-state,job-state-reasons,job-media-sheets-completed,job-impressions-completed
}
"""

# Pedido IPP para a lista de jobs DO EQUIPAMENTO (ver folhas_do_equipamento).
# `which-jobs all` inclui os já concluídos: quando perguntamos, o nosso job
# terminou — se pedíssemos só os ativos, ele já não estaria lá.
ARQUIVO_IPP_JOBS = """{
    NAME "Jobs do equipamento"
    OPERATION Get-Jobs
    GROUP operation-attributes-tag
    ATTR charset attributes-charset utf-8
    ATTR naturalLanguage attributes-natural-language en
    ATTR uri printer-uri $uri
    ATTR keyword which-jobs all
    ATTR keyword requested-attributes job-id,job-name,job-state,job-media-sheets-completed
}
"""

_ipp_test_paths: dict[str, str] = {}


def _arquivo_ipp(nome: str, conteudo: str) -> str:
    """Materializa (uma vez por `nome`) um pedido IPP em arquivo para o ipptool."""
    caminho = _ipp_test_paths.get(nome)
    if caminho is None or not os.path.exists(caminho):
        fd, caminho = tempfile.mkstemp(suffix=".test", prefix=f"print-worker-{nome}-")
        with os.fdopen(fd, "w") as fh:
            fh.write(conteudo)
        _ipp_test_paths[nome] = caminho
    return caminho


def _arquivo_ipp_teste() -> str:
    """Pedido IPP de saúde da impressora."""
    return _arquivo_ipp("ipp", ARQUIVO_IPP_SAUDE)


def alvo_ipp_da_fila(fila: str) -> str:
    """URI IPP a consultar, derivado do nome da fila — nunca um IP configurado.

    Preferência: o device URI do equipamento (fonte direta, sem o cache do
    CUPS) quando for um esquema IPP de rede; senão, a própria fila CUPS local.

    Filas `socket://host:9100` (driver nativo despejando o fluxo na porta RAW)
    não falam IPP no device URI, mas o EQUIPAMENTO é o mesmo e atende IPP na
    631. Sem essa tradução, toda a saúde (prontidão do firmware, SEM_PAPEL,
    SEM_TONER) cairia para a fila CUPS local, que responde com estado em cache
    mesmo com a impressora desligada — ou seja, não prova nada.
    """
    uri = device_uri_da_fila(fila)
    if uri:
        parsed = parse_device_uri(uri)
        if parsed and parsed[1]:
            scheme, host, _ = parsed
            if scheme in IPP_SCHEMES:
                return uri
            if scheme == "socket":
                if ":" in host:  # IPv6 literal precisa de colchetes no URI
                    host = f"[{host}]"
                return f"ipp://{host}:{PORTA_PADRAO['ipp']}/ipp/print"
    return f"ipp://localhost:631/printers/{fila}"


# Enum IPP `printer-state` (RFC 8011) e os nomes que o ipptool imprime por eles.
IDLE, PROCESSING, STOPPED = 3, 4, 5
PRINTER_STATE_POR_NOME = {"idle": IDLE, "processing": PROCESSING, "stopped": STOPPED}

# Enum IPP `job-state` (RFC 8011). `canceled`/`aborted` somem de `lpstat -o`
# exatamente como `completed` — daí a necessidade de olhar o enum.
JOB_CANCELED, JOB_ABORTED, JOB_COMPLETED = 7, 8, 9
JOB_STATE_POR_NOME = {
    "pending": 3,
    "pending-held": 4,
    "processing": 5,
    "processing-stopped": 6,
    "canceled": JOB_CANCELED,
    "aborted": JOB_ABORTED,
    "completed": JOB_COMPLETED,
}
JOB_NOME_POR_STATE = {v: k for k, v in JOB_STATE_POR_NOME.items()}
JOB_ESTADOS_DE_FALHA = {JOB_CANCELED, JOB_ABORTED}


def _parse_atributos_ipp(saida: str) -> dict:
    """Extrai razões, níveis e printer-state da saída `-tv` do ipptool (tolerante).

    Linhas típicas: `printer-state-reasons (keyword) = media-empty-error`,
    `marker-levels (integer) = 100` e `printer-state (enum) = idle` (algumas
    versões imprimem o número, ex.: `= 3`). Valores negativos de marker-levels
    significam "desconhecido" no IPP e viram None.
    """
    razoes: list[str] = []
    m = re.search(r"printer-state-reasons\s*\([^)]*\)\s*=\s*(.+)", saida)
    if m:
        razoes = [r.strip() for r in m.group(1).split(",") if r.strip()]

    def _inteiro(atributo: str) -> int | None:
        m = re.search(rf"{atributo}\s*\([^)]*\)\s*=\s*(-?\d+)", saida)
        if not m:
            return None
        valor = int(m.group(1))
        return valor if valor >= 0 else None

    def _printer_state() -> int | None:
        # `printer-state\s*\(` não casa com "printer-state-reasons" (segue "-").
        m = re.search(r"printer-state\s*\([^)]*\)\s*=\s*([\w-]+)", saida)
        if not m:
            return None
        bruto = m.group(1).lower()
        if bruto.isdigit():
            return int(bruto)
        return PRINTER_STATE_POR_NOME.get(bruto)

    return {
        "state_reasons": razoes,
        "toner_pct": _inteiro("marker-levels"),
        "toner_low_pct": _inteiro("marker-low-levels"),
        "printer_state": _printer_state(),
    }


def _consultar_ipp(cfg: Config, alvo: str) -> dict | None:
    """Roda o ipptool contra `alvo`; None em falha (best-effort, só loga)."""
    try:
        proc = subprocess.run(
            ["ipptool", "-tv", alvo, _arquivo_ipp_teste()],
            capture_output=True,
            text=True,
            timeout=max(cfg.reachability_timeout * 2, 5),
            env=CUPS_ENV,
        )
    except FileNotFoundError:
        log.warning(
            "ipptool ausente (instale cups-ipp-utils) — coleta de saúde IPP desativada"
        )
        return None
    except Exception as err:  # noqa: BLE001 - timeout/erro => degrada
        log.debug("ipptool contra %s falhou: %s", alvo, err)
        return None
    # Mesmo com returncode != 0 (status IPP inesperado) o `-tv` imprime os
    # atributos recebidos; só desistimos quando nada foi parseável.
    atributos = _parse_atributos_ipp(proc.stdout)
    if (
        not atributos["state_reasons"]
        and atributos["toner_pct"] is None
        and atributos["printer_state"] is None
    ):
        return None
    return atributos


def _uri_com_host_resolvido(cfg: Config, uri: str) -> str:
    """Reescreve o URI com o host resolvido para IP, preservando o caminho.

    O `ipptool` usa getaddrinfo e não resolve mDNS `.local` em sistemas sem
    nss-mdns; `resolver_host` (getent + avahi) cobre isso. Sem resolução,
    devolve o URI original (o ipptool ainda pode resolver DNS comum).
    """
    parsed = parse_device_uri(uri)
    if not parsed or not parsed[1]:
        return uri
    scheme, host, porta = parsed
    ip = resolver_host(host, cfg.reachability_timeout)
    if not ip or ip == host:
        return uri
    if ":" in ip:  # IPv6 precisa de colchetes no URI
        ip = f"[{ip}]"
    caminho = urlparse(uri).path or ""
    return f"{scheme}://{ip}:{porta}{caminho}"


def coletar_saude_ipp(cfg: Config, fila: str) -> dict | None:
    """Atributos de saúde da impressora: device URI direto, fallback fila local."""
    local = f"ipp://localhost:631/printers/{fila}"
    alvo = alvo_ipp_da_fila(fila)
    if alvo != local:
        alvo = _uri_com_host_resolvido(cfg, alvo)
    atributos = _consultar_ipp(cfg, alvo)
    if atributos is not None:
        return atributos
    if alvo != local:
        return _consultar_ipp(cfg, local)
    return None


def saude_ipp_direta(cfg: Config, fila: str) -> dict | None:
    """Atributos de saúde lidos SÓ do equipamento (sem fallback à fila local).

    Usada quando os health-checks dizem INALCANCAVEL: a fila CUPS local
    responde mesmo com a impressora desligada (estado em cache), então razões
    vindas dela não provam nada — só a resposta do próprio equipamento vale.
    """
    alvo = alvo_ipp_da_fila(fila)
    if alvo == f"ipp://localhost:631/printers/{fila}":
        return None
    return _consultar_ipp(cfg, _uri_com_host_resolvido(cfg, alvo))


# Sentinelas de _printer_state_equipamento para os casos sem enum legível.
SEM_ESTADO = "SEM_ESTADO"
NAO_CONSULTAVEL = "NAO_CONSULTAVEL"


def _printer_state_equipamento(cfg: Config, fila: str) -> int | str:
    """`printer-state` lido DIRETO do equipamento (nunca da fila CUPS local).

    A fila local responde pelo daemon e não prova o estado do firmware — a HP
    135w abre a porta IPP segundos antes de estar pronta, e um job enviado
    nessa janela sai como lixo binário. Retorna:
      - 3/4/5 (idle/processing/stopped): estado lido do equipamento;
      - SEM_ESTADO: a consulta ao equipamento falhou ou veio sem o atributo
        (janela de boot do firmware com a porta TCP já aberta);
      - NAO_CONSULTAVEL: sem como consultar com confiança (ipptool ausente, ou
        fila USB/local sem device URI IPP de rede) -> degradar para TCP-connect.
    """
    if shutil.which("ipptool") is None:
        return NAO_CONSULTAVEL
    alvo = alvo_ipp_da_fila(fila)
    if alvo == f"ipp://localhost:631/printers/{fila}":
        return NAO_CONSULTAVEL
    atributos = _consultar_ipp(cfg, _uri_com_host_resolvido(cfg, alvo))
    if atributos is None or atributos["printer_state"] is None:
        return SEM_ESTADO
    return atributos["printer_state"]


def impressora_pronta(cfg: Config, fila: str) -> bool | None:
    """Gate de prontidão pré-submissão: firmware precisa aceitar jobs.

    - True: equipamento reporta idle (3) ou processing (4) — enfileirar atrás
      de um job ativo (ex.: impressão manual por outra fila na mesma impressora
      física) é comportamento normal do IPP e não corrompe o nosso job;
    - False: reporta stopped (5), ou está alcançável por TCP mas a consulta
      IPP falha/sem estado (janela de boot do firmware, exatamente quando um
      job sairia como lixo binário). Falha de PRÉ-SUBMISSÃO: nada enviado,
      elegível a failover/retenção;
    - None: prontidão não consultável -> vale só o TCP-connect existente.
    """
    estado = _printer_state_equipamento(cfg, fila)
    if estado == NAO_CONSULTAVEL:
        return None
    return estado in (IDLE, PROCESSING)


def normalizar_razoes(razoes: list[str]) -> list[str]:
    """Remove sufixos IPP de severidade e ruído ("none"), preservando a ordem."""
    resultado = []
    for razao in razoes:
        razao = re.sub(r"-(report|warning|error)$", "", razao.strip())
        if razao and razao != "none":
            resultado.append(razao)
    return resultado


def estado_de_saude(
    razoes: list[str], toner_pct: int | None, toner_low_pct: int | None
) -> str | None:
    """Mapeia razões normalizadas + toner para um estado de falha física.

    Prioridade interna: SEM_TONER > SEM_PAPEL > MANUTENCAO. Razões
    desconhecidas não bloqueiam (fail-safe): ficam só em detalhes.state_reasons.
    `toner-empty` é a fonte mais confiável para SEM_TONER; o percentual no
    limiar `low` do equipamento (ou zerado) cobre firmwares que não emitem a razão.
    """
    conjunto = set(razoes)
    toner_esgotado = "toner-empty" in conjunto or (
        toner_pct is not None
        and (toner_pct == 0 or (toner_low_pct is not None and toner_pct <= toner_low_pct))
    )
    if toner_esgotado:
        return "SEM_TONER"
    if conjunto & RAZOES_SEM_PAPEL:
        return "SEM_PAPEL"
    if conjunto & RAZOES_MANUTENCAO:
        return "MANUTENCAO"
    return None


def derivar_fisico(saude: dict) -> tuple[str | None, dict]:
    """Estado físico (ou None) + `detalhes` a partir dos atributos IPP coletados."""
    razoes = normalizar_razoes(saude["state_reasons"])
    toner_pct = saude["toner_pct"]
    fisico = estado_de_saude(razoes, toner_pct, saude["toner_low_pct"])
    detalhes = {
        "toner_pct": toner_pct,
        "state_reasons": razoes,
        "toner_baixo": toner_pct is not None and toner_pct <= TONER_BAIXO_PCT,
    }
    return fisico, detalhes


def saude_da_impressora(cfg: Config, fila: str) -> tuple[str, dict]:
    """Estado do heartbeat + `detalhes`, combinando health-checks e IPP.

    INALCANCAVEL dos health-checks NÃO é definitivo: `printer-state = stopped`
    também cai nele (regra da janela de boot), e é exatamente como o firmware
    apresenta "parada por falta de papel/toner/atolamento" com job bloqueado.
    Por isso, antes de publicar INALCANCAVEL, consultamos o equipamento DIRETO
    (sem o cache da fila local): se ele responde e as razões mapeiam para uma
    falha física, publicamos a falha física — senão, INALCANCAVEL fica (a
    impressora está mesmo fora do ar ou em boot). Entre os demais estados, a
    prioridade é SEM_TONER > SEM_PAPEL > MANUTENCAO > PAUSADA > OK — falha
    física vence PAUSADA porque exige reposição/ação na impressora. Sem coleta
    IPP (best-effort), degrada para o estado dos health-checks, detalhes vazios.
    """
    estado = estado_da_fila(cfg, fila)
    if estado == "INALCANCAVEL":
        saude = saude_ipp_direta(cfg, fila)
        if saude is None:
            return estado, {}
        fisico, detalhes = derivar_fisico(saude)
        if fisico is None:
            return estado, {}
        return fisico, detalhes
    saude = coletar_saude_ipp(cfg, fila)
    if saude is None:
        return estado, {}
    fisico, detalhes = derivar_fisico(saude)
    return fisico or estado, detalhes


def saude_pela_fila_local(cfg: Config, fila: str) -> tuple[str, dict]:
    """Saúde SEM tocar no equipamento — só a fila CUPS local. Usada durante um job.

    `saude_da_impressora` abre duas transações IPP no equipamento por ciclo
    (`_printer_state_equipamento` e `coletar_saude_ipp`), além do TCP-connect de
    `fila_alcancavel`. Com POLL_INTERVAL de 10s, um job travado leva dezenas
    dessas conexões concorrendo com a transmissão PCLm do backend. A 135w é uma
    laser SOHO com atendimento IPP limitado, e essa concorrência é a principal
    suspeita dos jobs que travam até o PRINT_TIMEOUT despejando lixo binário.

    O cupsd local responde por `printer-state-reasons` a partir da própria
    comunicação do backend com o equipamento, então falha física (papel/toner)
    continua sendo detectada durante o job — sem abrir conexão nova na
    impressora. Best-effort: sem leitura, devolve OK e detalhes vazios (a fila
    está por definição operando, já que acabamos de submeter um job nela).
    """
    atributos = _consultar_ipp(cfg, f"ipp://localhost:631/printers/{fila}")
    if atributos is None:
        return "OK", {}
    fisico, detalhes = derivar_fisico(atributos)
    return fisico or "OK", detalhes


# Estados cuja ENTRADA aciona o aviso à equipe. PAUSADA/INALCANCAVEL ficam de
# fora: oscilam com Wi-Fi/ação humana deliberada e virariam ruído no Telegram.
ESTADOS_NOTIFICAVEIS = {"SEM_PAPEL", "SEM_TONER", "MANUTENCAO"}

# Estados que provam a impressora operando — só eles encerram um problema
# pendente com o aviso de recuperação (INALCANCAVEL/PAUSADA não provam reposição).
ESTADOS_OPERANTES = {"OK", "IMPRIMINDO"}

MENSAGEM_ESTADO = {
    "SEM_PAPEL": "🟡 Sem papel na bandeja — repor para a fila andar.",
    "SEM_TONER": "🔴 Toner esgotado — trocar o cartucho.",
    "MANUTENCAO": "🟠 Impressora precisa de atenção (atolamento ou tampa aberta).",
}

MENSAGEM_RECUPERACAO = {
    "SEM_PAPEL": "🟢 Papel reposto — impressora pronta e fila retomada.",
    "SEM_TONER": "🟢 Toner reposto — impressora pronta e fila retomada.",
    "MANUTENCAO": "🟢 Impressora normalizada — fila retomada.",
}


def linhas_de_transicao(
    estado_antigo: str | None,
    estado_novo: str,
    problema_pendente: str | None,
    toner_baixo_antigo: bool,
    toner_baixo_novo: bool,
) -> tuple[list[str], str | None]:
    """Mensagens a enviar nesta transição + novo problema pendente (função pura).

    - ENTRADA em problema notificável: avisa e registra o problema como
      pendente. A reentrada do MESMO problema ainda pendente (ex.: SEM_PAPEL ->
      INALCANCAVEL -> SEM_PAPEL num blip de rede, sem reposição no meio) não
      repete o aviso.
    - RECUPERAÇÃO: ao voltar a operar (OK/IMPRIMINDO) com problema pendente,
      avisa que foi resolvido — a equipe sabe da reposição sem ir ao local.
    - Toner baixo: aviso ortogonal na subida False -> True, como antes.

    Nunca dispara por heartbeat repetido de um mesmo estado.
    """
    linhas: list[str] = []
    pendente = problema_pendente
    if estado_novo in ESTADOS_NOTIFICAVEIS:
        if estado_novo != estado_antigo and estado_novo != problema_pendente:
            linhas.append(MENSAGEM_ESTADO[estado_novo])
        pendente = estado_novo
    elif estado_novo in ESTADOS_OPERANTES and problema_pendente is not None:
        linhas.append(MENSAGEM_RECUPERACAO[problema_pendente])
        pendente = None
    if toner_baixo_novo and not toner_baixo_antigo:
        linhas.append(f"🟡 Toner acabando (≤ {TONER_BAIXO_PCT}%) — providenciar reposição.")
    return linhas, pendente


def enviar_telegram(cfg: Config, texto: str) -> None:
    """Envia um texto à equipe via Telegram Bot API (sendMessage).

    Best-effort: envs ausentes ou falha de rede apenas logam; o heartbeat, a
    impressão e a marcação de status nunca são afetados.
    """
    if not cfg.telegram_bot_token or not cfg.telegram_chat_id:
        log.info(
            "Telegram não configurado — aviso não enviado: %s",
            texto.replace("\n", " | "),
        )
        return
    try:
        req = Request(
            f"https://api.telegram.org/bot{cfg.telegram_bot_token}/sendMessage",
            data=json.dumps({"chat_id": cfg.telegram_chat_id, "text": texto}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=5) as resp:
            if resp.status >= 300:
                log.warning("Telegram sendMessage retornou HTTP %s", resp.status)
    except Exception as err:  # noqa: BLE001 - best-effort: nunca derruba o ciclo
        log.warning("Notificação Telegram falhou (best-effort): %s", err)


def enviar_aviso_telegram(cfg: Config, linhas: list[str]) -> None:
    """Aviso de SAÚDE da impressora (transições de estado do heartbeat)."""
    if not linhas:
        return
    enviar_telegram(
        cfg,
        "🖨️ Impressora do totem\n" + "\n".join(linhas) + f"\nFila: {cfg.printer_name}",
    )


# --- Aviso de pedido em ERRO ------------------------------------------------
#
# Todo caminho que marca ERRO passa por `falhar_pedido`, que além da marcação
# manda uma mensagem à equipe com o que ela precisa para agir sem ir ao totem:
# protocolo (o mesmo código de 8 dígitos que o cliente vê), o que era esperado,
# quantas folhas de fato saíram e o comando de reimpressão já pronto.


def protocolo_do_pedido(pedido_id: str) -> str:
    """Protocolo visível ao cliente: 8 primeiros caracteres do UUID, maiúsculos.

    Mesma derivação da view `fila_publica` (`upper(left(id::text, 8))`), então o
    código do aviso é exatamente o que a equipe digita em `/reimprimir`.
    """
    return str(pedido_id)[:8].upper()


def mensagem_erro_pedido(
    pedido: dict,
    motivo: str,
    *,
    fila: str | None = None,
    job_id: str | None = None,
    folhas_impressas: int | None = None,
) -> str:
    """Texto do aviso de ERRO (função pura, testável sem rede nem impressora).

    `folhas_impressas` é o que a impressora comprovadamente produziu: 0 quando a
    falha é anterior a qualquer submissão, o delta do contador do motor quando
    houve conferência, e None quando não há prova (ex.: timeout com o job ainda
    em voo) — nesse caso o aviso diz "não confirmado" em vez de chutar um número.
    """
    protocolo = protocolo_do_pedido(pedido["id"])
    copias = quantidade_copias_do_pedido(pedido)
    paginas = pedido.get("num_paginas")

    linhas = [
        "❌ Pedido em ERRO",
        f"Protocolo: {protocolo}",
        f"Motivo: {motivo}",
    ]
    if isinstance(paginas, int):
        linhas.append(
            f"Esperado: {paginas} pág. × {copias} "
            f"{'cópia' if copias == 1 else 'cópias'} = {paginas * copias} folha(s)"
        )
    linhas.append(
        f"Impresso: {folhas_impressas} folha(s)"
        if folhas_impressas is not None
        else "Impresso: não confirmado"
    )
    if fila:
        linhas.append(f"Fila: {fila}" + (f" (job {job_id})" if job_id else ""))
    linhas.append(f"Reimprimir: /reimprimir {protocolo}")
    return "\n".join(linhas)


def falhar_pedido(
    sb: Client,
    cfg: Config,
    pedido: dict,
    motivo: str,
    *,
    fila: str | None = None,
    job_id: str | None = None,
    folhas_impressas: int | None = None,
) -> None:
    """Marca o pedido como ERRO e avisa a equipe no Telegram.

    A marcação vem primeiro e o aviso é best-effort: o que o cliente vê no totem
    nunca depende do Telegram estar configurado ou a Bot API estar de pé.
    """
    mark(sb, pedido["id"], "ERRO")
    enviar_telegram(
        cfg,
        mensagem_erro_pedido(
            pedido,
            motivo,
            fila=fila,
            job_id=job_id,
            folhas_impressas=folhas_impressas,
        ),
    )


def avisar_sem_conferencia(cfg: Config, pedido: dict, fila: str, job_id: str) -> None:
    """Avisa que o pedido saiu como IMPRESSO SEM prova de quanto papel saiu.

    Acontece quando o contador do motor não pôde ser lido (SNMP mudo, community
    errada, impressora trocada). Marcar ERRO aqui seria pior: reprovaria um
    pedido provavelmente correto e custaria uma reimpressão. O pedido segue
    Pronto e a equipe fica sabendo que aquele ficou sem conferência.
    """
    enviar_telegram(
        cfg,
        "\n".join(
            [
                "⚠️ Pedido impresso SEM conferência",
                f"Protocolo: {protocolo_do_pedido(pedido['id'])}",
                "Motivo: não foi possível ler o contador do motor da impressora",
                f"Fila: {fila} (job {job_id})",
                "O pedido foi marcado como Pronto — confira o papel se houver dúvida.",
            ]
        ),
    )


def deve_segurar_pedidos(cfg: Config, estado_saude: str | None) -> bool:
    """True quando o worker NÃO deve reivindicar pedidos neste ciclo.

    - None: o heartbeat ainda não fez a primeira leitura (worker recém-
      iniciado); espera um ciclo em vez de imprimir às cegas.
    - SEM_PAPEL/SEM_TONER/MANUTENCAO: falha física na impressora primária.
      Submeter deixaria o job preso até PRINT_TIMEOUT e o pedido cairia em
      ERRO — reter em PAGO é exatamente o que a spec exige.
    - INALCANCAVEL: retém apenas quando NÃO há fila de fallback utilizável.
      Com fallback saudável e alcançável, o failover pré-submissão existente
      resolve melhor: o pedido imprime na fallback em vez de esperar.
    """
    if estado_saude is None:
        return True
    if estado_saude in ("SEM_PAPEL", "SEM_TONER", "MANUTENCAO"):
        return True
    if estado_saude == "INALCANCAVEL":
        return not any(
            fila_saudavel(fila)
            and fila_alcancavel(cfg, fila)
            and impressora_pronta(cfg, fila) is not False
            for fila in filas_candidatas(cfg)[1:]
        )
    return False


class Heartbeat:
    """Publica o estado da impressora em `impressora_status` (best-effort).

    Roda numa thread daemon com o mesmo período do poll, em vez de dentro do
    loop principal: durante uma impressão o loop fica bloqueado em
    `aguardar_conclusao` (até PRINT_TIMEOUT) e o heartbeat envelheceria — o
    kiosk considera o sistema offline com `atualizado_em` além de 3× o período,
    e isso só pode acontecer quando o worker realmente morreu.

    Usa um client Supabase próprio: o client síncrono não é garantidamente
    thread-safe para uso concorrente com o do loop principal. Toda falha de
    publicação é logada e engolida — o heartbeat nunca afeta a impressão.
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._sb = create_client(cfg.supabase_url, cfg.service_role_key)
        self._imprimindo = threading.Event()
        # Último estado de SAÚDE derivado (sem o override IMPRIMINDO), lido
        # pelo loop principal para decidir se reivindica pedidos neste ciclo.
        # None = nenhuma leitura ainda (worker recém-iniciado).
        self.estado_saude: str | None = None
        # Memória de transição para a notificação (só do que foi PUBLICADO com
        # sucesso — a fonte da verdade é o que o kiosk vê). `_problema_pendente`
        # é o problema já avisado e ainda não resolvido: dedup da reentrada e
        # gatilho do aviso de recuperação quando a impressora volta a operar.
        self._ultimo_publicado: str | None = None
        self._ultimo_toner_baixo = False
        self._problema_pendente: str | None = None
        # Falha física vista pelo próprio laço de impressão (SNMP), que enxerga
        # o que a sondagem leve não enxerga em fila socket://. Escrito por outra
        # thread: str é atribuição atômica, não precisa de lock.
        self._fisico_do_job: str | None = None
        self._semear_memoria()

    def _semear_memoria(self) -> None:
        """Continua a memória de transição da última linha publicada (best-effort).

        Sem isso, todo restart do worker re-avisaria um problema já notificado
        (None -> SEM_PAPEL) e esqueceria a recuperação pendente de antes do
        restart — a reposição do papel ficaria sem aviso.
        """
        try:
            res = (
                self._sb.table("impressora_status")
                .select("estado, detalhes")
                .limit(1)
                .execute()
            )
            row = res.data[0] if res.data else None
        except Exception as err:  # noqa: BLE001 - best-effort: memória zerada
            log.warning("Heartbeat: leitura inicial de impressora_status falhou: %s", err)
            return
        if not row:
            return
        estado = row.get("estado")
        self._ultimo_publicado = estado
        if estado in ESTADOS_NOTIFICAVEIS:
            self._problema_pendente = estado
        self._ultimo_toner_baixo = bool((row.get("detalhes") or {}).get("toner_baixo"))

    def marcar_imprimindo(self, ativo: bool) -> None:
        if ativo:
            self._imprimindo.set()
        else:
            self._imprimindo.clear()
            self._fisico_do_job = None

    def reportar_fisico(self, estado: str | None) -> None:
        """Falha física observada pelo laço de espera do job (SNMP direto).

        Em fila `socket://` o cupsd local não sabe da bandeja, então sem isto o
        kiosk mostraria IMPRIMINDO enquanto o pedido espera papel — e ninguém
        saberia que basta repor para o job terminar. `None` limpa.
        """
        self._fisico_do_job = estado

    def _publicar(self) -> None:
        if self._imprimindo.is_set():
            # Job em voo: sondagem leve, sem abrir conexão no equipamento (ver
            # saude_pela_fila_local). `estado_saude` NÃO é atualizado aqui —
            # mantém a última leitura completa, que o loop principal só consulta
            # entre pedidos; o primeiro heartbeat sem job em voo a renova.
            estado, detalhes = saude_pela_fila_local(self._cfg, self._cfg.printer_name)
            # O laço de espera lê a bandeja por SNMP e vence a sondagem leve.
            estado = self._fisico_do_job or estado
        else:
            estado, detalhes = saude_da_impressora(self._cfg, self._cfg.printer_name)
            self.estado_saude = estado
        # IMPRIMINDO só sobrepõe OK: uma falha física detectada no meio de um
        # job (ex.: papel acabou) tem prioridade na faixa do kiosk.
        publicado = "IMPRIMINDO" if estado == "OK" and self._imprimindo.is_set() else estado
        # Sem coleta IPP (detalhes vazios, ex.: INALCANCAVEL) não há leitura de
        # toner — manter a memória evita re-avisar "toner acabando" a cada blip.
        toner_baixo = (
            bool(detalhes.get("toner_baixo")) if detalhes else self._ultimo_toner_baixo
        )
        try:
            self._sb.table("impressora_status").upsert(
                {
                    "fila": self._cfg.printer_name,
                    "estado": publicado,
                    "detalhes": detalhes,
                    "atualizado_em": now_iso(),
                }
            ).execute()
        except Exception as err:  # noqa: BLE001 - best-effort: nunca derruba o worker
            log.warning("Heartbeat: upsert em impressora_status falhou: %s", err)
            return
        linhas, problema_pendente = linhas_de_transicao(
            self._ultimo_publicado,
            publicado,
            self._problema_pendente,
            self._ultimo_toner_baixo,
            toner_baixo,
        )
        enviar_aviso_telegram(self._cfg, linhas)
        self._ultimo_publicado = publicado
        self._ultimo_toner_baixo = toner_baixo
        self._problema_pendente = problema_pendente

    def _loop(self) -> None:
        while True:
            self._publicar()
            time.sleep(self._cfg.poll_interval)

    def start(self) -> None:
        threading.Thread(target=self._loop, daemon=True, name="heartbeat").start()


def enviar_para_impressora(fila: str, caminho: str, opcoes: list[str]) -> str:
    """Envia o arquivo via lp (1 job) na `fila` e retorna o job id do CUPS.

    `opcoes` são os tokens de `LP_OPTIONS`; cada um vira um `-o <token>` (ex.:
    `fit-to-page`, `media=A4`), controlando escala/mídia para que PDFs em
    paisagem não saiam cortados.

    Levanta `FalhaPreSubmissao` se o `lp` retornar erro ou se o job id não for
    extraível — ambos casos em que o CUPS NÃO aceitou o job (nada impresso),
    logo é seguro tentar a próxima fila.
    """
    cmd = ["lp", "-d", fila]
    for opcao in opcoes:
        cmd += ["-o", opcao]
    cmd.append(caminho)
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=CUPS_ENV,
    )
    if proc.returncode != 0:
        raise FalhaPreSubmissao(f"lp falhou: {proc.stderr.strip() or proc.stdout.strip()}")
    # Saída típica (locale C): "request id is Printer-42 (1 file(s))"
    match = re.search(r"request id is (\S+)", proc.stdout)
    if not match:
        raise FalhaPreSubmissao(f"Não consegui extrair job id de: {proc.stdout.strip()!r}")
    return match.group(1)


# --- Contador de páginas do motor, via SNMP ---------------------------------
#
# Numa fila IPP o desfecho vem de `job-media-sheets-completed`, preenchido pelo
# equipamento. Numa fila `socket://` (driver nativo despejando na porta RAW) esse
# número NÃO existe: a impressora não registra o job na lista IPP dela, e o cupsd
# local só ecoa as páginas que NÓS renderizamos — bate sempre e não prova nada.
#
# `prtMarkerLifeCount` (Printer MIB, RFC 3805) conta folha que passou pelo
# mecanismo, independente de como o job entrou. Lido antes e depois, o delta é
# quanto papel a impressora realmente gastou. Verificado na 135w: 1 folha
# impressa pela fila socket move o contador de 1592 para 1593.
#
# São duas leituras UDP por pedido, ambas FORA da janela de transmissão: a regra
# do df1b9f8 (não abrir conexão no equipamento enquanto um job está em voo)
# continua valendo, porque nenhuma delas acontece durante o job.

OID_PAGINAS_MOTOR = "1.3.6.1.2.1.43.10.2.1.4.1.1"  # prtMarkerLifeCount
# Sensor da bandeja, medido na 135w: com papel lê nível -3 ("tem papel, quanto é
# desconhecido") e status 0; vazia lê nível 0 e status 11 (bit 8 = alerta
# crítico). Serve só para ESTENDER a paciência da espera — ver `decidir_espera`.
OID_NIVEL_BANDEJA = "1.3.6.1.2.1.43.8.2.1.10.1.1"  # prtInputCurrentLevel
OID_STATUS_BANDEJA = "1.3.6.1.2.1.43.8.2.1.11.1.1"  # prtInputStatus
SNMP_PORTA = 161


def _ber_len(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    corpo = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(corpo)]) + corpo


def _tlv(tag: int, valor: bytes) -> bytes:
    return bytes([tag]) + _ber_len(len(valor)) + valor


def _ber_int(n: int) -> bytes:
    return _tlv(0x02, n.to_bytes(max(1, (n.bit_length() + 8) // 8), "big", signed=True))


def _ber_oid(oid: str) -> bytes:
    partes = [int(x) for x in oid.split(".")]
    corpo = bytes([partes[0] * 40 + partes[1]])
    for n in partes[2:]:
        if n < 128:
            corpo += bytes([n])
            continue
        sub = b""
        while n:
            sub = bytes([(n & 0x7F) | (0x80 if sub else 0)]) + sub
            n >>= 7
        corpo += sub
    return _tlv(0x06, corpo)


def _ler_tlv(buf: bytes, i: int) -> tuple[int, bytes, int]:
    """Lê um TLV BER em `buf` a partir de `i`; devolve (tag, valor, próximo i)."""
    tag = buf[i]
    tamanho = buf[i + 1]
    i += 2
    if tamanho & 0x80:  # forma longa: os 7 bits baixos dizem quantos bytes
        octetos = tamanho & 0x7F
        tamanho = int.from_bytes(buf[i : i + octetos], "big")
        i += octetos
    return tag, buf[i : i + tamanho], i + tamanho


def _valor_do_varbind(resposta: bytes) -> int | None:
    """Extrai o inteiro do 1º varbind de um GetResponse SNMP; None se não houver.

    Cobre INTEGER (0x02) e os tipos de contador da Printer MIB (Counter32,
    Gauge32, TimeTicks, Counter64). noSuchObject/noSuchInstance e error-status
    diferente de zero devolvem None — degradar é sempre melhor que chutar.
    """
    _, corpo, _ = _ler_tlv(resposta, 0)  # SEQUENCE da mensagem
    i = 0
    _, _, i = _ler_tlv(corpo, i)  # version
    _, _, i = _ler_tlv(corpo, i)  # community
    tag, pdu, _ = _ler_tlv(corpo, i)
    if tag != 0xA2:  # não é GetResponse
        return None
    j = 0
    _, _, j = _ler_tlv(pdu, j)  # request-id
    _, erro, j = _ler_tlv(pdu, j)  # error-status
    if int.from_bytes(erro, "big"):
        return None
    _, _, j = _ler_tlv(pdu, j)  # error-index
    _, varbinds, _ = _ler_tlv(pdu, j)
    _, varbind, _ = _ler_tlv(varbinds, 0)
    k = 0
    _, _, k = _ler_tlv(varbind, k)  # OID consultado
    tag, valor, _ = _ler_tlv(varbind, k)
    if tag == 0x02:
        return int.from_bytes(valor, "big", signed=True)
    if tag in (0x41, 0x42, 0x43, 0x46):
        return int.from_bytes(valor, "big")
    return None


def snmp_get_int(host: str, oid: str, community: str, timeout: int) -> int | None:
    """GET SNMP v1 de um único OID inteiro. None em qualquer falha (best-effort)."""
    pdu = _tlv(
        0xA0,
        _ber_int(1)  # request-id
        + _ber_int(0)  # error-status
        + _ber_int(0)  # error-index
        + _tlv(0x30, _tlv(0x30, _ber_oid(oid) + _tlv(0x05, b""))),
    )
    mensagem = _tlv(0x30, _ber_int(0) + _tlv(0x04, community.encode()) + pdu)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(timeout)
        sock.sendto(mensagem, (host, SNMP_PORTA))
        return _valor_do_varbind(sock.recvfrom(4096)[0])
    except Exception as err:  # noqa: BLE001 - timeout/resposta torta => degrada
        log.debug("SNMP %s em %s falhou: %s", oid, host, err)
        return None
    finally:
        sock.close()


def host_da_fila(cfg: Config, fila: str) -> str | None:
    """IP do equipamento por trás da fila; None para filas locais/ilegíveis."""
    uri = device_uri_da_fila(fila)
    if not uri:
        return None
    parsed = parse_device_uri(uri)
    if not parsed:
        return None
    scheme, host, _ = parsed
    if scheme not in REDE_SCHEMES or not host:
        return None
    return resolver_host(host, cfg.reachability_timeout)


def paginas_do_motor(cfg: Config, fila: str) -> int | None:
    """Contador de vida do motor da impressora; None se não for legível."""
    if not cfg.snmp_community:
        return None
    host = host_da_fila(cfg, fila)
    if host is None:
        return None
    return snmp_get_int(
        host, OID_PAGINAS_MOTOR, cfg.snmp_community, cfg.reachability_timeout
    )


# --- Espera pelo motor terminar o job ---------------------------------------
#
# Numa fila `socket://` o job some da fila CUPS assim que os bytes entram no
# socket — a impressora ainda está imprimindo. Esta espera cobre, portanto,
# quase todo o tempo FÍSICO do job, e por isso é guiada por PROGRESSO e não por
# relógio: o teto fixo que existia aqui reprovava pedido grande que estava só
# demorando (35 folhas levam ~100s na 135w, contra um teto de 60s), e cada
# reprovação dessas custava uma reimpressão inteira em papel.
#
# Falta de papel no meio do job NÃO é falha: o pedido continua IMPRIMINDO, a
# equipe é avisada, alguém repõe e a impressora termina sozinha. O sensor da
# bandeja só ESTENDE a paciência — nunca a encurta.

# Parada sem nada que a explique (cancelamento no painel, atolamento): é aqui
# que a espera desiste e o pedido cai em ERRO.
ESPERA_MOTOR_PARADO = 60
INTERVALO_SONDAGEM_MOTOR = 2


class EsperaMotor(NamedTuple):
    """Desfecho da espera pelo motor.

    `folhas` é o delta medido (None = nenhuma leitura funcionou, nunca 0 por
    falta de leitura). `motivo` diz por que a espera acabou: `concluido`,
    `sem_papel` (bandeja vazia além da tolerância), `parado` (motor calado sem
    explicação) ou `sem_leitura`.
    """

    folhas: int | None
    motivo: str


def bandeja_vazia(nivel: int | None, status: int | None) -> bool | None:
    """A bandeja está pedindo papel? None quando não há leitura.

    Medido na 135w: com papel, `prtInputCurrentLevel` = -3 (RFC 3805: "tem
    papel, quantidade desconhecida") e `prtInputStatus` = 0; vazia, nível 0 e
    status 11 = 8 (bit de alerta crítico) + 3. Nível negativo NÃO é vazio — é
    ausência de sensor de quantidade, que esta impressora não tem.
    """
    if nivel is None and status is None:
        return None
    if nivel is not None:
        return nivel == 0
    return bool(status & 8)


def decidir_espera(
    delta: int,
    folhas_esperadas: int,
    estavel: bool,
    vazia: bool | None,
    s_sem_progresso: float,
    s_sem_papel: float,
    tolerancia_sem_papel: int,
) -> str:
    """Política da espera: `continuar`, `concluido` ou `desistir`. Pura.

    - alcançou o esperado E o contador parou de subir => `concluido`. A
      exigência de estabilidade é o que pega o despejo de lixo binário que ainda
      vai estourar a bandeja: ler no meio dele daria um número pequeno demais;
    - parado abaixo do esperado com a BANDEJA VAZIA => `continuar` até a
      tolerância acabar. Alguém pode repor o papel e o job termina sozinho;
    - parado abaixo do esperado com papel na bandeja (cancelado no painel,
      atolamento) => `desistir` depois de `ESPERA_MOTOR_PARADO`;
    - contador subindo => quem chama zera `s_sem_progresso`, então `continuar`
      pelo tempo que o job precisar.
    """
    if delta >= folhas_esperadas and estavel:
        return "concluido"
    if vazia:
        return "desistir" if s_sem_papel >= tolerancia_sem_papel else "continuar"
    return "desistir" if s_sem_progresso >= ESPERA_MOTOR_PARADO else "continuar"


def aguardar_folhas_do_motor(
    cfg: Config,
    fila: str,
    motor_antes: int | None,
    folhas_esperadas: int,
    heartbeat: Heartbeat | None = None,
) -> EsperaMotor:
    """Acompanha o contador do motor até o job terminar — ou parar de vez.

    O host é resolvido UMA vez: reresolver a cada sondagem era um lookup de rede
    por iteração, e uma falha dele apagava a medição inteira — foi assim que um
    pedido com metade das folhas passou como IMPRESSO. Aqui, leitura falha só
    mantém o último delta bom; `None` fica reservado para "nunca deu para ler".

    São datagramas UDP com o job já fora da fila CUPS: a regra do df1b9f8 (não
    abrir conexão no equipamento durante a transmissão) continua valendo.
    """
    if motor_antes is None or not cfg.snmp_community:
        return EsperaMotor(None, "sem_leitura")
    host = host_da_fila(cfg, fila)
    if host is None:
        return EsperaMotor(None, "sem_leitura")

    def ler(oid: str) -> int | None:
        return snmp_get_int(host, oid, cfg.snmp_community, cfg.reachability_timeout)

    ultimo = motor_antes
    estavel = False
    leu_alguma = False
    marco_progresso = time.monotonic()
    marco_sem_papel: float | None = None
    try:
        while True:
            atual = ler(OID_PAGINAS_MOTOR)
            if atual is None and not leu_alguma:
                return EsperaMotor(None, "sem_leitura")  # SNMP mudo desde o começo
            if atual is not None:
                leu_alguma = True
                estavel = atual == ultimo
                if atual > ultimo:
                    ultimo = atual
                    marco_progresso = time.monotonic()
            else:
                estavel = False  # sem leitura nova não há prova de estabilidade

            vazia = bandeja_vazia(ler(OID_NIVEL_BANDEJA), ler(OID_STATUS_BANDEJA))
            agora = time.monotonic()
            if vazia:
                # O relógio curto da parada só corre com papel na bandeja. Sem
                # isto, a reposição chegaria com ele já estourado e o pedido
                # cairia em ERRO no instante seguinte — justamente o falso ERRO
                # que a tolerância existe para evitar.
                marco_progresso = agora
            if vazia and marco_sem_papel is None:
                marco_sem_papel = agora
                log.warning(
                    "Fila %s: bandeja vazia com o job em andamento (%s de %s folhas) "
                    "— pedido segue IMPRIMINDO por até %ss à espera de reposição",
                    fila,
                    ultimo - motor_antes,
                    folhas_esperadas,
                    cfg.paper_wait_timeout,
                )
                if heartbeat is not None:
                    heartbeat.reportar_fisico("SEM_PAPEL")
            elif not vazia and marco_sem_papel is not None:
                marco_sem_papel = None
                log.info("Fila %s: papel reposto — espera retomada", fila)
                if heartbeat is not None:
                    heartbeat.reportar_fisico(None)

            decisao = decidir_espera(
                ultimo - motor_antes,
                folhas_esperadas,
                estavel,
                vazia,
                agora - marco_progresso,
                agora - marco_sem_papel if marco_sem_papel is not None else 0.0,
                cfg.paper_wait_timeout,
            )
            if decisao == "concluido":
                return EsperaMotor(ultimo - motor_antes, "concluido")
            if decisao == "desistir":
                motivo = "sem_papel" if vazia else "parado"
                log.warning(
                    "Fila %s: motor parou em %s de %s folhas (%s)",
                    fila,
                    ultimo - motor_antes,
                    folhas_esperadas,
                    "papel não foi reposto a tempo" if vazia else "sem explicação",
                )
                return EsperaMotor(ultimo - motor_antes, motivo)
            time.sleep(INTERVALO_SONDAGEM_MOTOR)
    finally:
        if heartbeat is not None:
            heartbeat.reportar_fisico(None)


# --- Conferência do que a impressora REALMENTE imprimiu ----------------------
#
# `lpstat -o` não prova sucesso, e o `job-state` do cupsd local também não: o
# backend ipp abre um job SEPARADO na impressora (outro job-id) e, quando o
# firmware da 135w estraga a renderização e cancela o job dele, o job LOCAL
# ainda termina como `completed` — foi exatamente o caso do job 196 (1 página
# pedida, 2 folhas cuspidas de lixo binário, `completed` no cupsd).
#
# O que o backend propaga fielmente para o job local é a CONTAGEM DE FOLHAS
# vinda da impressora (`job-media-sheets-completed`). Nos episódios de lixo ela
# sempre estourou o esperado (5, 3 e 2 folhas para pedidos de 1 folha), e em
# todos os jobs saudáveis do histórico bateu exatamente — inclusive nos de
# múltiplas páginas e múltiplas cópias. É esse o sinal que usamos.
#
# Best-effort, como o resto do arquivo: sem leitura confiável, não inventamos
# falha — degradamos para o comportamento anterior (confiar na fila).


def numero_do_job(job_id: str) -> str | None:
    """`Titans_Laser-196` -> `196`; None se não houver sufixo numérico."""
    match = re.search(r"-(\d+)$", job_id)
    return match.group(1) if match else None


def _parse_desfecho_job(saida: str) -> dict:
    """Extrai job-state, razões e folhas impressas da saída `-tv` do ipptool.

    Mesmo cuidado do `printer-state`: `job-state\\s*\\(` não casa com
    `job-state-reasons` (que segue com "-"). O `-tv` pode imprimir o nome
    (`completed`) ou o número (`9`).
    """
    def _inteiro(atributo: str) -> int | None:
        m = re.search(rf"{atributo}\s*\([^)]*\)\s*=\s*(-?\d+)", saida)
        if not m:
            return None
        valor = int(m.group(1))
        return valor if valor >= 0 else None

    razoes: list[str] = []
    m = re.search(r"job-state-reasons\s*\([^)]*\)\s*=\s*(.+)", saida)
    if m:
        razoes = [r.strip() for r in m.group(1).split(",") if r.strip()]

    estado: int | None = None
    m = re.search(r"job-state\s*\([^)]*\)\s*=\s*([\w-]+)", saida)
    if m:
        bruto = m.group(1).lower()
        estado = int(bruto) if bruto.isdigit() else JOB_STATE_POR_NOME.get(bruto)

    return {
        "job_state": estado,
        "job_state_reasons": razoes,
        "folhas": _inteiro("job-media-sheets-completed"),
        "impressoes": _inteiro("job-impressions-completed"),
    }


def desfecho_do_job(cfg: Config, job_id: str) -> dict | None:
    """Desfecho do job no cupsd local (que preserva o histórico). None se ilegível."""
    numero = numero_do_job(job_id)
    if numero is None or shutil.which("ipptool") is None:
        return None
    try:
        proc = subprocess.run(
            [
                "ipptool",
                "-tv",
                f"ipp://localhost:631/jobs/{numero}",
                _arquivo_ipp("job", ARQUIVO_IPP_JOB),
            ],
            capture_output=True,
            text=True,
            timeout=max(cfg.reachability_timeout * 2, 5),
            env=CUPS_ENV,
        )
    except Exception as err:  # noqa: BLE001 - timeout/erro => degrada
        log.debug("ipptool (desfecho do job %s) falhou: %s", job_id, err)
        return None
    desfecho = _parse_desfecho_job(proc.stdout)
    if desfecho["job_state"] is None and desfecho["folhas"] is None:
        return None
    return desfecho


# --- Contagem de folhas pelo próprio equipamento, via IPP -------------------
#
# Numa fila IPP o equipamento registra cada job na lista IPP DELE, com
# `job-media-sheets-completed` contado pelo firmware. É a mesma qualidade de
# prova que o contador do motor dá por SNMP — com a diferença de andar pelo
# mesmo caminho por onde o documento foi. Na fila de cabo
# (`ipp://127.0.0.1:60000/ipp/print`, servida pelo ippusbxd) isso é o que torna
# a conferência possível sem Wi-Fi: o SNMP ali apontaria para o loopback e
# ficaria mudo, e todo pedido sairia IMPRESSO sem prova nenhuma.
#
# Esta impressora não expõe contador vitalício por IPP (não há
# `printer-impressions-completed`), então a medição é POR JOB: guardamos o maior
# job-id antes de submeter e, no fim, somamos as folhas dos jobs novos que sejam
# nossos.
#
# Uma única consulta, depois do job. Numa fila IPP o backend segura o job local
# até o remoto terminar, então quando `aguardar_conclusao` retorna a impressora
# já parou — nada é perguntado ao equipamento durante a transmissão e a regra do
# df1b9f8 continua valendo.


def fila_conta_por_ipp(fila: str) -> bool:
    """A impressora registra os jobs desta fila na lista IPP dela?

    Só quando o device URI é IPP: aí o job entra pelo servidor IPP do
    equipamento e ganha entrada na lista dele. Numa fila `socket://` o fluxo
    entra pela porta RAW e a impressora não registra job nenhum — perguntar ali
    gastaria uma transação para receber uma lista que nunca conteria o nosso.
    """
    uri = device_uri_da_fila(fila)
    if not uri:
        return False
    parsed = parse_device_uri(uri)
    return bool(parsed and parsed[1] and parsed[0] in IPP_SCHEMES)


def _parse_jobs_equipamento(saida: str) -> list[dict]:
    """Jobs da saída `-tv` de um Get-Jobs: um dict por bloco separado.

    O ipptool imprime os jobs em sequência, separados por `-- separator --`, e
    antes do primeiro vem o eco da requisição. Blocos sem um `job-id` legível
    são descartados, o que naturalmente descarta esse cabeçalho — a linha
    `requested-attributes ... = job-id,job-name,...` cita os nomes, mas nenhum
    deles vem seguido de `(tipo) = valor`.

    Mesma armadilha de regex do `_parse_desfecho_job`: `job-state\\s*\\(` não
    pode casar com `job-state-reasons`.
    """
    jobs: list[dict] = []
    for bloco in re.split(r"--\s*separator\s*--", saida):
        m = re.search(r"job-id\s*\([^)]*\)\s*=\s*(\d+)", bloco)
        if not m:
            continue
        job: dict = {
            "job_id": int(m.group(1)),
            "nome": None,
            "folhas": None,
            "job_state": None,
        }
        m = re.search(r"job-name\s*\([^)]*\)\s*=\s*(.*)", bloco)
        if m:
            job["nome"] = m.group(1).strip()
        m = re.search(
            r"job-media-sheets-completed\s*\([^)]*\)\s*=\s*(-?\d+)", bloco
        )
        if m and int(m.group(1)) >= 0:
            job["folhas"] = int(m.group(1))
        m = re.search(r"job-state\s*\([^)]*\)\s*=\s*([\w-]+)", bloco)
        if m:
            bruto = m.group(1).lower()
            job["job_state"] = (
                int(bruto) if bruto.isdigit() else JOB_STATE_POR_NOME.get(bruto)
            )
        jobs.append(job)
    return jobs


def jobs_do_equipamento(cfg: Config, fila: str) -> list[dict] | None:
    """Lista de jobs lida DO EQUIPAMENTO. None = não havia como perguntar.

    Lista vazia é resposta válida ("o equipamento não tem job nenhum") e é
    diferente de None ("não deu para ler") — a distinção é o que impede um
    silêncio de virar veredito.
    """
    if not fila_conta_por_ipp(fila) or shutil.which("ipptool") is None:
        return None
    alvo = _uri_com_host_resolvido(cfg, alvo_ipp_da_fila(fila))
    try:
        proc = subprocess.run(
            ["ipptool", "-tv", alvo, _arquivo_ipp("jobs", ARQUIVO_IPP_JOBS)],
            capture_output=True,
            text=True,
            timeout=max(cfg.reachability_timeout * 2, 5),
            env=CUPS_ENV,
        )
    except Exception as err:  # noqa: BLE001 - timeout/erro => degrada
        log.debug("ipptool (jobs do equipamento, fila %s) falhou: %s", fila, err)
        return None
    if "successful-ok" not in proc.stdout:
        log.debug("Fila %s: Get-Jobs sem successful-ok — sem contagem por IPP", fila)
        return None
    return _parse_jobs_equipamento(proc.stdout)


def marco_jobs_do_equipamento(cfg: Config, fila: str) -> int | None:
    """Maior job-id no equipamento ANTES de submeter; None se não deu para ler.

    Gêmeo do `paginas_do_motor` na contagem por SNMP: é o marco zero. Lido sem
    job em voo, então respeita a regra do df1b9f8.

    Lista vazia devolve 0 — "nenhum job ainda" é uma leitura BOA, e qualquer job
    novo terá id maior que zero. É o único lugar deste caminho onde zero
    significa sucesso em vez de ignorância.
    """
    jobs = jobs_do_equipamento(cfg, fila)
    if jobs is None:
        return None
    return max((j["job_id"] for j in jobs), default=0)


def folhas_do_equipamento(
    cfg: Config, fila: str, marco: int | None, nome_job: str
) -> int | None:
    """Folhas que o EQUIPAMENTO contou para o nosso job; None sem prova.

    Soma `job-media-sheets-completed` dos jobs com id acima do marco E com o
    nome que submetemos. O filtro por nome não é zelo: esta impressora aceita
    job de fora (AirPrint de celular entra direto nela), e um job de terceiro
    caindo entre o marco e a leitura viraria falso positivo — pedido correto
    reprovado, papel gasto de novo.

    Nenhum job nosso, ou algum deles sem contagem legível => None, NUNCA 0. O
    job-id do equipamento reinicia em ciclo de energia, e somar só a parte
    legível daria um número baixo demais: os dois casos condenariam um pedido
    que saiu certo.
    """
    if marco is None or not nome_job:
        return None
    jobs = jobs_do_equipamento(cfg, fila)
    if not jobs:
        return None
    nossos = [j for j in jobs if j["job_id"] > marco and j["nome"] == nome_job]
    if not nossos:
        log.debug(
            "Fila %s: nenhum job acima do marco %s com nome %r — sem contagem por IPP",
            fila,
            marco,
            nome_job,
        )
        return None
    if any(j["folhas"] is None for j in nossos):
        log.debug(
            "Fila %s: job %r sem job-media-sheets-completed legível — sem contagem",
            fila,
            nome_job,
        )
        return None
    return sum(j["folhas"] for j in nossos)


class Veredito(NamedTuple):
    """`problema` descreve a falha (None = sem falha). `verificado` diz se houve
    prova vinda do EQUIPAMENTO — sem ela, "sem problema" significa apenas "não
    foi possível conferir", e nunca "saiu certo"."""

    problema: str | None
    verificado: bool


def conferir_folhas(
    cfg: Config,
    job_id: str,
    folhas_esperadas: int,
    folhas_equipamento: int | None = None,
    *,
    sem_papel: bool = False,
) -> Veredito:
    """Descreve a falha se a impressora não produziu o esperado.

    Evidências, da mais forte para a mais fraca:

    1. `folhas_equipamento` — prova vinda da própria impressora, e a ÚNICA
       que aprova. Tem duas origens, conforme o que a fila permite ler:
       - delta do contador de vida do motor por SNMP (`paginas_do_motor`):
         folha que passou pelo mecanismo, vale para qualquer fila, inclusive
         `socket://`, mas a leitura anda pela rede — na fila de cabo o host é o
         loopback do ippusbxd e o SNMP fica mudo;
       - `job-media-sheets-completed` do job na lista IPP DO EQUIPAMENTO
         (`folhas_do_equipamento`): existe só em fila IPP, e é o que torna a
         fila de cabo conferível sem depender do Wi-Fi.
    2. o job terminou `canceled`/`aborted` no cupsd.
    3. `job-media-sheets-completed` do cupsd local. Só condena, nunca absolve:
       em fila `socket://` ele é o que o filtro empurrou para dentro do socket,
       não o que a impressora fez — registrou 35 folhas nos jobs 219 e 221, que
       o motor provou terem saído com 12 e 26, e 2 folhas no job 224, que saiu
       com 1. Foi confiando nele que um pedido pela metade virou IMPRESSO.

    Sem nenhuma prova do equipamento => `verificado=False`: quem chama decide o
    que fazer com um pedido que não deu para conferir (ver `processar`).

    Nota deliberada sobre papel: o veredito olha SÓ quantas folhas saíram. Se a
    bandeja zerar logo depois da última folha correta, o delta bate com o
    esperado e o pedido segue IMPRESSO — acabar o papel no fim de um job
    completo não é falha do job.
    """
    if folhas_equipamento is not None and folhas_equipamento != folhas_esperadas:
        if sem_papel:
            return Veredito(
                f"a impressora ficou sem papel no meio do pedido e não concluiu a "
                f"tempo — saíram {folhas_equipamento} de {folhas_esperadas} folha(s)",
                True,
            )
        return Veredito(
            f"a impressora gastou {folhas_equipamento} folha(s) para um pedido "
            f"de {folhas_esperadas}"
            + (
                " — provável despejo de lixo binário"
                if folhas_equipamento > folhas_esperadas
                else " — impressão incompleta"
            ),
            True,
        )
    if folhas_equipamento is not None:
        return Veredito(None, True)

    desfecho = desfecho_do_job(cfg, job_id)
    if desfecho is None:
        log.debug("Job %s: desfecho ilegível — nada a conferir", job_id)
        return Veredito(None, False)

    estado = desfecho["job_state"]
    if estado in JOB_ESTADOS_DE_FALHA:
        razoes = ", ".join(desfecho["job_state_reasons"]) or "sem razões"
        return Veredito(
            f"job terminou {JOB_NOME_POR_STATE.get(estado, estado)} ({razoes})", True
        )

    folhas = desfecho["folhas"]
    if folhas is not None and folhas != folhas_esperadas:
        razoes = ", ".join(desfecho["job_state_reasons"]) or "sem razões"
        return Veredito(
            f"a impressora contabilizou {folhas} folha(s) para um pedido de "
            f"{folhas_esperadas} — provável despejo de lixo binário ({razoes})",
            True,
        )
    return Veredito(None, False)


def aguardar_conclusao(cfg: Config, fila: str, job_id: str) -> bool:
    """Espera o job sumir da fila de não-concluídos. True se concluiu no tempo."""
    deadline = time.monotonic() + cfg.print_timeout
    while time.monotonic() < deadline:
        proc = subprocess.run(
            ["lpstat", "-o", fila],
            capture_output=True,
            text=True,
            env=CUPS_ENV,
        )
        ativos = proc.stdout
        if job_id not in ativos:
            return True
        time.sleep(2)
    return False


def purgar_spool(filas: list[str], momento: str) -> None:
    """Cancela TODOS os jobs das filas (spool é transporte; a verdade é o Supabase).

    Um job órfão retido no spool (ex.: transmissão interrompida por desligamento
    ou queda de rede) é retransmitido pelo CUPS sem o cabeçalho do fluxo PCLm, e
    a impressora o despeja como páginas de lixo binário. As filas configuradas
    são de uso exclusivo do worker, então cancelar tudo é seguro. NUNCA chamar
    entre a aceitação de um job e sua conclusão/cancelamento. Best-effort:
    qualquer falha vira warning e não bloqueia o processamento.
    """
    for fila in filas:
        try:
            proc = subprocess.run(
                ["cancel", "-a", fila],
                capture_output=True,
                text=True,
                timeout=10,
                env=CUPS_ENV,
            )
        except Exception as err:  # noqa: BLE001 - best-effort
            log.warning("Purga do spool da fila %s (%s) falhou: %s", fila, momento, err)
            continue
        if proc.returncode != 0:
            log.warning(
                "Purga do spool da fila %s (%s) falhou: %s",
                fila,
                momento,
                proc.stderr.strip() or proc.stdout.strip(),
            )


def cancelar_job(job_id: str) -> None:
    """Cancela o job pelo seu id (único no CUPS, já inclui a fila no nome)."""
    try:
        subprocess.run(["cancel", job_id], capture_output=True, text=True, timeout=10, env=CUPS_ENV)
    except Exception as err:  # noqa: BLE001
        log.warning("Falha ao cancelar job %s: %s", job_id, err)


def processar(
    sb: Client, cfg: Config, pedido: dict, heartbeat: Heartbeat | None = None
) -> None:
    pedido_id = pedido["id"]
    pdf_path = pedido["pdf_path"]
    num_paginas = pedido["num_paginas"]
    modo_cor = pedido.get("modo_cor")
    quantidade_copias = quantidade_copias_do_pedido(pedido)

    # Higiene do spool: nenhum job órfão pode sobrar para ser retransmitido como
    # lixo binário. Roda antes de qualquer submissão deste pedido; o fluxo
    # sequencial abaixo garante que a purga jamais alcança o job ativo do worker.
    purgar_spool(filas_candidatas(cfg), f"pré-submissão do pedido {pedido_id}")

    # Download + reconferência de páginas.
    try:
        pdf_bytes = baixar_pdf(sb, pdf_path)
    except Exception as err:  # noqa: BLE001
        log.error("Pedido %s: download falhou: %s", pedido_id, err)
        falhar_pedido(
            sb,
            cfg,
            pedido,
            f"não foi possível baixar o PDF do storage ({str(err)[:200]})",
            folhas_impressas=0,
        )
        return

    try:
        paginas_reais = contar_paginas(pdf_bytes)
    except Exception as err:  # noqa: BLE001
        log.error("Pedido %s: PDF inválido/ilegível: %s", pedido_id, err)
        falhar_pedido(
            sb,
            cfg,
            pedido,
            f"PDF inválido ou ilegível ({str(err)[:200]})",
            folhas_impressas=0,
        )
        return

    if paginas_reais != num_paginas:
        log.error(
            "Pedido %s: divergência de páginas (declarado=%s, real=%s) -> ERRO",
            pedido_id,
            num_paginas,
            paginas_reais,
        )
        falhar_pedido(
            sb,
            cfg,
            pedido,
            f"o PDF tem {paginas_reais} página(s), mas o pedido declara "
            f"{num_paginas} — nada foi impresso",
            folhas_impressas=0,
        )
        return

    if modo_cor == "COLORIDO":
        log.warning(
            "Pedido %s marcado COLORIDO, mas a 135w é mono: será impresso em tons de cinza.",
            pedido_id,
        )

    # Impressão. A 135w ignora a opção de cópias do CUPS, então as cópias são
    # materializadas no próprio PDF e enviadas como um único job.
    pdf_para_imprimir = replicar_pdf(pdf_bytes, quantidade_copias)

    fd, caminho = tempfile.mkstemp(suffix=".pdf", prefix="print-worker-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(pdf_para_imprimir)

        # Failover restrito à PRÉ-SUBMISSÃO. Tentamos as filas em ordem; uma
        # falha antes de o CUPS aceitar o job (fila insalubre, destino de rede
        # inalcançável, lp com erro, ou job id não extraível) é segura para
        # tentar a próxima. Uma vez aceito o job, NUNCA tentamos outra fila — o
        # pedido resolve em IMPRESSO ou ERRO naquela fila, evitando reimpressão
        # duplicada das N cópias.
        filas = filas_candidatas(cfg)
        for indice, fila in enumerate(filas):
            tem_proxima = indice + 1 < len(filas)
            if not fila_saudavel(fila):
                log.warning(
                    "Pedido %s: fila %s insalubre (health-check) -> %s",
                    pedido_id,
                    fila,
                    "tentando fallback" if tem_proxima else "sem mais filas",
                )
                continue  # falha de pré-submissão implícita: nada submetido

            # Alcançabilidade real do destino (cobre o host de rede Wi-Fi caído
            # que o health-check `enabled` não enxerga). Inalcançável = nada foi
            # enviado à impressora => pré-submissão segura => pode fazer failover.
            if not fila_alcancavel(cfg, fila):
                log.warning(
                    "Pedido %s: fila %s de rede inalcançável (pré-submissão, nada impresso) -> %s",
                    pedido_id,
                    fila,
                    "failover para fallback" if tem_proxima else "sem mais filas",
                )
                continue

            # Prontidão do firmware: porta TCP aberta não significa impressora
            # pronta (janela de boot). Não-pronta = pré-submissão, nada enviado.
            if impressora_pronta(cfg, fila) is False:
                log.warning(
                    "Pedido %s: fila %s alcançável mas impressora não pronta "
                    "(printer-state stopped/ilegível; pré-submissão, nada impresso) -> %s",
                    pedido_id,
                    fila,
                    "failover para fallback" if tem_proxima else "sem mais filas",
                )
                continue

            # Marco zero do contador do motor, lido ANTES de submeter: o delta
            # até o fim do job é o papel que a impressora de fato gastou. Aqui
            # ainda não há job em voo, então a regra do df1b9f8 é respeitada.
            motor_antes = paginas_do_motor(cfg, fila)
            # Marco gêmeo para filas IPP (é o caso da fila de cabo, onde o SNMP
            # apontaria para o loopback e não responderia). Em fila `socket://`
            # não custa transação nenhuma: `jobs_do_equipamento` desiste antes
            # de falar com o equipamento, porque ali ele não registra job.
            marco_jobs = marco_jobs_do_equipamento(cfg, fila)

            try:
                job_id = enviar_para_impressora(fila, caminho, cfg.lp_options)
            except FalhaPreSubmissao as err:
                log.warning(
                    "Pedido %s: pré-submissão à fila %s falhou (%s) -> %s",
                    pedido_id,
                    fila,
                    err,
                    "failover para fallback" if tem_proxima else "sem mais filas",
                )
                continue  # seguro: nada impresso -> próxima fila

            # A PARTIR DAQUI o CUPS aceitou o job: sem failover.
            log.info(
                "Pedido %s: aceito pela fila %s (job %s, %s páginas, %s cópias)",
                pedido_id,
                fila,
                job_id,
                paginas_reais,
                quantidade_copias,
            )

            if aguardar_conclusao(cfg, fila, job_id):
                # Sair da fila não prova que saiu certo: conferimos o que a
                # impressora de fato produziu antes de cobrar do cliente.
                folhas_esperadas = paginas_reais * quantidade_copias
                espera = aguardar_folhas_do_motor(
                    cfg, fila, motor_antes, folhas_esperadas, heartbeat
                )
                folhas = espera.folhas
                if folhas is None:
                    # SNMP mudo. Numa fila IPP ainda há prova a colher: o
                    # equipamento registrou o job na lista dele. É por aqui que
                    # a fila de cabo se confere, sem tocar no Wi-Fi.
                    folhas = folhas_do_equipamento(
                        cfg, fila, marco_jobs, os.path.basename(caminho)
                    )
                veredito = conferir_folhas(
                    cfg,
                    job_id,
                    folhas_esperadas,
                    folhas,
                    sem_papel=espera.motivo == "sem_papel",
                )
                if veredito.problema:
                    log.error(
                        "Pedido %s: job %s concluiu na fila %s mas %s -> ERRO",
                        pedido_id,
                        job_id,
                        fila,
                        veredito.problema,
                    )
                    falhar_pedido(
                        sb,
                        cfg,
                        pedido,
                        veredito.problema,
                        fila=fila,
                        job_id=job_id,
                        folhas_impressas=folhas,
                    )
                    return
                mark(sb, pedido_id, "IMPRESSO", {"printed_at": now_iso()})
                if veredito.verificado:
                    log.info("Pedido %s: IMPRESSO (fila %s)", pedido_id, fila)
                else:
                    # Aprovar sem prova é o que deixou um pedido pela metade
                    # passar por Pronto. Não vira ERRO (reprovaria pedido
                    # provavelmente correto), mas a equipe precisa saber.
                    log.warning(
                        "Pedido %s: IMPRESSO SEM conferência na fila %s (job %s)",
                        pedido_id,
                        fila,
                        job_id,
                    )
                    avisar_sem_conferencia(cfg, pedido, fila, job_id)
            else:
                log.error(
                    "Pedido %s: timeout após aceitação na fila %s (job %s) -> ERRO "
                    "(failover deliberadamente evitado para não duplicar)",
                    pedido_id,
                    fila,
                    job_id,
                )
                cancelar_job(job_id)
                # Sem número de folhas aqui de propósito: o job pode ainda estar
                # em voo, e a regra do df1b9f8 proíbe consultar o equipamento
                # nessa janela. O aviso diz "não confirmado" em vez de mentir.
                falhar_pedido(
                    sb,
                    cfg,
                    pedido,
                    f"o job não concluiu em {cfg.print_timeout}s e foi cancelado",
                    fila=fila,
                    job_id=job_id,
                )
            return

        # Esgotou todas as filas só com falhas de pré-submissão: nada impresso.
        log.error(
            "Pedido %s: nenhuma fila aceitou o job (%s) -> ERRO (nada impresso)",
            pedido_id,
            ", ".join(filas),
        )
        falhar_pedido(
            sb,
            cfg,
            pedido,
            f"nenhuma fila aceitou o job ({', '.join(filas)}) — nada foi impresso",
            folhas_impressas=0,
        )
    finally:
        try:
            os.unlink(caminho)
        except OSError:
            pass


def main() -> None:
    cfg = Config()
    sb = create_client(cfg.supabase_url, cfg.service_role_key)
    # Jobs órfãos de antes do reboot seriam retransmitidos pelo CUPS assim que a
    # impressora respondesse — purgar antes de qualquer ciclo.
    purgar_spool(filas_candidatas(cfg), "boot do worker")
    heartbeat = Heartbeat(cfg)
    heartbeat.start()
    log.info(
        "Print worker iniciado (impressora=%s, fallback=%s, poll=%ss, print_timeout=%ss, "
        "paper_wait=%ss, stuck_timeout=%ss)",
        cfg.printer_name,
        cfg.printer_name_fallback or "(nenhuma)",
        cfg.poll_interval,
        cfg.print_timeout,
        cfg.paper_wait_timeout,
        cfg.stuck_timeout,
    )

    segurando = False  # evita logar a retenção a cada ciclo de 10s
    while True:
        try:
            recuperar_travados(sb, cfg)

            # Retenção: com falha física/destino fora, NÃO reivindica — o
            # pedido PAGO espera intacto (nada de ERRO) e a impressão retoma
            # sozinha no ciclo seguinte à reposição (ver deve_segurar_pedidos).
            if deve_segurar_pedidos(cfg, heartbeat.estado_saude):
                if not segurando:
                    log.warning(
                        "Impressora em %s — segurando pedidos PAGO até normalizar",
                        heartbeat.estado_saude or "(aguardando 1ª leitura de saúde)",
                    )
                    segurando = True
                time.sleep(cfg.poll_interval)
                continue
            if segurando:
                log.info("Impressora normalizada (%s) — retomando a fila", heartbeat.estado_saude)
                segurando = False

            pedido = proximo_pago(sb)
            if pedido and reivindicar(sb, pedido["id"]):
                heartbeat.marcar_imprimindo(True)
                try:
                    processar(sb, cfg, pedido, heartbeat)
                finally:
                    heartbeat.marcar_imprimindo(False)
                continue  # busca o próximo imediatamente, sem dormir
        except Exception as err:  # noqa: BLE001 - ciclo nunca encerra por erro transitório
            log.exception("Erro no ciclo: %s", err)
        time.sleep(cfg.poll_interval)


if __name__ == "__main__":
    main()
