# Login "recarga" al hacer clic en un campo — diagnóstico (xd-hlm, 2026-08-14)

## Síntoma reportado
En la URL de producción `https://monte-xanic-dashboard-ky5t.vercel.app`,
al hacer clic en cualquiera de las dos cajas de texto del login la pantalla
de login "se recarga". Reportado en escritorio y en el webapp móvil.
No reproducible localmente.

## Conclusión: NO es código ni plataforma — es ambiental al navegador del reportante
No se logró reproducir la recarga contra la URL de producción en vivo con
Chromium instrumentado (Playwright 1.61 / Chromium 1228, dominios CDP
Network y Page), ni en escritorio ni con el perfil iPhone 13. La entrada
sobrevive intacta a toda la interacción (ver capturas). Todos los candidatos
de código y de plataforma que nombraba el bead quedan excluidos con evidencia.
El DoD del bead permite explícitamente una explicación ambiental; no se
inventa un cambio de código.

## Evidencia

### 1. Reproducción en vivo (instrumentada) — sin recarga
Secuencia clic → escribir `admin` → clic pass → escribir → Tab → clic, en
escritorio y en iPhone 13, capturando `framenavigated`, `beforeunload`,
`pagehide`, `submit`, y una `MutationObserver` sobre `#login-screen`:
- Una sola petición de documento (la carga inicial), `initiator {type:"other"}`,
  status **200**, `x-vercel-cache: HIT`, **sin** `redirectResponse`.
- **Cero** navegaciones adicionales, `beforeunload`, `pagehide` o `submit`
  durante los clics/tipeo.
- Solo ciclo limpio de `focus`/`blur` alternando `login-user` ↔ `login-pass`.
- El marcador `window.__mark` sobrevive; los valores tecleados persisten en
  ambas capturas (`admin` + punto de contraseña).

### 2. Redirección de plataforma — DESCARTADA
- `http://…` → **308** único a `https://…` (upgrade correcto, sin loop).
- `https://…/` raíz → **200**, 0 redirects.
- Sin `set-cookie`, sin cookie de Vercel Deployment Protection / SSO
  (`_vercel_sso`), sin gate.

### 3. Contenido inyectado en la página desplegada — DESCARTADO
- El HTML desplegado solo carga `/theme-init.js` (del repo, restaura tema, inerte)
  y el bundle Vite con hash `/assets/index-CiTS4ag0.js`.
- CSP `script-src 'self'` impide inyectar scripts externos.
- El bundle desplegado contiene los marcadores propios de la app
  (`login-screen`, `xanic_session_token`, `handleSubmit`); las apariciones de
  `location.href`/`assign`/`reload()` son de librerías empaquetadas
  (jspdf, SheetJS, pdfobject) o del refresco de datos de `rowEditor`, ninguna
  ligada al login.

## Candidato ambiental más probable y cómo confirmarlo
La diferencia entre un Chromium headless (que no reproduce) y el navegador
real del reportante (que sí) es típicamente una **extensión** o el
**gestor de contraseñas/autofill** interactuando con el campo. Para aislarlo,
pedir al reportante que reproduzca en una ventana de incógnito con extensiones
deshabilitadas y, con DevTools → Network → "Preserve log" activo, haga clic en
la caja y anote si dispara una petición de documento y cuál es su iniciador.
El iniciador de la única petición de documento observada en vivo es
`{type:"other"}` (la navegación inicial), sin cadena de redirección.

## Fuera de alcance
El auto-zoom de iOS (`.login-input` a 14px < 16px) es real para pulido móvil
pero no explica el caso de escritorio; no es la causa raíz. Archívese aparte
si se desea.

## Estado
Sin cambio de código. Registro de investigación únicamente.
