import LegalDocument from "@/components/LegalDocument";
import terminosMd from "@/content/legal/terminos.md?raw";

export default function Terminos() {
  return <LegalDocument pageTitle="Términos y Condiciones — FindMed" content={terminosMd} />;
}
