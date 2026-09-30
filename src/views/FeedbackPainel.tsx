import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";

export default function FeedbackPainel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback Anônimo</CardTitle>
        <CardDescription>
          Melhore nossa equipe com sua opinião sincera — ninguém fica sabendo quem enviou.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mx-auto max-w-2xl">
          <FeedbackForm />
        </div>
      </CardContent>
    </Card>
  );
}
