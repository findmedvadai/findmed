import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const GoogleCalendarSuccess = () => {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!error) {
      try {
        window.opener?.postMessage("google-calendar-connected", "*");
      } catch (e) {
        // ignore
      }
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          window.close();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [error]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="bg-card rounded-xl p-10 shadow-lg text-center max-w-sm">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" className="fill-destructive/20 stroke-destructive" strokeWidth="2" />
              <path d="M8 8l8 8M16 8l-8 8" className="stroke-destructive" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-destructive mb-2">Error</h1>
          <p className="text-muted-foreground text-sm">{decodeURIComponent(error)}</p>
          <button
            onClick={() => window.close()}
            className="mt-6 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Cerrar ventana
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="bg-card rounded-xl p-10 shadow-lg text-center max-w-sm">
        <svg className="mx-auto mb-4" width="64" height="64" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="11" fill="#dcfce7" stroke="#16a34a" strokeWidth="2" />
          <path d="M7 12.5l3 3 7-7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h1 className="text-xl font-semibold text-green-600 mb-2">¡Conexión exitosa!</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Tu cuenta de Google ha sido vinculada correctamente.
          <br />
          Ya puedes cerrar esta ventana y seleccionar el calendario que deseas usar.
        </p>
        <p className="text-xs text-muted-foreground/60 mt-2">
          Esta ventana se cerrará automáticamente en {countdown} segundos...
        </p>
        <button
          onClick={() => window.close()}
          className="mt-6 px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
        >
          Cerrar ventana
        </button>
      </div>
    </div>
  );
};

export default GoogleCalendarSuccess;
