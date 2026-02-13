import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Save, User, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  doctorId: string;
}

export default function DoctorProfileCard({ doctorId }: Props) {
  const queryClient = useQueryClient();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["doctor-profile-full", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("full_name, phone, address")
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
  const [address, setAddress] = useState("");
  const [selectedSpecIds, setSelectedSpecIds] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPhone(profile.phone ?? "");
      setAddress(profile.address ?? "");
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
      if (address.trim().length > 200) throw new Error("La dirección es demasiado larga");

      const { error } = await supabase
        .from("doctors")
        .update({
          full_name: trimmedName,
          phone: phone.trim() || null,
          address: address.trim() || null,
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

  if (profileLoading || specLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Perfil del Doctor
        </CardTitle>
        <CardDescription>Información personal y especialidades.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Basic info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nombre completo *</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={100}
              placeholder="Dr. Juan Pérez"
            />
          </div>
          <div className="space-y-2">
            <Label>Teléfono</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              placeholder="+52 555 123 4567"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Dirección</Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
            placeholder="Consultorio, calle, colonia..."
          />
        </div>
        <Button
          onClick={() => saveProfileMut.mutate()}
          disabled={saveProfileMut.isPending || !fullName.trim()}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {saveProfileMut.isPending ? "Guardando…" : "Guardar perfil"}
        </Button>

        {/* Specialties */}
        <div className="border-t pt-4 space-y-3">
          <Label>Especialidades</Label>
          <div className="flex flex-wrap gap-2">
            {selectedSpecIds.map((sid) => {
              const spec = (allSpecialties ?? []).find((s) => s.id === sid);
              return (
                <Badge key={sid} variant="secondary" className="gap-1 pr-1">
                  {spec?.name ?? sid}
                  <button
                    onClick={() => removeSpecialty(sid)}
                    className="ml-1 rounded-full p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            {selectedSpecIds.length === 0 && (
              <span className="text-sm text-muted-foreground">Sin especialidades</span>
            )}
          </div>
          {availableSpecialties.length > 0 && (
            <Select onValueChange={addSpecialty} value="">
              <SelectTrigger className="w-60">
                <SelectValue placeholder="Agregar especialidad" />
              </SelectTrigger>
              <SelectContent>
                {availableSpecialties.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            onClick={() => saveSpecialtiesMut.mutate()}
            disabled={saveSpecialtiesMut.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saveSpecialtiesMut.isPending ? "Guardando…" : "Guardar especialidades"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
