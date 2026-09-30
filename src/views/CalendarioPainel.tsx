"use client";

import { useEffect, useMemo, useState } from "react";
import { useVisao } from "@/components/equipe/VisaoContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Trash2,
  Ban,
  CalendarDays,
  Users,
  UsersRound,
  Clock3,
  Trophy,
  CalendarPlus,
  UserPlus,
  HandCoins,
  Flag,
  ListFilter,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/components/ui/sonner";
import {
  eventoSchema,
  semestreSchema,
  type EventoFormValues,
  type SemestreFormValues,
} from "@/lib/calendario-schema";
import { corClasses } from "@/lib/calendario/cores";
import type { Evento, Semestre, TipoEvento } from "@/lib/calendario/types";

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

const STATUS_LABELS: Record<string, string> = {
  CONFIRMADO: "Confirmado",
  PENDENTE: "Pendente",
  ALTERADO: "Alterado",
  CANCELADO: "Cancelado",
  CONCLUIDO: "Concluído",
};

const ICONES: Record<string, React.ComponentType<{ className?: string }>> = {
  Users,
  UsersRound,
  Clock3,
  Trophy,
  CalendarPlus,
  UserPlus,
  HandCoins,
  Flag,
};

function dataYMD(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function combinarDataHora(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00`).toISOString();
}

type DialogState =
  | { kind: "none" }
  | { kind: "novo"; data: string }
  | { kind: "editar"; evento: Evento };

function valoresIniciais(state: DialogState): EventoFormValues {
  if (state.kind === "editar") {
    const e = state.evento;
    const inicio = parseISO(e.inicio);
    return {
      titulo: e.titulo,
      tipoSlug: e.tipoSlug,
      status: e.status,
      diaTodo: e.diaTodo,
      dataInicio: format(inicio, "yyyy-MM-dd"),
      horaInicio: e.diaTodo ? "" : format(inicio, "HH:mm"),
      dataFim: e.fim ? format(parseISO(e.fim), "yyyy-MM-dd") : "",
      horaFim: e.fim && !e.diaTodo ? format(parseISO(e.fim), "HH:mm") : "",
      local: e.local ?? "",
      linkReuniao: e.linkReuniao ?? "",
      responsavel: e.responsavel ?? "",
      descricao: e.descricao ?? "",
      importante: e.importante,
      frequencia: "none",
      repetirAte: "",
      projetoIds: e.projetoIds,
    };
  }
  const data = state.kind === "novo" ? state.data : dataYMD(new Date());
  return {
    titulo: "",
    tipoSlug: "",
    status: "CONFIRMADO",
    diaTodo: false,
    dataInicio: data,
    horaInicio: "09:00",
    dataFim: "",
    horaFim: "",
    local: "",
    linkReuniao: "",
    responsavel: "",
    descricao: "",
    importante: false,
    frequencia: "none",
    repetirAte: "",
    projetoIds: [],
  };
}

function EventoDialog({
  state,
  onOpenChange,
  tipos,
  projetos,
  semestreId,
  onCreated,
  onUpdated,
}: {
  state: DialogState;
  onOpenChange: (open: boolean) => void;
  tipos: TipoEvento[];
  projetos: Projeto[];
  semestreId: string | null;
  onCreated: (eventos: Evento[]) => void;
  onUpdated: (evento: Evento) => void;
}) {
  const editando = state.kind === "editar" ? state.evento : null;
  const [saving, setSaving] = useState(false);

  const form = useForm<EventoFormValues>({
    resolver: zodResolver(eventoSchema),
    defaultValues: valoresIniciais(state),
  });

  useEffect(() => {
    form.reset(valoresIniciais(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function onSubmit(data: EventoFormValues) {
    if (!editando && !semestreId) {
      toast.error("Ative um semestre antes de criar eventos");
      return;
    }
    setSaving(true);
    try {
      const inicio = combinarDataHora(data.dataInicio, data.diaTodo ? "00:00" : data.horaInicio || "00:00");
      const fim = data.dataFim
        ? combinarDataHora(data.dataFim, data.diaTodo ? "23:59" : data.horaFim || data.horaInicio || "23:59")
        : null;

      const camposComuns = {
        titulo: data.titulo,
        tipoSlug: data.tipoSlug,
        status: data.status,
        inicio,
        fim,
        diaTodo: data.diaTodo,
        local: data.local || null,
        linkReuniao: data.linkReuniao || null,
        responsavel: data.responsavel || null,
        descricao: data.descricao || null,
        importante: data.importante,
        projetoIds: data.projetoIds,
      };

      if (editando) {
        const { evento } = await api<{ evento: Evento }>(`/api/eventos/${editando.id}`, {
          method: "PATCH",
          body: JSON.stringify(camposComuns),
        });
        onUpdated(evento);
        toast.success("Evento atualizado");
      } else {
        const { eventos } = await api<{ eventos: Evento[] }>("/api/eventos", {
          method: "POST",
          body: JSON.stringify({
            ...camposComuns,
            semestreId,
            frequencia: data.frequencia,
            repetirAte: data.repetirAte || null,
          }),
        });
        onCreated(eventos);
        toast.success(eventos.length > 1 ? `${eventos.length} ocorrências criadas` : "Evento criado");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar evento");
    } finally {
      setSaving(false);
    }
  }

  const diaTodo = form.watch("diaTodo");
  const frequencia = form.watch("frequencia");

  return (
    <Dialog open={state.kind !== "none"} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar evento" : "Novo evento"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "A edição atualiza só esta ocorrência — as demais da série, se houver, continuam como estão."
              : "Eventos recorrentes criam uma ocorrência por semana/quinzena até a data escolhida, limitada ao fim do semestre."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="tipoSlug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {tipos.map((t) => (
                          <SelectItem key={t.slug} value={t.slug}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([valor, label]) => (
                          <SelectItem key={valor} value={valor}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="diaTodo"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal">Dia inteiro</FormLabel>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="dataInicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de início</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!diaTodo && (
                <FormField
                  control={form.control}
                  name="horaInicio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hora de início</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="dataFim"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de fim (opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!diaTodo && (
                <FormField
                  control={form.control}
                  name="horaFim"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hora de fim</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="local"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="responsavel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsável</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="linkReuniao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link da reunião (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {projetos.length > 0 && (
              <FormField
                control={form.control}
                name="projetoIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Projetos relacionados</FormLabel>
                    <div className="grid grid-cols-2 gap-2">
                      {projetos.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={field.value.includes(p.id)}
                            onCheckedChange={(checked) =>
                              field.onChange(
                                checked
                                  ? [...field.value, p.id]
                                  : field.value.filter((id) => id !== p.id)
                              )
                            }
                          />
                          {p.nome}
                        </label>
                      ))}
                    </div>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="importante"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal">Marcar como importante</FormLabel>
                </FormItem>
              )}
            />

            {!editando && (
              <>
                <FormField
                  control={form.control}
                  name="frequencia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repetição</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Não repete</SelectItem>
                          <SelectItem value="semanal">Toda semana</SelectItem>
                          <SelectItem value="quinzenal">A cada duas semanas</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {frequencia !== "none" && (
                  <FormField
                    control={form.control}
                    name="repetirAte"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Repetir até</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : editando ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function SemestreDialog({ onCreated }: { onCreated: (s: Semestre) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const form = useForm<SemestreFormValues>({
    resolver: zodResolver(semestreSchema),
    defaultValues: { nome: "", inicio: "", fim: "" },
  });

  async function onSubmit(data: SemestreFormValues) {
    setSaving(true);
    try {
      const { semestre } = await api<{ semestre: Semestre }>("/api/semestres", {
        method: "POST",
        body: JSON.stringify(data),
      });
      onCreated(semestre);
      toast.success("Semestre criado");
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar semestre");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Novo semestre
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo semestre</DialogTitle>
          <DialogDescription>
            Delimita o período em que os eventos recorrentes podem repetir.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input placeholder="2026.2" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="inicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fim"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const CalendarioPainel = () => {
  const { isLideranca } = useVisao();

  const [semestres, setSemestres] = useState<Semestre[]>([]);
  const [semestreId, setSemestreId] = useState<string | null>(null);
  const [tipos, setTipos] = useState<TipoEvento[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [mesAtual, setMesAtual] = useState(() => startOfMonth(new Date()));
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<DialogState>({ kind: "none" });
  const [tiposAtivos, setTiposAtivos] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function carregarBase() {
      setLoading(true);
      try {
        const [{ semestres: s }, { tipos: t }, { projetos: p }] = await Promise.all([
          api<{ semestres: Semestre[] }>("/api/semestres"),
          api<{ tipos: TipoEvento[] }>("/api/tipos-evento"),
          api<{ projetos: Projeto[] }>("/api/projetos"),
        ]);
        setSemestres(s);
        setTipos(t);
        setTiposAtivos(new Set(t.map((tipo) => tipo.slug)));
        setProjetos(p);
        setSemestreId((prev) => prev ?? s.find((x) => x.ativo)?.id ?? s[0]?.id ?? null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao carregar calendário");
      } finally {
        setLoading(false);
      }
    }
    carregarBase();
  }, []);

  useEffect(() => {
    if (!semestreId) {
      setEventos([]);
      return;
    }
    api<{ eventos: Evento[] }>(`/api/eventos?semestreId=${semestreId}`)
      .then(({ eventos: e }) => setEventos(e))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Erro ao carregar eventos"));
  }, [semestreId]);

  const semestreSelecionado = semestres.find((s) => s.id === semestreId) ?? null;

  const eventosFiltrados = useMemo(
    () => (eventos ?? []).filter((e) => tiposAtivos.has(e.tipoSlug)),
    [eventos, tiposAtivos]
  );

  const eventosPorDia = useMemo(() => {
    const mapa = new Map<string, Evento[]>();
    for (const e of eventosFiltrados) {
      const chave = format(parseISO(e.inicio), "yyyy-MM-dd");
      const lista = mapa.get(chave) ?? [];
      lista.push(e);
      mapa.set(chave, lista);
    }
    return mapa;
  }, [eventosFiltrados]);

  function toggleTipo(slug: string) {
    setTiposAtivos((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const diasGrade = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesAtual), { weekStartsOn: 0 });
    const fim = endOfWeek(endOfMonth(mesAtual), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: inicio, end: fim });
  }, [mesAtual]);

  const eventosDoDia = diaSelecionado ? eventosPorDia.get(diaSelecionado) ?? [] : [];

  function tipoDe(slug: string): TipoEvento | undefined {
    return tipos.find((t) => t.slug === slug);
  }

  async function handleCancelar(evento: Evento) {
    try {
      const { evento: atualizado } = await api<{ evento: Evento }>(
        `/api/eventos/${evento.id}/cancelar`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setEventos((prev) => prev?.map((e) => (e.id === atualizado.id ? atualizado : e)) ?? null);
      toast.success("Evento cancelado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cancelar evento");
    }
  }

  async function handleExcluir(evento: Evento) {
    try {
      await api(`/api/eventos/${evento.id}`, { method: "DELETE" });
      setEventos((prev) => prev?.filter((e) => e.id !== evento.id) ?? null);
      toast.success("Evento excluído");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir evento");
    }
  }

  async function handleAtivarSemestre(id: string) {
    try {
      await api(`/api/semestres/${id}/ativar`, { method: "POST" });
      setSemestres((prev) => prev.map((s) => ({ ...s, ativo: s.id === id })));
      toast.success("Semestre ativado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao ativar semestre");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando calendário...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={semestreId ?? undefined} onValueChange={setSemestreId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Selecione um semestre" />
              </SelectTrigger>
              <SelectContent>
                {semestres.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome} {s.ativo ? "· ativo" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {tipos.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ListFilter className="h-4 w-4" />
                    Filtro
                    {tiposAtivos.size < tipos.length && (
                      <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">
                        {tiposAtivos.size}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium">Filtrar por tipo</span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs"
                        onClick={() => setTiposAtivos(new Set(tipos.map((t) => t.slug)))}
                      >
                        Todos
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs"
                        onClick={() => setTiposAtivos(new Set())}
                      >
                        Nenhum
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {tipos.map((tipo) => {
                      const Icone = ICONES[tipo.iconeKey];
                      return (
                        <label
                          key={tipo.slug}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={tiposAtivos.has(tipo.slug)}
                            onCheckedChange={() => toggleTipo(tipo.slug)}
                          />
                          {Icone && <Icone className="h-3.5 w-3.5 shrink-0" />}
                          {tipo.label}
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {semestreSelecionado && !semestreSelecionado.ativo && isLideranca && (
              <Button size="sm" variant="outline" onClick={() => handleAtivarSemestre(semestreSelecionado.id)}>
                Ativar este semestre
              </Button>
            )}
          </div>
          {isLideranca && <SemestreDialog onCreated={(s) => setSemestres((prev) => [s, ...prev])} />}
        </CardContent>
      </Card>

      {!semestreId ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <CalendarDays className="h-8 w-8" />
            <p>Nenhum semestre cadastrado ainda.</p>
            {isLideranca && <p className="text-sm">Crie um semestre pra começar a cadastrar eventos.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg capitalize">
                {format(mesAtual, "MMMM yyyy", { locale: ptBR })}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => setMesAtual((m) => subMonths(m, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMesAtual(startOfMonth(new Date()))}>
                  Hoje
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setMesAtual((m) => addMonths(m, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border">
                {diasGrade.map((dia) => {
                  const chave = dataYMD(dia);
                  const eventosDia = eventosPorDia.get(chave) ?? [];
                  const foraDoMes = !isSameMonth(dia, mesAtual);
                  const selecionado = diaSelecionado === chave;
                  return (
                    <button
                      key={chave}
                      type="button"
                      onClick={() => setDiaSelecionado(chave)}
                      className={`flex min-h-20 flex-col items-start gap-1 bg-background p-1.5 text-left align-top transition-colors hover:bg-muted/60 ${
                        foraDoMes ? "text-muted-foreground/40" : ""
                      } ${selecionado ? "ring-2 ring-inset ring-titans-orange" : ""}`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                          isToday(dia) ? "bg-titans-red font-semibold text-white" : ""
                        }`}
                      >
                        {format(dia, "d")}
                      </span>
                      <div className="flex w-full flex-col gap-0.5">
                        {eventosDia.slice(0, 3).map((e) => (
                          <span
                            key={e.id}
                            className={`truncate rounded px-1 text-[10px] leading-4 ${corClasses(tipoDe(e.tipoSlug)?.corToken ?? "").badge}`}
                          >
                            {e.titulo}
                          </span>
                        ))}
                        {eventosDia.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{eventosDia.length - 3}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {diaSelecionado
                  ? format(parseISO(diaSelecionado), "dd 'de' MMMM", { locale: ptBR })
                  : "Selecione um dia"}
              </CardTitle>
              {isLideranca && diaSelecionado && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialogState({ kind: "novo", data: diaSelecionado })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {!diaSelecionado && (
                <p className="text-sm text-muted-foreground">
                  Clique num dia da grade pra ver os eventos.
                </p>
              )}
              {diaSelecionado && eventosDoDia.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum evento nesse dia.</p>
              )}
              {eventosDoDia.map((e) => {
                const tipo = tipoDe(e.tipoSlug);
                const Icone = tipo ? ICONES[tipo.iconeKey] : undefined;
                return (
                  <div key={e.id} className={`rounded-md border p-3 ${corClasses(tipo?.corToken ?? "").badge}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-medium">
                        {Icone && <Icone className="h-4 w-4 shrink-0" />}
                        {e.titulo}
                      </div>
                      <Badge variant="outline" className="shrink-0 bg-background text-[10px]">
                        {STATUS_LABELS[e.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs opacity-80">
                      {e.diaTodo ? "Dia inteiro" : format(parseISO(e.inicio), "HH:mm")}
                      {e.local ? ` · ${e.local}` : ""}
                    </p>
                    {e.descricao && <p className="mt-1 text-xs opacity-80">{e.descricao}</p>}
                    {e.linkReuniao && (
                      <a
                        href={e.linkReuniao}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-xs underline"
                      >
                        Link da reunião
                      </a>
                    )}
                    {isLideranca && (
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 bg-background/60 px-2 text-xs"
                          onClick={() => setDialogState({ kind: "editar", evento: e })}
                        >
                          Editar
                        </Button>
                        {e.status !== "CANCELADO" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 bg-background/60 px-2 text-xs"
                            onClick={() => handleCancelar(e)}
                          >
                            <Ban className="mr-1 h-3 w-3" />
                            Cancelar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 bg-background/60 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleExcluir(e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {isLideranca && (
        <EventoDialog
          state={dialogState}
          onOpenChange={(open) => !open && setDialogState({ kind: "none" })}
          tipos={tipos}
          projetos={projetos}
          semestreId={semestreId}
          onCreated={(novos) => setEventos((prev) => [...(prev ?? []), ...novos])}
          onUpdated={(atualizado) =>
            setEventos((prev) => prev?.map((e) => (e.id === atualizado.id ? atualizado : e)) ?? null)
          }
        />
      )}
    </div>
  );
};

export default CalendarioPainel;
