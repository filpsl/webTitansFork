"use client";

import { useState } from "react";
import { Loader2, Plus, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useProjetoBoard, type TaskDraft } from "@/hooks/useProjetoBoard";
import { MAX_COLUNAS_POR_PROJETO } from "@/lib/projetos";
import type { Task } from "@/lib/kanban/types";

import { KanbanColumn } from "./KanbanColumn";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { TaskFormDialog } from "./TaskFormDialog";

type DialogState =
  | { kind: "none" }
  | { kind: "create"; colunaId: string }
  | { kind: "edit"; id: string }
  | { kind: "view"; id: string };

export function KanbanBoard({ projetoId }: { projetoId: string }) {
  const {
    board,
    loading,
    error,
    addColuna,
    renameColuna,
    deleteColuna,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    toggleSubtask,
  } = useProjetoBoard(projetoId);

  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [novaColuna, setNovaColuna] = useState("");
  const [addingColuna, setAddingColuna] = useState(false);

  if (loading && !board) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando quadro...
      </div>
    );
  }

  if (error && !board) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!board) return null;

  const { canEdit, colunas, tasks } = board;
  const activeId =
    dialog.kind === "edit" || dialog.kind === "view" ? dialog.id : null;
  const activeTask: Task | null =
    activeId != null ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const activeColunaNome =
    colunas.find((c) => c.id === activeTask?.colunaId)?.nome ?? "";

  async function handleSubmit(draft: TaskDraft) {
    try {
      if (dialog.kind === "edit") {
        await updateTask(dialog.id, draft);
        toast.success("Tarefa atualizada");
      } else {
        await addTask(draft);
        toast.success("Tarefa criada");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar tarefa");
    }
  }

  async function handleDelete() {
    if (!activeTask) return;
    try {
      await deleteTask(activeTask.id);
      setDialog({ kind: "none" });
      toast.success("Tarefa excluída");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir tarefa");
    }
  }

  async function handleAddColuna() {
    const nome = novaColuna.trim();
    if (!nome) return;
    try {
      await addColuna(nome);
      setNovaColuna("");
      setAddingColuna(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar coluna");
    }
  }

  return (
    <div
      className={cn(
        "space-y-4",
        !canEdit && "rounded-xl border border-destructive/40 p-3",
      )}
    >
      {!canEdit && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          Você não é membro deste projeto — pode visualizar o quadro, mas não editar.
        </div>
      )}

      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          {addingColuna ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={novaColuna}
                onChange={(e) => setNovaColuna(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddColuna();
                  if (e.key === "Escape") {
                    setNovaColuna("");
                    setAddingColuna(false);
                  }
                }}
                placeholder="Nome da coluna"
                className="h-8 w-48"
              />
              <Button size="sm" onClick={handleAddColuna}>
                Adicionar
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={colunas.length >= MAX_COLUNAS_POR_PROJETO}
              onClick={() => setAddingColuna(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova coluna
              {colunas.length >= MAX_COLUNAS_POR_PROJETO && " (limite atingido)"}
            </Button>
          )}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {colunas.map((coluna) => (
          <div key={coluna.id} className="w-64 shrink-0">
            <KanbanColumn
              coluna={coluna}
              tasks={tasks.filter((t) => t.colunaId === coluna.id)}
              canEdit={canEdit}
              draggingId={draggingId}
              onNewTask={() => setDialog({ kind: "create", colunaId: coluna.id })}
              onOpenTask={(task) => setDialog({ kind: "view", id: task.id })}
              onDragStartTask={setDraggingId}
              onDragEndTask={() => setDraggingId(null)}
              onDropTask={(id, colunaId) => {
                setDraggingId(null);
                if (tasks.find((t) => t.id === id)?.colunaId === colunaId) return;
                moveTask(id, colunaId).catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Erro ao mover tarefa"),
                );
              }}
              onRename={(nome) =>
                renameColuna(coluna.id, nome).catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Erro ao renomear coluna"),
                )
              }
              onDelete={() =>
                deleteColuna(coluna.id).catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Erro ao excluir coluna"),
                )
              }
            />
          </div>
        ))}
      </div>

      <TaskFormDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        mode={dialog.kind === "edit" ? "edit" : "create"}
        task={dialog.kind === "edit" ? activeTask : null}
        colunas={colunas}
        defaultColunaId={
          dialog.kind === "create" ? dialog.colunaId : (colunas[0]?.id ?? "")
        }
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: "none" });
        }}
        onSubmit={handleSubmit}
      />

      <TaskDetailDialog
        task={dialog.kind === "view" ? activeTask : null}
        colunaNome={activeColunaNome}
        canEdit={canEdit}
        open={dialog.kind === "view"}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: "none" });
        }}
        onEdit={() =>
          activeTask && setDialog({ kind: "edit", id: activeTask.id })
        }
        onDelete={handleDelete}
        onToggleSubtask={(subtaskId) => {
          const sub = activeTask?.subtasks.find((s) => s.id === subtaskId);
          if (!sub) return;
          toggleSubtask(subtaskId, !sub.done).catch((e) =>
            toast.error(e instanceof Error ? e.message : "Erro ao atualizar subtarefa"),
          );
        }}
      />
    </div>
  );
}
