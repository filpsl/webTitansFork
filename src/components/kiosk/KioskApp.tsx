"use client";

import { useEffect, useState } from "react";
import { useFilaPublica } from "@/hooks/useFilaPublica";
import { useImpressoraStatus } from "@/hooks/useImpressoraStatus";
import { ImprimindoAgora } from "./ImprimindoAgora";
import { FilaLista } from "./FilaLista";
import { FaixaImpressora } from "./FaixaImpressora";
import { BarraInferior } from "./BarraInferior";
import { IdleScreen } from "./IdleScreen";
import { OverlayPrecos } from "./OverlayPrecos";
import { OverlayImprimir } from "./OverlayImprimir";
import { OverlayAjuda } from "./OverlayAjuda";

export type OverlayId = "ajuda" | "precos" | "imprimir";

// Volta sozinho para a tela idle após esse tempo sem interação com a fila vazia.
const REIDLE_MS = 60_000;

export default function KioskApp() {
  const { itens } = useFilaPublica();
  const { estado, detalhes, offline } = useImpressoraStatus();

  // Só um overlay aberto por vez.
  const [overlay, setOverlay] = useState<OverlayId | null>(null);

  // Tela idle: aparece quando a fila está vazia e o cliente não interagiu.
  const filaVazia = itens.length === 0;
  const [interagiu, setInteragiu] = useState(false);

  // Fila deixou de estar vazia => sai da idle automaticamente (novo pedido chegou).
  useEffect(() => {
    if (!filaVazia) setInteragiu(false);
  }, [filaVazia]);

  // Fila vazia e sem overlay: volta para a idle após inatividade.
  useEffect(() => {
    if (!filaVazia || !interagiu || overlay) return;
    const t = setTimeout(() => setInteragiu(false), REIDLE_MS);
    return () => clearTimeout(t);
  }, [filaVazia, interagiu, overlay]);

  const mostrarIdle = filaVazia && !interagiu && !overlay;

  if (mostrarIdle) {
    return <IdleScreen onInteract={() => setInteragiu(true)} />;
  }

  const imprimindo = itens.find((i) => i.status === "IMPRIMINDO");
  const resto = itens.filter((i) => i !== imprimindo);

  return (
    <div className="flex h-full w-full flex-col gap-4 p-5">
      <FaixaImpressora estado={estado} detalhes={detalhes} offline={offline} />

      <main className="flex min-h-0 flex-1 flex-col gap-4">
        {imprimindo && <ImprimindoAgora item={imprimindo} />}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {resto.length > 0 ? (
            <FilaLista itens={resto} />
          ) : (
            !imprimindo && (
              <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500">
                <p className="text-2xl font-semibold">Nenhum pedido na fila</p>
                <p className="mt-1 text-lg">
                  Toque em &quot;Imprimir&quot; para enviar o seu.
                </p>
              </div>
            )
          )}
        </div>
      </main>

      <BarraInferior onAbrir={setOverlay} />

      {overlay === "precos" && (
        <OverlayPrecos onClose={() => setOverlay(null)} />
      )}
      {overlay === "imprimir" && (
        <OverlayImprimir onClose={() => setOverlay(null)} />
      )}
      {overlay === "ajuda" && <OverlayAjuda onClose={() => setOverlay(null)} />}
    </div>
  );
}
