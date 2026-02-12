import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Configuracion() {
  return (
    <Card>
      <CardHeader><CardTitle>Configuración</CardTitle></CardHeader>
      <CardContent><p className="text-muted-foreground">Próximamente — Horarios, duración de citas y disponibilidad.</p></CardContent>
    </Card>
  );
}
