// Datos del contacto del paciente ligado a un caso (garantía 20-oct-2026): el
// mismo editor que el detalle de cita, sin el nombre por cita.
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { PatientContactSection } from "@/components/admin/PatientContactSection";
import { invalidateAdminAppointmentViews } from "@/lib/admin-appointment-queries";

export default function CasePatientContact({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: ["case-patient", patientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("patients").select("id, full_name, phone").eq("id", patientId).maybeSingle();
      if (error) throw error;
      return data;
    },
    placeholderData: keepPreviousData,
    meta: { silentError: true },
  });

  if (isPending) return <Skeleton className="h-20 w-full rounded-lg" />;
  if (isError || !data) return null;

  return (
    <PatientContactSection
      patientId={data.id}
      contact={{ fullName: data.full_name, phone: data.phone }}
      onSaved={() => {
        queryClient.invalidateQueries({ queryKey: ["case-patient", patientId] });
        invalidateAdminAppointmentViews(queryClient);
      }}
    />
  );
}
