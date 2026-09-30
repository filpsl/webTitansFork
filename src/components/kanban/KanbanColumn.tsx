"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Coluna, Task } from "@/lib/kanban/types";

import { TaskCard } from "./TaskCard";

export function KanbanColumn({
  coluna,
  tasks,
  canEdit,
  draggingId,
  onNewTask,
  onOpenTask,
  onDragStartTask,
  onDragEndTask,
  onDropTask,
  onRename,
  onDelete,
}: {
  coluna: Coluna;
  tasks: Task[];
  canEdit: boolean;
  draggingId: string | null;
  onNewTask: () => void;
  onOpenTask: (task: Task) => void;
  onDragStartTask: (id: string) => void;
  onDragEndTask: () => void;
  onDropTask: (id: string, colunaId: string) => void;
  onRename: (nome: string) => void;
  onDelete: () => void;
}) {
  const [isOver, setIsOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nome, setNome] = useState(coluna.nome);

  function submitRename() {
    const trimmed = nome.trim();
    setEditing(false);
    if (trimmed && trimmed !== coluna.nome) onRename(trimmed);
    else setNome(coluna.nome);
  }

  return (
    <section
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsOver(false);
      }}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setIsOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTask(id, coluna.id);
      }}
      className={cn(
        "flex min-h-[12rem] flex-col rounded-xl border border-t-4 border-t-titans-orange bg-muted/30 transition-colors",
        isOver && "bg-titans-orange/10 ring-2 ring-titans-orange/40",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        {editing ? (
          <Input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setNome(coluna.nome);
                setEditing(false);
              }
            }}
            className="h-7 text-sm font-semibold"
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{coluna.nome}</h2>
            <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {tasks.length}
            </span>
          </div>
        )}

        {canEdit && !editing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setEditing(true)}
              aria-label={`Renomear coluna ${coluna.nome}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label={`Excluir coluna ${coluna.nome}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onNewTask}
              aria-label={`Nova tarefa em ${coluna.nome}`}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 md:max-h-[calc(100vh-16rem)]">
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhuma tarefa
          </p>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              draggable={canEdit}
              dragging={draggingId === task.id}
              onOpen={() => onOpenTask(task)}
              onDragStart={() => onDragStartTask(task.id)}
              onDragEnd={onDragEndTask}
            />
          ))
        )}
      </div>
    </section>
  );
}
