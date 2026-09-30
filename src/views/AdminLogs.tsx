"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import {
  LOG_ACAO_BADGE_CLASS,
  LOG_ACAO_BADGE_CLASS_PADRAO,
  LOG_ACAO_LABELS,
  LOG_CATEGORIA_LABELS,
  LOG_CATEGORIA_ORDER,
} from "@/lib/log";
import type { LogCategoria } from "../../generated/prisma/enums";

/** Sentinela pro <Select> — Radix não aceita value="" pra representar "todas". */
const TODAS_CATEGORIAS = "TODAS";

interface LogEntry {
  id: string;
  criadoEm: string;
  usuarioNome: string | null;
  usuarioEmail: string | null;
  categoria: LogCategoria;
  acao: string;
  descricao: string;
  ip: string | null;
}

interface Resposta {
  logs: LogEntry[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Erro na requisição");
  }
  return data as T;
}

const AdminLogs = () => {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [categoria, setCategoria] = useState<string>(TODAS_CATEGORIAS);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(true);

  async function carregar(paginaAlvo: number) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pagina: String(paginaAlvo) });
      if (categoria !== TODAS_CATEGORIAS) params.set("categoria", categoria);
      if (busca.trim()) params.set("q", busca.trim());

      const resposta = await api<Resposta>(`/api/admin/logs?${params.toString()}`);
      setLogs(resposta.logs);
      setTotal(resposta.total);
      setPagina(resposta.pagina);
      setTotalPaginas(resposta.totalPaginas);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar logs");
    } finally {
      setLoading(false);
    }
  }

  // Filtro/busca sempre volta pra página 1 — resultado antigo não faz sentido na paginação nova.
  useEffect(() => {
    const t = setTimeout(() => carregar(1), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, busca]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Quadro de Logs</CardTitle>
          <CardDescription>
            Tentativas de login, conexões e alterações no quadro de tarefas — só o Mestre vê.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, e-mail ou descrição..."
              className="h-9 w-64 pl-8 text-xs"
            />
          </div>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS_CATEGORIAS}>Todas as categorias</SelectItem>
              {LOG_CATEGORIA_ORDER.map((c) => (
                <SelectItem key={c} value={c}>
                  {LOG_CATEGORIA_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => carregar(pagina)} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !logs ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : !logs || logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum registro encontrado.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Data/Hora</TableHead>
                    <TableHead>Membro</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {format(parseISO(l.criadoEm), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.usuarioNome ?? l.usuarioEmail ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {l.usuarioNome && l.usuarioEmail && (
                          <p className="text-muted-foreground">{l.usuarioEmail}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{LOG_CATEGORIA_LABELS[l.categoria]}</TableCell>
                      <TableCell>
                        <Badge className={LOG_ACAO_BADGE_CLASS[l.acao] ?? LOG_ACAO_BADGE_CLASS_PADRAO}>
                          {LOG_ACAO_LABELS[l.acao] ?? l.acao}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs">{l.descricao}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.ip ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-muted-foreground">
              <span>{total} registro(s) no total</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagina <= 1 || loading}
                  onClick={() => carregar(pagina - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  Página {pagina} de {totalPaginas}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagina >= totalPaginas || loading}
                  onClick={() => carregar(pagina + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminLogs;
