import { redirect } from "next/navigation";

// Rota antiga: o quadro de tarefas agora é por projeto, dentro do painel em /equipe.
export default function Page() {
  redirect("/equipe");
}
