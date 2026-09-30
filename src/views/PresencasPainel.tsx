"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus, Loader2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useVisao } from "@/components/equipe/VisaoContext";
import { GERENTE_OU_SUPERIOR } from "@/lib/roles";
import { PROJETOS_COMPETICAO } from "@/lib/projetos";
import {
  PRESENCA_STATUS_VALUES,
  PRESENCA_STATUS_LABELS,
  PRESENCA_STATUS_BADGE_CLASS,
  type PresencaCelula,
  type PresencaStatus,
  type PresencasProjeto,
} from "@/lib/presencas/types";

interface Projeto {
  id: string;
  nome: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Erro na requisição");
  }
  return data as T;
}

function CelulaPresenca({
  status,
  observacao,
  podeEditar,
  onChange,
}: {
  status: PresencaStatus | null;
  observacao: string | null;
  podeEditar: boolean;
  onChange: (status: PresencaStatus | null, observacao: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [obs, setObs] = useState(observacao ?? "");

  useEffect(() => {
    setObs(observacao ?? "");
  }, [observacao, open]);

  const badge = status ? (
    <span
      className={`inline-flex h-7 min-w-16 items-center justify-center rounded px-2 text-xs font-medium ${PRESENCA_STATUS_BADGE_CLASS[status]}`}
    >
      {status === "FALTA_JUSTIFICADA" ? "Falta just." : PRESENCA_STATUS_LABELS[status]}
    </span>
  ) : (
    <span className="inline-flex h-7 min-w-16 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground/50">
      —
    </span>
  );

  if (!podeEditar) {
    return (
      <div title={observacao ?? undefined} className="flex justify-center">
        {badge}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="transition-opacity hover:opacity-80">
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2">
        <div className="flex flex-col gap-1">
          {PRESENCA_STATUS_VALUES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              className="justify-start"
              onClick={() => {
                onChange(s, obs || null);
                setOpen(false);
              }}
            >
              {PRESENCA_STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
        <Textarea
          placeholder="Observação (opcional)"
          rows={2}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => {
            if (status) onChange(status, obs || null);
          }}
          className="text-xs"
        />
        {status && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => {
              onChange(null, null);
              setOpen(false);
            }}
          >
            <X className="mr-1 h-3 w-3" />
            Limpar
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const PresencasPainel = () => {
  const { role } = useVisao();
  const podeEditar = !!role && GERENTE_OU_SUPERIOR.includes(role);

  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [dados, setDados] = useState<PresencasProjeto | null>(null);
  const [loading, setLoading] = useState(true);
  const [novaData, setNovaData] = useState(format(new Date(), "yyyy-MM-dd"));
  const [criandoSessao, setCriandoSessao] = useState(false);

  useEffect(() => {
    api<{ projetos: Projeto[] }>("/api/projetos")
      .then(({ projetos: p }) => {
        const competicao = p.filter((x) =>
          (PROJETOS_COMPETICAO as readonly string[]).includes(x.nome)
        );
        setProjetos(competicao);
        setProjetoId((prev) => prev ?? competicao[0]?.id ?? null);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Erro ao carregar projetos"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!projetoId) return;
    api<PresencasProjeto>(`/api/presencas?projetoId=${projetoId}`)
      .then(setDados)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Erro ao carregar presenças"));
  }, [projetoId]);

  const presencaPorCelula = useMemo(() => {
    const mapa = new Map<string, PresencaCelula>();
    for (const p of dados?.presencas ?? []) mapa.set(`${p.sessaoId}:${p.membroId}`, p);
    return mapa;
  }, [dados]);

  async function handleAdicionarSessao() {
    if (!projetoId || !novaData) return;
    setCriandoSessao(true);
    try {
      const { sessao } = await api<{ sessao: { id: string; data: string } }>(
        "/api/presencas/sessoes",
        { method: "POST", body: JSON.stringify({ projetoId, data: novaData }) }
      );
      setDados((prev) =>
        prev
          ? {
              ...prev,
              sessoes: prev.sessoes.some((s) => s.id === sessao.id)
                ? prev.sessoes
                : [...prev.sessoes, sessao].sort((a, b) => a.data.localeCompare(b.data)),
            }
          : prev
      );
      toast.success("Data adicionada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar data");
    } finally {
      setCriandoSessao(false);
    }
  }

  async function handleRemoverSessao(sessaoId: string) {
    try {
      await api(`/api/presencas/sessoes/${sessaoId}`, { method: "DELETE" });
      setDados((prev) =>
        prev
          ? {
              ...prev,
              sessoes: prev.sessoes.filter((s) => s.id !== sessaoId),
              presencas: prev.presencas.filter((p) => p.sessaoId !== sessaoId),
            }
          : prev
      );
      toast.success("Data removida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover data");
    }
  }

  async function handleMarcar(
    sessaoId: string,
    membroId: string,
    status: PresencaStatus | null,
    observacao: string | null
  ) {
    // Atualização otimista — se a API falhar, recarrega pra desfazer.
    setDados((prev) => {
      if (!prev) return prev;
      const semCelula = prev.presencas.filter(
        (p) => !(p.sessaoId === sessaoId && p.membroId === membroId)
      );
      return {
        ...prev,
        presencas: status ? [...semCelula, { sessaoId, membroId, status, observacao }] : semCelula,
      };
    });
    try {
      await api(`/api/presencas/sessoes/${sessaoId}/marcar`, {
        method: "POST",
        body: JSON.stringify({ membroId, status, observacao }),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar presença");
      if (projetoId) {
        api<PresencasProjeto>(`/api/presencas?projetoId=${projetoId}`)
          .then(setDados)
          .catch(() => {});
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando painel de presenças...
      </div>
    );
  }

  if (!projetos || projetos.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhum projeto de competição cadastrado ainda.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2">
        {projetos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProjetoId(p.id)}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              projetoId === p.id
                ? "bg-gradient-to-r from-titans-red to-titans-orange text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {p.nome}
          </button>
        ))}
      </div>

      {!dados ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando...
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {podeEditar && (
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Nova data de treino</label>
                  <Input
                    type="date"
                    value={novaData}
                    onChange={(e) => setNovaData(e.target.value)}
                    className="h-9 w-40"
                  />
                </div>
                <Button size="sm" onClick={handleAdicionarSessao} disabled={criandoSessao}>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  {criandoSessao ? "Adicionando..." : "Adicionar data"}
                </Button>
              </div>
            )}

            {dados.membros.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum membro cadastrado nesse projeto ainda — adicione em Gerenciar Membros.
              </p>
            ) : dados.sessoes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma data registrada ainda
                {podeEditar ? "" : " — peça pra liderança do projeto adicionar uma"}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-medium">
                        Membro
                      </th>
                      {dados.sessoes.map((s) => (
                        <th key={s.id} className="min-w-24 px-2 py-2 text-center font-medium">
                          <div className="flex items-center justify-center gap-1">
                            {format(parseISO(s.data), "dd/MM", { locale: ptBR })}
                            {podeEditar && (
                              <button
                                type="button"
                                onClick={() => handleRemoverSessao(s.id)}
                                className="text-muted-foreground/50 hover:text-destructive"
                                title="Remover essa data"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dados.membros.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="sticky left-0 z-10 bg-card px-2 py-2">
                          {m.nome ?? m.email}
                        </td>
                        {dados.sessoes.map((s) => {
                          const celula = presencaPorCelula.get(`${s.id}:${m.id}`);
                          return (
                            <td key={s.id} className="px-2 py-1.5 text-center">
                              <CelulaPresenca
                                status={celula?.status ?? null}
                                observacao={celula?.observacao ?? null}
                                podeEditar={podeEditar}
                                onChange={(status, observacao) =>
                                  handleMarcar(s.id, m.id, status, observacao)
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PresencasPainel;
