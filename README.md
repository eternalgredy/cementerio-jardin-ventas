# Cementerio Jardin - Ventas

Pagina estatica para controlar disponibilidad, reservas y ventas de nichos sobre un plano vectorial.

## Abrir en local

```powershell
python -m http.server 8001
```

Luego abre:

```text
http://127.0.0.1:8001/index.html
```

## Firebase

La app ya esta preparada para Firestore. Completa `firebase-config.js` con la configuracion del proyecto Firebase:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Colecciones usadas:

- `nichos`: estado actual de cada nicho.
- `historial`: movimientos de venta/reserva.

La app intenta usar Firebase Authentication anonimo. Si Auth no esta activado, sigue funcionando con las reglas publicas incluidas en `firestore.rules`.

La pantalla de ingreso local permite administradores con contrasena y vendedores con solo nombre. El rol vendedor solo puede guardar nichos como reservados y no puede editar nichos vendidos. Para produccion con usuarios reales conviene cambiar a Firebase Authentication con correo/contrasena o anonimo habilitado y volver a reglas `request.auth != null`; el login visual de esta pagina no reemplaza seguridad real de Firebase.

## GitHub Pages

El proyecto no requiere build. Publica desde la rama `main` con GitHub Pages:

1. Entra a `Settings > Pages`.
2. En `Build and deployment`, elige `Deploy from a branch`.
3. Selecciona rama `main` y carpeta `/root`.
4. Guarda.

## Regenerar el plano

El mapa interactivo se genera desde el DXF con:

```powershell
.\generar-vector-plano.ps1 '.\convertido-dxf\PLANO JARDIN TOP ACT 23-04-26.dxf'
```

El script toma:

- Codigos desde `NUMERO LOTE`.
- Cuadros desde `DIVISONES 2` y `DIVISIONES ADICIONALES`.
- Corrige huecos detectados por continuidad vectorial de grupo.

Archivos grandes como DWG/DXF no se suben al repo; solo se publica el vector liviano `plano-vector.js`.

## Validar

```powershell
npm run check
```
