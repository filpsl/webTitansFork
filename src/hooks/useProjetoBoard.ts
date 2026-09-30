"use client";

import { useCallback, useEffect, useState } from "react";

import type { BoardData, Subtask, Task } from "@/lib/kanban/types";

export type TaskDraft = Pick<
  Task,
  "title" | "description" | "priority" | "dueDate" | "subtasks" | "colunaId"
>;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Erro na requisição"
    );
  }
  return data as T;
}

function draftToBody(draft: TaskDraft) {
  return {
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    dueDate: draft.dueDate,
    colunaId: draft.colunaId,
    subtasks: draft.subtasks.map((s: Subtask) => ({
      description: s.description,
      done: s.done,
    })),
  };
}

export function useProjetoBoard(projetoId: string | null) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projetoId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<BoardData>(`/api/projetos/${projetoId}/board`);
      setBoard(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar o quadro");
    } finally {
      setLoading(false);
    }
  }, [projetoId]);

  useEffect(() => {
    setBoard(null);
    reload();
  }, [reload]);

  const addColuna = useCallback(
    async (nome: string) => {
      if (!projetoId) return;
      await api(`/api/projetos/${projetoId}/colunas`, {
        method: "POST",
        body: JSON.stringify({ nome }),
      });
      await reload();
    },
    [projetoId, reload]
  );

  const renameColuna = useCallback(
    async (colunaId: string, nome: string) => {
      await api(`/api/colunas/${colunaId}`, {
        method: "PATCH",
        body: JSON.stringify({ nome }),
      });
      await reload();
    },
    [reload]
  );

  const deleteColuna = useCallback(
    async (colunaId: string) => {
      await api(`/api/colunas/${colunaId}`, { method: "DELETE" });
      await reload();
    },
    [reload]
  );

  const addTask = useCallback(
    async (draft: TaskDraft) => {
      await api(`/api/colunas/${draft.colunaId}/tarefas`, {
        method: "POST",
        body: JSON.stringify(draftToBody(draft)),
      });
      await reload();
    },
    [reload]
  );

  const updateTask = useCallback(
    async (taskId: string, draft: TaskDraft) => {
      await api(`/api/tarefas/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(draftToBody(draft)),
      });
      await reload();
    },
    [reload]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      await api(`/api/tarefas/${taskId}`, { method: "DELETE" });
      await reload();
    },
    [reload]
  );

  const moveTask = useCallback(
    async (taskId: string, colunaId: string) => {
      await api(`/api/tarefas/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ colunaId }),
      });
      await reload();
    },
    [reload]
  );

  const toggleSubtask = useCallback(
    async (subtaskId: string, done: boolean) => {
      await api(`/api/subtarefas/${subtaskId}`, {
        method: "PATCH",
        body: JSON.stringify({ done }),
      });
      await reload();
    },
    [reload]
  );

  return {
    board,
    loading,
    error,
    reload,
    addColuna,
    renameColuna,
    deleteColuna,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    toggleSubtask,
  };
}
