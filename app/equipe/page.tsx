"use client";

import dynamic from "next/dynamic";

// Mesmo motivo do /equipe/tarefas: Kanban é 100% client-side (estado em
// memória, drag & drop), sem SSR pra evitar mismatch de hidratação.
const EquipePainel = dynamic(() => import("@/views/EquipePainel"), {
  ssr: false,
});

export default function Page() {
  return <EquipePainel />;
}
