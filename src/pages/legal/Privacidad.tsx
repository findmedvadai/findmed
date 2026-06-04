import LegalDocument from "@/components/LegalDocument";
import privacidadMd from "@/content/legal/privacidad.md?raw";

export default function Privacidad() {
  return <LegalDocument pageTitle="Aviso de Privacidad — FindMed" content={privacidadMd} />;
}
