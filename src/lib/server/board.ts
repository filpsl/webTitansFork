import { prisma } from "./prisma";
import { podeEditarProjeto } from "./permissions";
import type { Role } from "../../../generated/prisma/enums";
import type { Coluna, Subtask, Task, TaskPriority } from "../kanban/types";

type Usuario = { id: string; role: Role };

export async function getProjetoComMembros(projetoId: string) {
  return prisma.projeto.findUnique({
    where: { id: projetoId },
    select: { id: true, nome: true, membros: { select: { id: true } } },
  });
}

/** null = coluna não existe. */
export async function podeEditarColuna(
  usuario: Usuario,
  colunaId: string
): Promise<boolean | null> {
  const coluna = await prisma.coluna.findUnique({
    where: { id: colunaId },
    select: { projeto: { select: { membros: { select: { id: true } } } } },
  });
  if (!coluna) return null;
  return podeEditarProjeto(usuario, coluna.projeto);
}

/** null = tarefa não existe. */
export async function podeEditarTarefa(
  usuario: Usuario,
  tarefaId: string
): Promise<boolean | null> {
  const tarefa = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: {
      coluna: { select: { projeto: { select: { membros: { select: { id: true } } } } } },
    },
  });
  if (!tarefa) return null;
  return podeEditarProjeto(usuario, tarefa.coluna.projeto);
}

/** null = subtarefa não existe. */
export async function podeEditarSubtarefa(
  usuario: Usuario,
  subtarefaId: string
): Promise<boolean | null> {
  const subtarefa = await prisma.subtarefa.findUnique({
    where: { id: subtarefaId },
    select: {
      tarefa: {
        select: {
          coluna: { select: { projeto: { select: { membros: { select: { id: true } } } } } },
        },
      },
    },
  });
  if (!subtarefa) return null;
  return podeEditarProjeto(usuario, subtarefa.tarefa.coluna.projeto);
}

type TarefaComSub = {
  id: string;
  titulo: string;
  descricao: string;
  prioridade: number;
  dataEntrega: Date | null;
  colunaId: string;
  createdAt: Date;
  subtarefas: { id: string; descricao: string; concluida: boolean }[];
};

export function mapTarefa(t: TarefaComSub): Task {
  return {
    id: t.id,
    title: t.titulo,
    description: t.descricao,
    priority: t.prioridade as TaskPriority,
    dueDate: t.dataEntrega ? t.dataEntrega.toISOString().slice(0, 10) : null,
    colunaId: t.colunaId,
    createdAt: t.createdAt.toISOString().slice(0, 10),
    subtasks: t.subtarefas.map(
      (s): Subtask => ({ id: s.id, description: s.descricao, done: s.concluida })
    ),
  };
}

export function mapColuna(c: { id: string; nome: string; ordem: number }): Coluna {
  return { id: c.id, nome: c.nome, ordem: c.ordem };
}
