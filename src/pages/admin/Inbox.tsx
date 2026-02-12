import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminInbox() {
  return (
    <Card>
      <CardHeader><CardTitle>Inbox</CardTitle></CardHeader>
      <CardContent><p className="text-muted-foreground">Próximamente — Notificaciones administrativas.</p></CardContent>
    </Card>
  );
}
