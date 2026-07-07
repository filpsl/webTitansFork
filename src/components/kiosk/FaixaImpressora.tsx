"use client";

import { Printer } from "lucide-react";
import { faixaImpressora } from "./status";
import type {
  DetalhesImpressora,
  EstadoImpressora,
} from "@/hooks/useImpressoraStatus";

type Props = {
  estado: EstadoImpressora | null;
  detalhes: DetalhesImpressora | null;
  offline: boolean;
};

// Rótulo do aviso de toner acabando. Só inclui o percentual quando há um valor
// numérico válido — nunca mostra "%" sozinho.
function rotuloTonerAcabando(detalhes: DetalhesImpressora | null): string {
  const pct = detalhes?.toner_pct;
  if (typeof pct === "number" && Number.isFinite(pct)) {
    return `Toner acabando · ${Math.round(pct)}%`;
  }
  return "Toner acabando";
}

// Faixa sempre visível com o estado da impressora, em texto amigável ao cliente.
// O aviso de toner baixo é ortogonal ao estado: aparece mesmo com a impressora
// pronta/imprimindo e some quando `toner_baixo` volta a false.
export function FaixaImpressora({ estado, detalhes, offline }: Props) {
  const faixa = faixaImpressora(estado, offline);
  const tonerBaixo = detalhes?.toner_baixo === true;
  return (
    <div
      className={`flex items-center justify-center gap-3 rounded-2xl border px-5 py-3 text-xl font-semibold ${faixa.classe}`}
    >
      <Printer className={`h-6 w-6 ${faixa.ativa ? "animate-pulse" : ""}`} />
      {faixa.texto}
      {tonerBaixo && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-sm font-medium text-amber-300">
          {rotuloTonerAcabando(detalhes)}
        </span>
      )}
    </div>
  );
}
