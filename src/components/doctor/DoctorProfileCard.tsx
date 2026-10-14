import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Save, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  doctorId: string;
}

/** Aviso discreto junto al botón de guardar cuando hay cambios pendientes. */
function UnsavedHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-xs font-medium text-warning">Cambios sin guardar</span>;
}

export default function DoctorProfileCard({ doctorId }: Props) {
  const queryClient = useQueryClient();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["doctor-profile-full", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("full_name, phone")
        .eq("id", doctorId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!doctorId,
  });

  const { data: doctorSpecialties, isLoading: specLoading } = useQuery({
    queryKey: ["doctor-specialties", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_specialties")
        .select("specialty_id, specialties(id, name)")
        .eq("doctor_id", doctorId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!doctorId,
  });

  const { data: allSpecialties } = useQuery({
    queryKey: ["all-specialties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("specialties")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedSpecIds, setSelectedSpecIds] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPhone(profile.phone ?? "");
    }
  }, [profile]);

  useEffect(() => {
    if (doctorSpecialties) {
      setSelectedSpecIds(doctorSpecialties.map((ds) => ds.specialty_id));
    }
  }, [doctorSpecialties]);

  const saveProfileMut = useMutation({
    mutationFn: async () => {
      const trimmedName = fullName.trim();
      if (!trimmedName) throw new Error("El nombre es requerido");
      if (trimmedName.length > 100) throw new Error("El nombre es demasiado largo");
      if (phone.trim().length > 20) throw new Error("El teléfono es demasiado largo");

      // Note: doctor.address is deprecated since Mejora 2 — address now lives
      // on each office. We don't write it here.
      const { error } = await supabase
        .from("doctors")
        .update({
          full_name: trimmedName,
          phone: phone.trim() || null,
        })
        .eq("id", doctorId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Perfil guardado" });
      queryClient.invalidateQueries({ queryKey: ["doctor-profile-full", doctorId] });
    },
    onError: (err: Error) => toast({ title: err.message || "Error al guardar", variant: "destructive" }),
  });

  const saveSpecialtiesMut = useMutation({
    mutationFn: async () => {
      // Delete existing and re-insert
      await supabase.from("doctor_specialties").delete().eq("doctor_id", doctorId);
      if (selectedSpecIds.length > 0) {
        const rows = selectedSpecIds.map((sid) => ({ doctor_id: doctorId, specialty_id: sid }));
        const { error } = await supabase.from("doctor_specialties").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Especialidades guardadas" });
      queryClient.invalidateQueries({ queryKey: ["doctor-specialties", doctorId] });
    },
    onError: () => toast({ title: "Error al guardar especialidades", variant: "destructive" }),
  });

  const addSpecialty = (specId: string) => {
    if (!selectedSpecIds.includes(specId)) {
      setSelectedSpecIds((prev) => [...prev, specId]);
    }
  };

  const removeSpecialty = (specId: string) => {
    setSelectedSpecIds((prev) => prev.filter((id) => id !== specId));
  };

  const availableSpecialties = (allSpecialties ?? []).filter(
    (s) => !selectedSpecIds.includes(s.id)
  );

  // Solo para mostrar "Cambios sin guardar"; no altera qué se guarda.
  const profileDirty =
    !!profile && (fullName !== (profile.full_name ?? "") || phone !== (profile.phone ?? ""));
  const savedSpecIds = (doctorSpecialties ?? []).map((ds) => ds.specialty_id);
  const specsDirty =
    !!doctorSpecialties &&
    (savedSpecIds.length !== selectedSpecIds.length || savedSpecIds.some((id) => !selectedSpecIds.includes(id)));

  if (profileLoading || specLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-[220px] w-full rounded-lg" />
        <Skeleton className="h-[220px] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* Datos personales */}
      <Card className="flex flex-col">
        <CardHeader className="space-y-0.5 p-4 pb-3">
          <CardTitle className="text-sm font-semibold">Datos personales</CardTitle>
          <CardDescription className="text-xs">Tu nombre y teléfono de contacto.</CardDescription>
        </CardHeader>
        <CardContent className="grid flex-1 gap-3 p-4 pt-0 sm:grid-cols-2">
          {/* Fila completa: con la tarjeta en media columna, la mitad cortaba nombres largos. */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doctor-full-name" className="text-sm">Nombre completo *</Label>
            <Input
              id="doctor-full-name"
              className="h-9 text-sm"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={100}
              placeholder="Dr. Juan Pérez"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doctor-phone" className="text-sm">Teléfono</Label>
            <Input
              id="doctor-phone"
              className="h-9 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              placeholder="+52 555 123 4567"
            />
          </div>
        </CardContent>
        <div className="flex items-center justify-end gap-3 border-t px-4 py-3">
          <UnsavedHint show={profileDirty} />
          <Button
            size="sm"
            onClick={() => saveProfileMut.mutate()}
            disabled={saveProfileMut.isPending || !fullName.trim()}
            className="gap-1.5"
          >
            <Save className="h-4 w-4" />
            {saveProfileMut.isPending ? "Guardando…" : "Guardar perfil"}
          </Button>
        </div>
      </Card>

      {/* Especialidades */}
      <Card className="flex flex-col">
        <CardHeader className="space-y-0.5 p-4 pb-3">
          <CardTitle className="text-sm font-semibold">Especialidades</CardTitle>
          <CardDescription className="text-xs">Las especialidades en las que atiendes.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 space-y-3 p-4 pt-0">
          <div className="flex min-h-9 flex-wrap items-center gap-1.5">
            {selectedSpecIds.map((sid) => {
              const spec = (allSpecialties ?? []).find((s) => s.id === sid);
              const specName = spec?.name ?? sid;
              return (
                <span
                  key={sid}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground"
                >
                  {specName}
                  <button
                    type="button"
                    onClick={() => removeSpecialty(sid)}
                    aria-label={`Quitar ${specName}`}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {selectedSpecIds.length === 0 && (
              <span className="text-sm text-muted-foreground">Sin especialidades</span>
            )}
          </div>
          {availableSpecialties.length > 0 && (
            <Select onValueChange={addSpecialty} value="">
              <SelectTrigger className="h-9 w-full text-sm sm:w-[240px]" aria-label="Agregar especialidad">
                <SelectValue placeholder="Agregar especialidad" />
              </SelectTrigger>
              <SelectContent>
                {availableSpecialties.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
        <div className="flex items-center justify-end gap-3 border-t px-4 py-3">
          <UnsavedHint show={specsDirty} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveSpecialtiesMut.mutate()}
            disabled={saveSpecialtiesMut.isPending}
            className="gap-1.5"
          >
            <Save className="h-4 w-4" />
            {saveSpecialtiesMut.isPending ? "Guardando…" : "Guardar especialidades"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
