"use client";

import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { useVisao } from "@/components/equipe/VisaoContext";
import {
  Download,
  KeyRound,
  Loader2,
  Mail,
  MailOpen,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ROLE_LABELS, ROLE_ORDER } from "@/lib/roles";
import {
  STATUS_MEMBRO_BADGE_CLASS,
  STATUS_MEMBRO_LABELS,
  STATUS_MEMBRO_ORDER,
} from "@/lib/statusMembro";
import { NIVEL_CARTA_LABELS, NIVEL_CARTA_ORDER } from "@/lib/nivelCarta";
import type { Role, StatusMembro, NivelCarta } from "../../generated/prisma/enums";

/** Sentinela pro <Select> — Radix não aceita value="" pra representar "nenhum". */
const SEM_NIVEL = "SEM_NIVEL";

interface Projeto {
  id: string;
  nome: string;
}

interface Membro {
  id: string;
  nome: string | null;
  email: string;
  role: Role;
  status: StatusMembro;
  nivelCarta: NivelCarta | null;
  curso: string | null;
  semestre: number | null;
  /** Quando o membro abriu o link de definir senha do convite vigente (null = ainda não). */
  conviteAbertoEm: string | null;
  /** Se há um convite de senha pendente (token ainda válido) pra esse e-mail. */
  convitePendente: boolean;
  projetos: Projeto[];
}

interface LinhaResultado {
  linha: number;
  email: string | null;
  status: "criado" | "atualizado" | "erro";
  mensagem?: string;
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

function FormularioMembro({
  projetos,
  onCreated,
}: {
  projetos: Projeto[];
  onCreated: (membro: Membro) => void;
}) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBRO_PROJETO");
  const [status, setStatus] = useState<StatusMembro>("ATIVO");
  const [curso, setCurso] = useState("");
  const [semestre, setSemestre] = useState("");
  const [projetoIds, setProjetoIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleProjeto(id: string) {
    setProjetoIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function reset() {
    setNome("");
    setEmail("");
    setRole("MEMBRO_PROJETO");
    setStatus("ATIVO");
    setCurso("");
    setSemestre("");
    setProjetoIds([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { membro, emailEnviado } = await api<{
        membro: Omit<Membro, "convitePendente">;
        emailEnviado: boolean | null;
      }>("/api/admin/membros", {
        method: "POST",
        body: JSON.stringify({
          nome,
          email,
          role,
          status,
          curso: curso || null,
          semestre: semestre ? Number(semestre) : null,
          projetoIds,
        }),
      });
      // Esse fluxo sempre gera um convite novo — o token já existe mesmo que
      // o e-mail em si tenha falhado (dá pra reenviar depois).
      onCreated({ ...membro, convitePendente: true });
      if (emailEnviado === false) {
        toast.warning("Membro adicionado, mas o e-mail de convite não pôde ser enviado", {
          description: "Verifique a configuração do Resend e reenvie o convite pelo ícone de envelope.",
        });
      } else {
        toast.success("Membro adicionado");
      }
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao adicionar membro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Adicionar membro
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar membro</DialogTitle>
          <DialogDescription>
            O membro recebe um e-mail com um link pra criar a própria senha — você não define senha
            nenhuma aqui.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="membro-nome">Nome</Label>
            <Input id="membro-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="membro-email">E-mail</Label>
            <Input
              id="membro-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cargo</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="membro-semestre">Semestre</Label>
              <Input
                id="membro-semestre"
                type="number"
                min={1}
                value={semestre}
                onChange={(e) => setSemestre(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusMembro)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_MEMBRO_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_MEMBRO_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="membro-curso">Curso</Label>
              <Input id="membro-curso" value={curso} onChange={(e) => setCurso(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Projetos</Label>
            <div className="grid grid-cols-2 gap-2">
              {projetos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={projetoIds.includes(p.id)}
                    onCheckedChange={() => toggleProjeto(p.id)}
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cadastro manual: diferente do fluxo por convite (FormularioMembro), aqui o
 * MESTRE define todos os campos na hora, inclusive a senha — não sai e-mail
 * nenhum, o próprio MESTRE repassa as credenciais pro membro. Só faz sentido
 * pra quem já tem acesso total, por isso o botão só aparece pro MESTRE.
 */
function CadastroManualMembro({
  projetos,
  onCreated,
}: {
  projetos: Projeto[];
  onCreated: (membro: Membro) => void;
}) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [role, setRole] = useState<Role>("MEMBRO_PROJETO");
  const [status, setStatus] = useState<StatusMembro>("ATIVO");
  const [curso, setCurso] = useState("");
  const [semestre, setSemestre] = useState("");
  const [projetoIds, setProjetoIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleProjeto(id: string) {
    setProjetoIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function reset() {
    setNome("");
    setEmail("");
    setSenha("");
    setConfirmarSenha("");
    setRole("MEMBRO_PROJETO");
    setStatus("ATIVO");
    setCurso("");
    setSemestre("");
    setProjetoIds([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (senha.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres");
      return;
    }
    if (senha !== confirmarSenha) {
      toast.error("As senhas não coincidem");
      return;
    }

    setSaving(true);
    try {
      const { membro } = await api<{ membro: Omit<Membro, "convitePendente"> }>(
        "/api/admin/membros",
        {
          method: "POST",
          body: JSON.stringify({
            nome,
            email,
            senha,
            role,
            status,
            curso: curso || null,
            semestre: semestre ? Number(semestre) : null,
            projetoIds,
          }),
        },
      );
      // Cadastro manual não gera convite por e-mail, então não há token pendente.
      onCreated({ ...membro, convitePendente: false });
      toast.success("Membro cadastrado");
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao cadastrar membro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <KeyRound className="mr-2 h-4 w-4" />
          Cadastro manual
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastro manual</DialogTitle>
          <DialogDescription>
            Você define a senha aqui — não sai convite por e-mail. Combine as credenciais com o
            membro por fora.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="manual-nome">Nome</Label>
            <Input id="manual-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-email">E-mail</Label>
            <Input
              id="manual-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-senha">Senha</Label>
              <Input
                id="manual-senha"
                type="password"
                minLength={8}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-confirmar-senha">Confirmar senha</Label>
              <Input
                id="manual-confirmar-senha"
                type="password"
                minLength={8}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cargo</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-semestre">Semestre</Label>
              <Input
                id="manual-semestre"
                type="number"
                min={1}
                value={semestre}
                onChange={(e) => setSemestre(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusMembro)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_MEMBRO_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_MEMBRO_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manual-curso">Curso</Label>
              <Input id="manual-curso" value={curso} onChange={(e) => setCurso(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Projetos</Label>
            <div className="grid grid-cols-2 gap-2">
              {projetos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={projetoIds.includes(p.id)}
                    onCheckedChange={() => toggleProjeto(p.id)}
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditarMembroDialog({
  membro,
  projetos,
  onUpdated,
}: {
  membro: Membro;
  projetos: Projeto[];
  onUpdated: (membro: Membro) => void;
}) {
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(membro.nome ?? "");
  const [email, setEmail] = useState(membro.email);
  const [novaSenha, setNovaSenha] = useState("");
  const [role, setRole] = useState<Role>(membro.role);
  const [status, setStatus] = useState<StatusMembro>(membro.status);
  const [nivelCarta, setNivelCarta] = useState<NivelCarta | null>(membro.nivelCarta);
  const [curso, setCurso] = useState(membro.curso ?? "");
  const [semestre, setSemestre] = useState(membro.semestre?.toString() ?? "");
  const [projetoIds, setProjetoIds] = useState<string[]>(membro.projetos.map((p) => p.id));
  const [saving, setSaving] = useState(false);

  function abrir(v: boolean) {
    setOpen(v);
    if (v) {
      // Sincroniza com os dados atuais do membro toda vez que o diálogo abre.
      setNome(membro.nome ?? "");
      setEmail(membro.email);
      setNovaSenha("");
      setRole(membro.role);
      setStatus(membro.status);
      setNivelCarta(membro.nivelCarta);
      setCurso(membro.curso ?? "");
      setSemestre(membro.semestre?.toString() ?? "");
      setProjetoIds(membro.projetos.map((p) => p.id));
    }
  }

  function toggleProjeto(id: string) {
    setProjetoIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (novaSenha && novaSenha.length < 8) {
      toast.error("A nova senha precisa ter pelo menos 8 caracteres");
      return;
    }

    setSaving(true);
    try {
      const { membro: atualizado } = await api<{ membro: Omit<Membro, "convitePendente"> }>(
        `/api/admin/membros/${membro.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            nome,
            email,
            ...(novaSenha ? { password: novaSenha } : {}),
            role,
            status,
            nivelCarta,
            curso: curso || null,
            semestre: semestre ? Number(semestre) : null,
            projetoIds,
          }),
        },
      );
      // Editar dados não mexe em convite/token — preserva o sinal que já tínhamos.
      onUpdated({ ...atualizado, convitePendente: membro.convitePendente });
      toast.success("Dados do membro atualizados");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar membro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          aria-label={`Corrigir dados de ${membro.nome ?? membro.email}`}
          title="Corrigir dados do membro"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Corrigir dados do membro</DialogTitle>
          <DialogDescription>
            Ajuste o que precisar. Deixe a senha em branco pra não mexer nela.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="editar-nome">Nome</Label>
            <Input id="editar-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="editar-email">E-mail</Label>
            <Input
              id="editar-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="editar-senha">Nova senha (opcional)</Label>
            <Input
              id="editar-senha"
              type="password"
              minLength={8}
              placeholder="Deixe em branco pra manter a atual"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cargo</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_ORDER.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editar-semestre">Semestre</Label>
              <Input
                id="editar-semestre"
                type="number"
                min={1}
                value={semestre}
                onChange={(e) => setSemestre(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusMembro)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_MEMBRO_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_MEMBRO_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editar-curso">Curso</Label>
              <Input id="editar-curso" value={curso} onChange={(e) => setCurso(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Nível da cartinha (Hall da Fama)</Label>
            <Select
              value={nivelCarta ?? SEM_NIVEL}
              onValueChange={(v) => setNivelCarta(v === SEM_NIVEL ? null : (v as NivelCarta))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_NIVEL}>Nenhum (não entra no Hall da Fama)</SelectItem>
                {NIVEL_CARTA_ORDER.map((n) => (
                  <SelectItem key={n} value={n}>
                    {NIVEL_CARTA_LABELS[n]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Projetos</Label>
            <div className="grid grid-cols-2 gap-2">
              {projetos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={projetoIds.includes(p.id)}
                    onCheckedChange={() => toggleProjeto(p.id)}
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar correção"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportarTxt({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<LinhaResultado[] | null>(null);
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImportar() {
    if (!texto.trim()) return;
    setImportando(true);
    setResultados(null);
    try {
      const { resultados: r } = await api<{ resultados: LinhaResultado[] }>(
        "/api/admin/membros/importar",
        { method: "POST", body: JSON.stringify({ texto }) },
      );
      setResultados(r);
      const erros = r.filter((x) => x.status === "erro").length;
      if (erros === 0) toast.success(`${r.length} membro(s) processado(s)`);
      else toast.error(`${erros} linha(s) com erro — veja o relatório`);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    } finally {
      setImportando(false);
    }
  }

  async function handleFile(file: File) {
    setTexto(await file.text());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setTexto("");
          setResultados(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Importar .txt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar membros de um .txt</DialogTitle>
          <DialogDescription>
            Um membro por linha, campos separados por <code>;</code>:
            <br />
            <code>nome;email;cargo;curso;semestre;projetos</code>
            <br />
            Curso, semestre e projetos são opcionais. Projetos: nomes separados por vírgula
            (ex.: &ldquo;Rover,Marketing&rdquo;). Cargos aceitos: {ROLE_ORDER.map((r) => ROLE_LABELS[r]).join(", ")}.
            Membro novo recebe e-mail pra criar a senha; e-mail já cadastrado só atualiza cargo/curso/semestre/projetos.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          Escolher arquivo .txt
        </Button>

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"João Silva;joao@aluno.unb.br;Membro de Projeto;Eng. de Software;4;Rover,Marketing"}
          rows={8}
          className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        />

        {resultados && (
          <div className="max-h-48 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r) => (
                  <TableRow key={r.linha}>
                    <TableCell>{r.linha}</TableCell>
                    <TableCell>{r.email ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={
                          r.status === "erro" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                        }
                      >
                        {r.status === "erro" ? (r.mensagem ?? "erro") : r.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button type="button" onClick={handleImportar} disabled={importando || !texto.trim()}>
            {importando ? "Importando..." : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AdminMembros = () => {
  const { isMestre, role } = useVisao();
  // MESTRE e CAPITAO corrigem dados/importam .txt; Gerente de Projeto só vê,
  // reenvia convite e vê o sinal de abertura — cadastrar e remover são só do MESTRE.
  const podeEditar = role === "MESTRE" || role === "CAPITAO";
  const podeReenviarConvite = podeEditar || role === "GERENTE_PROJETO";
  const [membros, setMembros] = useState<Membro[] | null>(null);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);

  async function carregar() {
    setLoading(true);
    try {
      const [{ membros: m }, { projetos: p }] = await Promise.all([
        api<{ membros: Membro[] }>("/api/admin/membros"),
        api<{ projetos: Projeto[] }>("/api/projetos"),
      ]);
      setMembros(m);
      setProjetos(p);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar membros");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function handleDelete(id: string) {
    try {
      await api(`/api/admin/membros/${id}`, { method: "DELETE" });
      setMembros((prev) => prev?.filter((m) => m.id !== id) ?? null);
      toast.success("Membro removido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover membro");
    }
  }

  async function handleReenviarConvite(id: string) {
    try {
      await api(`/api/admin/membros/${id}/reenviar-convite`, { method: "POST" });
      // Novo token, ainda não aberto — reflete isso na hora, sem esperar reload.
      setMembros(
        (prev) =>
          prev?.map((m) =>
            m.id === id ? { ...m, convitePendente: true, conviteAbertoEm: null } : m,
          ) ?? null,
      );
      toast.success("Convite reenviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reenviar convite");
    }
  }

  function handleExportar() {
    if (!membros || membros.length === 0) {
      toast.error("Não há membros pra exportar");
      return;
    }

    // Mesmo formato aceito pelo "Importar .txt" — dá pra editar e reimportar.
    // Status e nível vão como 7º/8º campos só de referência: o importador
    // ignora colunas extras, então reimportar esse arquivo não mexe neles.
    const linhas = [
      "# nome;email;cargo;curso;semestre;projetos;status;nivel (7º e 8º campos são só referência, reimportar não altera)",
      ...membros.map((m) =>
        [
          m.nome ?? "",
          m.email,
          ROLE_LABELS[m.role],
          m.curso ?? "",
          m.semestre ?? "",
          m.projetos.map((p) => p.nome).join(","),
          STATUS_MEMBRO_LABELS[m.status],
          m.nivelCarta ? NIVEL_CARTA_LABELS[m.nivelCarta] : "",
        ].join(";"),
      ),
    ];

    const blob = new Blob([linhas.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `membros-titans-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Gerenciar Membros</CardTitle>
          <CardDescription>
            {isMestre
              ? "Cadastre membros manualmente ou importe vários de uma vez."
              : podeEditar
                ? "Corrija dados, reenvie convites e importe .txt — cadastrar ou remover membros é só do Mestre."
                : "Consulta ao quadro de membros e reenvio de convite de senha."}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleExportar} disabled={!membros?.length}>
            <Download className="mr-2 h-4 w-4" />
            Baixar .txt
          </Button>
          {podeEditar && <ImportarTxt onImported={carregar} />}
          {isMestre && (
            <>
              <CadastroManualMembro
                projetos={projetos}
                onCreated={(membro) => setMembros((prev) => [...(prev ?? []), membro])}
              />
              <FormularioMembro
                projetos={projetos}
                onCreated={(membro) => setMembros((prev) => [...(prev ?? []), membro])}
              />
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Curso / Semestre</TableHead>
                  <TableHead>Projetos</TableHead>
                  {podeReenviarConvite && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(membros ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.nome ?? "—"}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>{ROLE_LABELS[m.role]}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_MEMBRO_BADGE_CLASS[m.status]}>
                        {STATUS_MEMBRO_LABELS[m.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {m.nivelCarta ? (
                        <Badge variant="secondary">{NIVEL_CARTA_LABELS[m.nivelCarta]}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.curso ?? "—"}
                      {m.semestre ? ` · ${m.semestre}º semestre` : ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.projetos.map((p) => (
                          <Badge key={p.id} variant="secondary">
                            {p.nome}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    {podeReenviarConvite && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {m.convitePendente && (
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center ${
                                m.conviteAbertoEm
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-muted-foreground/50"
                              }`}
                              title={
                                m.conviteAbertoEm
                                  ? `Abriu o link de senha em ${format(
                                      parseISO(m.conviteAbertoEm),
                                      "dd/MM/yyyy 'às' HH:mm",
                                    )}`
                                  : "Convite enviado — ainda não abriu o link de senha"
                              }
                            >
                              {m.conviteAbertoEm ? (
                                <MailOpen className="h-4 w-4" />
                              ) : (
                                <Mail className="h-4 w-4" />
                              )}
                            </span>
                          )}
                          {podeEditar && (
                            <EditarMembroDialog
                              membro={m}
                              projetos={projetos}
                              onUpdated={(atualizado) =>
                                setMembros((prev) =>
                                  prev?.map((x) => (x.id === atualizado.id ? atualizado : x)) ?? null,
                                )
                              }
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => handleReenviarConvite(m.id)}
                            aria-label={`Reenviar convite para ${m.nome ?? m.email}`}
                            title="Reenviar convite de senha"
                          >
                            <Mail className="h-4 w-4" />
                          </Button>
                          {isMestre && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDelete(m.id)}
                              aria-label={`Remover ${m.nome ?? m.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminMembros;
