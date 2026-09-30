export type TaskPriority = 1 | 2 | 3;

export interface Subtask {
  id: string;
  description: string;
  done: boolean;
}

export interface Coluna {
  id: string;
  nome: string;
  ordem: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  /** Data de entrega em ISO (yyyy-MM-dd) ou null quando sem prazo. */
  dueDate: string | null;
  colunaId: string;
  subtasks: Subtask[];
  createdAt: string;
}

export interface BoardData {
  projetoId: string;
  projetoNome: string;
  /** Se o usuário logado pode criar/editar/mover tarefas e colunas deste projeto. */
  canEdit: boolean;
  colunas: Coluna[];
  tasks: Task[];
}

interface PriorityMeta {
  label: string;
  /** Classes para o badge — legíveis em light e dark. */
  className: string;
}

export const PRIORITY_ORDER: TaskPriority[] = [1, 2, 3];

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  1: {
    label: "Baixa prioridade",
    className:
      "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  2: {
    label: "Média prioridade",
    className:
      "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  3: {
    label: "Alta prioridade",
    className:
      "border-transparent bg-destructive/15 text-destructive dark:text-red-300",
  },
};
