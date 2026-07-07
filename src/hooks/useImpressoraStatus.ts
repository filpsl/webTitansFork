"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type EstadoImpressora =
  | "OK"
  | "IMPRIMINDO"
  | "PAUSADA"
  | "INALCANCAVEL"
  | "SEM_PAPEL"
  | "SEM_TONER"
  | "MANUTENCAO";

// Diagnóstico publicado pelo worker junto ao estado. Todos os campos são
// opcionais: o worker antigo não grava `detalhes` e firmwares variam no que
// reportam. `state_reasons` é só diagnóstico — não é exibido na UI.
export type DetalhesImpressora = {
  toner_pct?: number | null;
  state_reasons?: string[];
  toner_baixo?: boolean;
};

type ImpressoraStatusRow = {
  estado: EstadoImpressora;
  atualizado_em: string;
  detalhes: DetalhesImpressora | null;
};

// 3× o poll de 10 s do worker: heartbeat mais velho que isso => worker/Pi caiu.
export const HEARTBEAT_TIMEOUT_MS = 30_000;
const POLL_MS = 15_000;
// Tick local para reavaliar o "offline" mesmo sem novo fetch/evento.
const TICK_MS = 5_000;

export type ResultadoImpressora = {
  estado: EstadoImpressora | null;
  detalhes: DetalhesImpressora | null;
  offline: boolean;
  isLoading: boolean;
};

// Estado da impressora para o kiosk: lê a linha única de `impressora_status`,
// assina o Realtime da própria tabela e deriva `offline` quando o heartbeat
// envelhece — recalculado a cada tick local, não só no fetch.
export function useImpressoraStatus(): ResultadoImpressora {
  const query = useQuery({
    queryKey: ["kiosk", "impressora-status"],
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("impressora_status")
        .select("estado, atualizado_em, detalhes")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ImpressoraStatusRow | null;
    },
  });

  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  useEffect(() => {
    const channel = supabase
      .channel("kiosk-impressora-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "impressora_status" },
        () => {
          void refetchRef.current();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // Tick local: força reavaliação do "offline" sem depender de fetch/evento.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const row = query.data ?? null;
  const offline =
    !row || agora - new Date(row.atualizado_em).getTime() > HEARTBEAT_TIMEOUT_MS;

  return {
    estado: row?.estado ?? null,
    detalhes: row?.detalhes ?? null,
    offline,
    isLoading: query.isLoading,
  };
}
