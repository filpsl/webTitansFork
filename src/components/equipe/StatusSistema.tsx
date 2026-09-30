"use client";

import { useEffect, useState } from "react";

interface StatusData {
  dbSizeBytes: number;
  latenciaMs: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/**
 * Rodapé com métricas reais e simples do sistema: tamanho atual do banco
 * (uso de dados) e o tempo de resposta de uma consulta ao banco, usado como
 * indicador de carga/saúde — não é um serviço de monitoramento de verdade,
 * só uma leitura ao vivo pra dar uma noção de que o sistema está saudável.
 */
export default function StatusSistema() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error();
        const data = (await res.json()) as StatusData;
        if (ativo) {
          setStatus(data);
          setErro(false);
        }
      } catch {
        if (ativo) setErro(true);
      }
    }

    carregar();
    const intervalo = setInterval(carregar, 60_000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${erro ? "bg-destructive" : "bg-emerald-500"}`}
        />
        {erro ? "Sistema indisponível no momento" : "Sistema operando normalmente"}
      </span>
      {status && !erro && (
        <>
          <span>Uso de dados: {formatBytes(status.dbSizeBytes)}</span>
          <span>Carga do site: {status.latenciaMs} ms de resposta do banco</span>
        </>
      )}
    </div>
  );
}
