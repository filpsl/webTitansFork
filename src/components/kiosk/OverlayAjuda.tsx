"use client";

import { useEffect, useRef, useState } from "react";
import { Delete, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { StatusPedido } from "@/lib/types";
import { KioskOverlay } from "./KioskOverlay";
import { formatarHorario } from "./status";

type Props = {
  onClose: () => void;
};

type ConsultaResposta = {
  status: StatusPedido;
  paid_at: string | null;
  printed_at: string | null;
  posicao_na_fila: number | null;
};

type EstadoConsulta =
  | { fase: "digitando" }
  | { fase: "consultando" }
  | { fase: "encontrado"; dados: ConsultaResposta }
  | { fase: "nao_encontrado" }
  | { fase: "erro" };

type CategoriaChamado = "NAO_SAIU" | "SAIU_COM_DEFEITO" | "OUTRO";

const CATEGORIAS: { id: CategoriaChamado; rotulo: string }[] = [
  { id: "NAO_SAIU", rotulo: "Minha impressão não saiu" },
  { id: "SAIU_COM_DEFEITO", rotulo: "Saiu com defeito" },
  { id: "OUTRO", rotulo: "Outro problema" },
];

const TECLAS_HEX = [
  "1", "2", "3", "A",
  "4", "5", "6", "B",
  "7", "8", "9", "C",
  "D", "E", "F", "0",
];

// Orientação amigável por status do pedido (spec kiosk-help-requests).
function orientacao(dados: ConsultaResposta): {
  titulo: string;
  detalhe: string;
  chamarEmDestaque: boolean;
} {
  switch (dados.status) {
    case "AGUARDANDO_PAGAMENTO":
      return {
        titulo: "Pagamento ainda não confirmado",
        detalhe: "Assim que o PIX for confirmado, seu pedido entra na fila.",
        chamarEmDestaque: false,
      };
    case "PAGO":
      return {
        titulo:
          dados.posicao_na_fila != null
            ? `Você é o ${dados.posicao_na_fila}º da fila`
            : "Na fila de impressão",
        detalhe: "É só aguardar — seu pedido será impresso em breve.",
        chamarEmDestaque: false,
      };
    case "IMPRIMINDO":
      return {
        titulo: "Está saindo agora",
        detalhe: "Seu pedido está sendo impresso neste momento.",
        chamarEmDestaque: false,
      };
    case "IMPRESSO":
      return {
        titulo: "Pronto para retirada",
        detalhe: `Impresso às ${formatarHorario(dados.printed_at)}. Pode retirar na sede.`,
        chamarEmDestaque: false,
      };
    case "ERRO":
    case "CANCELADO":
    default:
      return {
        titulo: "Houve um problema com este pedido",
        detalhe: "Chame a equipe pelo botão abaixo para resolver.",
        chamarEmDestaque: true,
      };
  }
}

// Overlay de ajuda: consulta por protocolo (teclado hex próprio) + chamado à equipe.
export function OverlayAjuda({ onClose }: Props) {
  const [codigo, setCodigo] = useState("");
  const [consulta, setConsulta] = useState<EstadoConsulta>({ fase: "digitando" });
  const [chamado, setChamado] = useState<"idle" | "enviando" | "ok" | "erro">(
    "idle"
  );

  const completo = codigo.length === 8;

  function adicionar(char: string) {
    if (codigo.length >= 8) return;
    setCodigo((c) => c + char);
    setConsulta({ fase: "digitando" });
    setChamado("idle");
  }
  function apagar() {
    setCodigo((c) => c.slice(0, -1));
    setConsulta({ fase: "digitando" });
  }
  function limpar() {
    setCodigo("");
    setConsulta({ fase: "digitando" });
    setChamado("idle");
  }

  async function consultar() {
    if (!completo) return;
    setConsulta({ fase: "consultando" });
    try {
      const res = await fetch(`/api/kiosk/pedido?protocolo=${codigo}`);
      if (res.status === 404) {
        setConsulta({ fase: "nao_encontrado" });
        return;
      }
      if (!res.ok) {
        setConsulta({ fase: "erro" });
        return;
      }
      const dados = (await res.json()) as ConsultaResposta;
      setConsulta({ fase: "encontrado", dados });
    } catch {
      setConsulta({ fase: "erro" });
    }
  }

  async function chamarEquipe(categoria: CategoriaChamado) {
    setChamado("enviando");
    try {
      const res = await fetch("/api/kiosk/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolo: completo ? codigo : undefined,
          categoria,
        }),
      });
      // 201 = criado; 429 = já avisado há pouco (tratamos como sucesso amigável).
      if (res.ok || res.status === 429) setChamado("ok");
      else setChamado("erro");
    } catch {
      setChamado("erro");
    }
  }

  const dadosEncontrado =
    consulta.fase === "encontrado" ? orientacao(consulta.dados) : null;

  // Em telas baixas (ex.: touch 1024×600) o overlay rola; o resultado da
  // consulta nasce abaixo da dobra e o cliente não perceberia — rola até ele.
  const resultadoRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (consulta.fase === "digitando" || consulta.fase === "consultando") return;
    resultadoRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [consulta.fase]);

  // Visor fixo fora da área rolável: continua visível enquanto o cliente
  // digita mesmo quando o teclado força rolagem em telas baixas (1024×600).
  const visor = (
    <>
      <p className="mb-3 text-xl text-zinc-300">
        Digite o protocolo de 8 dígitos do seu pedido.
      </p>
      <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/40 py-3">
        <span className="font-mono text-4xl font-bold tracking-[0.4em] text-white">
          {codigo.padEnd(8, "•")}
        </span>
      </div>
    </>
  );

  return (
    <KioskOverlay titulo="Ajuda" cabecalho={visor} fundoVisivel onClose={onClose}>
      {/* Teclado hexadecimal próprio (sem teclado do SO) */}
      <div className="grid grid-cols-4 gap-3">
        {TECLAS_HEX.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => adicionar(t)}
            className="min-h-[56px] rounded-xl border border-white/10 bg-white/5 font-mono text-3xl font-bold text-white transition active:scale-95"
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={apagar}
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-2xl font-semibold text-white transition active:scale-95"
        >
          <Delete className="h-7 w-7" /> Apagar
        </button>
        <button
          type="button"
          onClick={limpar}
          className="min-h-[56px] rounded-xl border border-white/10 bg-white/5 text-2xl font-semibold text-white transition active:scale-95"
        >
          Limpar
        </button>
      </div>

      <button
        type="button"
        onClick={consultar}
        disabled={!completo || consulta.fase === "consultando"}
        className="mt-3 min-h-[64px] w-full rounded-2xl bg-gradient-to-r from-titans-red to-titans-orange text-2xl font-bold text-white shadow-lg shadow-titans-red/25 transition active:scale-95 disabled:opacity-40"
      >
        {consulta.fase === "consultando" ? "Consultando…" : "Consultar"}
      </button>

      {/* Resultado da consulta — o ref embrulha as mensagens para o
          scrollIntoView trazer a caixa inteira à vista, não só um marcador. */}
      <div ref={resultadoRef}>
        {consulta.fase === "nao_encontrado" && (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-xl text-amber-200">
            Pedido não encontrado. Confira o código e tente de novo.
          </div>
        )}
        {consulta.fase === "erro" && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center text-xl text-red-200">
            Não foi possível consultar agora. Tente novamente em instantes.
          </div>
        )}
        {dadosEncontrado && (
          <div
            className={`mt-6 rounded-2xl border p-6 ${
              dadosEncontrado.chamarEmDestaque
                ? "border-red-500/40 bg-red-500/10"
                : "border-white/10 bg-white/5"
            }`}
          >
            <p className="text-2xl font-bold text-white">
              {dadosEncontrado.titulo}
            </p>
            <p className="mt-1 text-lg text-zinc-300">
              {dadosEncontrado.detalhe}
            </p>
          </div>
        )}
      </div>

      {/* Chamar a equipe */}
      <div className="mt-8 border-t border-white/10 pt-6">
        {chamado === "ok" ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 p-5 text-xl font-semibold text-green-200">
            <CheckCircle2 className="h-7 w-7" /> Equipe avisada! Aguarde um momento.
          </div>
        ) : (
          <>
            <p
              className={`mb-3 flex items-center gap-2 text-xl font-semibold ${
                dadosEncontrado?.chamarEmDestaque
                  ? "text-red-300"
                  : "text-zinc-200"
              }`}
            >
              <AlertTriangle className="h-6 w-6" /> Precisa de ajuda? Chame a
              equipe:
            </p>
            <div className="grid grid-cols-1 gap-3">
              {CATEGORIAS.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  disabled={chamado === "enviando"}
                  onClick={() => chamarEquipe(cat.id)}
                  className="min-h-[56px] rounded-xl border border-white/15 bg-white/5 px-5 text-xl font-semibold text-white transition active:scale-95 disabled:opacity-40"
                >
                  {cat.rotulo}
                </button>
              ))}
            </div>
            {chamado === "erro" && (
              <p className="mt-3 text-center text-lg text-red-300">
                Não foi possível avisar a equipe. Tente novamente.
              </p>
            )}
          </>
        )}
      </div>
    </KioskOverlay>
  );
}
