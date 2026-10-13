// Configuración del panel (se abre desde el engrane): submódulos que no son
// operación diaria. Cada pestaña conserva su propia página.
import { Navigate, NavLink, useParams } from "react-router-dom";
import { Bot, Key, Layers, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import AgenteIA from "./AgenteIA";
import Catalogos from "./Catalogos";
import Webhooks from "./Webhooks";
import ApiKeysPage from "./ApiKeys";

const TABS = [
  { slug: "agente-ia", title: "Agente IA", icon: Bot, element: <AgenteIA /> },
  { slug: "catalogos", title: "Catálogos", icon: Layers, element: <Catalogos /> },
  { slug: "webhooks", title: "Webhooks", icon: Webhook, element: <Webhooks /> },
  { slug: "api-keys", title: "API Keys", icon: Key, element: <ApiKeysPage /> },
];

export default function Configuracion() {
  const { tab } = useParams();
  const current = TABS.find((t) => t.slug === tab);
  if (!current) return <Navigate to="/admin/configuracion/agente-ia" replace />;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1 border-b" aria-label="Configuración">
        {TABS.map((t) => (
          <NavLink
            key={t.slug}
            to={`/admin/configuracion/${t.slug}`}
            className={({ isActive }) =>
              cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )
            }
          >
            <t.icon className="h-4 w-4" />
            {t.title}
          </NavLink>
        ))}
      </nav>
      {current.element}
    </div>
  );
}
