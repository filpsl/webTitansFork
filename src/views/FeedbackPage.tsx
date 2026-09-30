import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";

// Página pública/anônima (sem login) — mesmo formulário e mesma rota da aba
// "Feedback" do painel de membro (FeedbackPainel), só com o wrapper de página
// inteira em vez de Card de painel. Mantida à parte a pedido do usuário
// enquanto as duas formas de acesso convivem.
export default function FeedbackPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-2xl border-none shadow-none bg-transparent">
        <CardHeader className="flex flex-col items-center text-center space-y-2">
          <CardTitle className="text-3xl font-bold tracking-tight">
            Feedback Anônimo
          </CardTitle>
          <CardDescription className="max-w-[500px] text-base">
            Melhore nossa equipe com sua opinião sincera.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeedbackForm />
        </CardContent>
      </Card>
    </div>
  );
}
