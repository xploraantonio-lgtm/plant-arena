# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## El dominio del juego

El dominio de verdad es **https://www.plants-arena.online**. Tres cosas dependen
de que esté bien configurado, y sólo una vive en el código:

**1. En el código — `VITE_PUBLIC_URL`**

Los enlaces que el juego reparte (invitación `/?ref=CÓDIGO` y repetición
compartida `/r/CÓDIGO`) salen de esta variable, no de la dirección por la que se
esté navegando. Sin ella, abrir el panel desde `*.vercel.app` produce enlaces que
apuntan a Vercel, y desde el ordenador de desarrollo apuntan a `localhost` — el
jugador los manda y el que los recibe acaba en cualquier sitio menos en el juego.

Se pone en `.env` (local) y en Vercel → Settings → Environment Variables. Es de
compilación, así que hay que volver a desplegar para que entre.

Todo lo que compone enlaces pasa por `src/utils/direccionPublica.ts`.

**2. En `vercel.json` — la redirección de la dirección vieja**

Lo que llegue a `plant-arena.vercel.app` se manda al dominio con su ruta y sus
parámetros, para que los enlaces ya repartidos sigan funcionando.

Está como redirección **temporal** (307) a propósito: una permanente (308) se
queda guardada en el navegador de quien la reciba y cuesta deshacerla. Cuando el
dominio esté rodado, `"permanent": true`.

Ojo: `vercel.json` es JSON y Vercel valida el esquema — **no admite comentarios**,
ni con una clave `"//"`. Por eso esta explicación está aquí.

**3. En Supabase — la vuelta del inicio de sesión**

El código pide volver al dominio público (`urlDeVuelta()`), pero **Supabase lo
ignora si la dirección no está en su lista blanca**. En Authentication → URL
Configuration:

- **Site URL**: `https://www.plants-arena.online`
- **Redirect URLs**: `https://www.plants-arena.online/**`,
  `https://plants-arena.online/**` y `http://localhost:5173/**`

Los `/**` importan: sin ellos sólo vale la raíz exacta y una vuelta con `?ref=` o
`/r/token` se queda fuera.

En local, `urlDeVuelta()` devuelve `localhost` a propósito — si no, entrar con
Google desde el ordenador de desarrollo saltaría a producción.
