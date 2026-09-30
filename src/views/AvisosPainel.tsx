"use client";

import { useEffect, useState } from "react";
import { useVisao } from "@/components/equipe/VisaoContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import bannerBoasVindas from "@/assets/avisosGerais/boasVindas.png";
import bannerFeedback from "@/assets/avisosGerais/feedback.png";
import ProjectHeroCarousel from "@/components/ProjectHeroCarousel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/components/ui/sonner";
import { avisoSchema, type AvisoFormValues } from "@/lib/calendario-schema";
import { SEVERIDADE_META, type Aviso } from "@/lib/calendario/types";

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

function AvisoDialog({ onCreated }: { onCreated: (a: Aviso) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const form = useForm<AvisoFormValues>({
    resolver: zodResolver(avisoSchema),
    defaultValues: {
      titulo: "",
      corpo: "",
      severidade: "INFO",
      dataInicio: format(new Date(), "yyyy-MM-dd"),
      dataFim: "",
      publicado: true,
    },
  });

  async function onSubmit(data: AvisoFormValues) {
    setSaving(true);
    try {
      const { aviso } = await api<{ aviso: Aviso }>("/api/avisos", {
        method: "POST",
        body: JSON.stringify({
          titulo: data.titulo,
          corpo: data.corpo,
          severidade: data.severidade,
          inicio: `${data.dataInicio}T00:00:00`,
          fim: data.dataFim ? `${data.dataFim}T23:59:00` : null,
          publicado: data.publicado,
        }),
      });
      onCreated(aviso);
      toast.success("Aviso publicado");
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar aviso");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Novo aviso
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo aviso</DialogTitle>
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
            <FormField
              control={form.control}
              name="corpo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mensagem</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="severidade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Severidade</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(SEVERIDADE_META).map(([valor, meta]) => (
                          <SelectItem key={valor} value={valor}>
                            {meta.label}
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
                name="dataInicio"
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
                name="dataFim"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim (opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="publicado"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-normal">
                    Publicar imediatamente (senão fica como rascunho)
                  </FormLabel>
                </FormItem>
              )}
            />
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

const AvisosPainel = () => {
  const { isLideranca } = useVisao();

  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [loading, setLoading] = useState(true);

  async function carregar() {
    setLoading(true);
    try {
      const { avisos: a } = await api<{ avisos: Aviso[] }>("/api/avisos");
      setAvisos(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar avisos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function handleExcluir(id: string) {
    try {
      await api(`/api/avisos/${id}`, { method: "DELETE" });
      setAvisos((prev) => prev?.filter((a) => a.id !== id) ?? null);
      toast.success("Aviso removido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover aviso");
    }
  }

  async function handleTogglePublicado(a: Aviso) {
    try {
      const { aviso } = await api<{ aviso: Aviso }>(`/api/avisos/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ publicado: !a.publicado }),
      });
      setAvisos((prev) => prev?.map((x) => (x.id === aviso.id ? aviso : x)) ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar aviso");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Avisos Gerais</CardTitle>
        {isLideranca && <AvisoDialog onCreated={(a) => setAvisos((prev) => [a, ...(prev ?? [])])} />}
      </CardHeader>
      <CardContent>
        <ProjectHeroCarousel
          className="mb-4 max-w-none"
          itemClassName="bg-background"
          ariaLabel="Avisos da equipe"
          images={[
            {
              src: bannerBoasVindas.src,
              alt: "Bem-vindo ao novo sistema da TITANS",
            },
            {
              src: bannerFeedback.src,
              alt: "Dê seu feedback para a equipe ou para o sistema web — sua ajuda é valiosa",
            },
          ]}
        />

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (avisos ?? []).length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum aviso no momento. Os comunicados da equipe vão aparecer aqui.
          </p>
        ) : (
          <div className="space-y-3">
            {(avisos ?? []).map((a) => (
              <div key={a.id} className={`rounded-md p-3 ${SEVERIDADE_META[a.severidade].className}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Megaphone className="h-4 w-4 shrink-0" />
                    {a.titulo}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!a.publicado && <Badge variant="outline">Rascunho</Badge>}
                    <Badge variant="outline" className="bg-background">
                      {SEVERIDADE_META[a.severidade].label}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-sm opacity-90">{a.corpo}</p>
                <p className="mt-1 text-xs opacity-70">
                  {format(parseISO(a.inicio), "dd 'de' MMMM", { locale: ptBR })}
                  {a.fim ? ` até ${format(parseISO(a.fim), "dd 'de' MMMM", { locale: ptBR })}` : ""}
                </p>
                {isLideranca && (
                  <div className="mt-2 flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 bg-background/60 px-2 text-xs"
                      onClick={() => handleTogglePublicado(a)}
                    >
                      {a.publicado ? "Despublicar" : "Publicar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 bg-background/60 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleExcluir(a.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AvisosPainel;
