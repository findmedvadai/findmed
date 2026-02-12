import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Reservas() {
  return (
    <Card>
      <CardHeader><CardTitle>Reservas</CardTitle></CardHeader>
      <CardContent><p className="text-muted-foreground">Próximamente — Gestión de reservas.</p></CardContent>
    </Card>
  );
}
