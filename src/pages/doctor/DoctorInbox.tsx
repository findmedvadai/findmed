import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DoctorInbox() {
  return (
    <Card>
      <CardHeader><CardTitle>Inbox</CardTitle></CardHeader>
      <CardContent><p className="text-muted-foreground">Próximamente — Tus notificaciones.</p></CardContent>
    </Card>
  );
}
