import type { ModoCor, StatusPedido } from "@/lib/types";

// Lógica de estado da impressora compartilhada com /impressao vive em
// @/lib/impressora; reexportada aqui para manter os imports do kiosk estáveis.
export { faixaImpressora, type FaixaImpressora } from "@/lib/impressora";

export function rotuloModoCor(modo: ModoCor): string {
  return modo === "PB" ? "P&B" : "Colorido";
}

// Formata um timestamp ISO como "HH:MM" (pt-BR). Retorna "" para null/inválido,
// deixando o chamador decidir se omite o trecho.
export function formatarHorario(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Horário exibido na fila: pedido impresso mostra quando saiu (printed_at);
// os demais mostram quando o pagamento foi confirmado (paid_at). Retorna ""
// quando não há timestamp, para que o chamador omita o trecho.
export function rotuloHorarioFila(status: StatusPedido, paidAt: string | null, printedAt: string | null): string {
  if (status === "IMPRESSO") {
    const horario = formatarHorario(printedAt);
    return horario ? `impresso às ${horario}` : "";
  }
  const horario = formatarHorario(paidAt);
  return horario ? `pago às ${horario}` : "";
}

export type StatusVisual = {
  rotulo: string;
  // Classes do "chip" de status (fundo, texto, borda) com cor semântica.
  classe: string;
};

// Cor semântica do status na fila: PAGO neutro, IMPRIMINDO em destaque,
// IMPRESSO verde, ERRO vermelho.
export function statusVisualFila(status: StatusPedido): StatusVisual {
  switch (status) {
    case "IMPRIMINDO":
      return {
        rotulo: "Imprimindo",
        classe: "bg-titans-orange/20 text-titans-orange border-titans-orange/40",
      };
    case "IMPRESSO":
      return {
        rotulo: "Pronto",
        classe: "bg-green-500/15 text-green-400 border-green-500/30",
      };
    case "ERRO":
      return {
        rotulo: "Erro",
        classe: "bg-red-500/15 text-red-400 border-red-500/30",
      };
    case "PAGO":
    default:
      return {
        rotulo: "Na fila",
        classe: "bg-white/10 text-zinc-300 border-white/15",
      };
  }
}

