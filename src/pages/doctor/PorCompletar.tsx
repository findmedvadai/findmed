import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PorCompletar() {
  return (
    <Card>
      <CardHeader><CardTitle>Por Completar</CardTitle></CardHeader>
      <CardContent><p className="text-muted-foreground">Próximamente — Citas que requieren notas del doctor.</p></CardContent>
    </Card>
  );
}
