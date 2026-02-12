import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Agenda() {
  return (
    <Card>
      <CardHeader><CardTitle>Mi Agenda</CardTitle></CardHeader>
      <CardContent><p className="text-muted-foreground">Próximamente — Tu agenda de citas.</p></CardContent>
    </Card>
  );
}
