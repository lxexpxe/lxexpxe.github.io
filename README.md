# Plataforma Académica - Aplicación Web

## Configuración de Firebase

Para que la aplicación funcione correctamente, necesitas crear un archivo `firebase-config.js` en la raíz del proyecto con tu configuración de Firebase:

```javascript
// firebase-config.js
window.FIREBASE_CONFIG = {
    apiKey: "tu-api-key",
    authDomain: "tu-proyecto.firebaseapp.com",
    projectId: "tu-proyecto-id",
    storageBucket: "tu-proyecto.firebasestorage.app",
    messagingSenderId: "tu-sender-id",
    appId: "tu-app-id",
    measurementId: "tu-measurement-id" // Opcional
};
```

**IMPORTANTE:** Este archivo NO debe ser subido a GitHub ya que contiene credenciales sensibles. Está incluido en `.gitignore`.

## Configuración de Firestore

Las reglas de seguridad viven en [`firestore.rules`](firestore.rules) — es la fuente
de verdad, escrita para el modelo de datos real de la app (`professors/{uid}/...`,
`courses/{id}/...`, `temp-students/{uid}`), no un diseño aparte. Para aplicarlas:
copia el contenido de `firestore.rules` en Firebase Console → tu proyecto →
Firestore Database → pestaña Reglas → Publicar.

### Probar cambios a las reglas antes de publicarlas (staging local)

No edites `firestore.rules` y publiques directo — usa el Emulator Suite de
Firebase como ambiente de staging, y el set de pruebas en
[`scripts/rules-test.js`](scripts/rules-test.js) que cubre los casos que deben
funcionar (profesor dueño de sus datos, estudiante leyendo lo suyo) y los que
deben bloquearse (un estudiante escribiéndose badges, leyendo el roster de
otro, o suplantando asistencia ajena).

Requisitos: Node 18+ y **JDK 21+** (el emulador de Firestore no corre con
versiones más viejas de Java).

```bash
cd scripts
npm install
# si tu JDK 21 no es el que resuelve `java` por defecto:
export PATH="/usr/local/opt/openjdk@21/bin:$PATH"

cd ..
./scripts/node_modules/.bin/firebase emulators:exec --only firestore "node scripts/rules-test.js"
```

Si algo falla, ajusta `firestore.rules`, vuelve a correr las pruebas, y solo
cuando pasen todas copia el archivo a Firebase Console.

## Tipos de Usuario

- **Estudiantes:** Usar correos con dominio `@icesi.edu.co`
- **Profesores:** Usar correos con dominio `@u.icesi.edu.co`

## Consola de administración de usuarios

Herramienta local (no forma parte del sitio publicado) para ver todos los
usuarios de Firebase Authentication con su nombre/rol/curso — no solo el
correo — y borrar varios a la vez, con limpieza automática de sus rastros en
Firestore. Vive en [`scripts/admin-console/`](scripts/admin-console/).

**Por qué hay un servidor de por medio (arquitectura):**
El SDK de Firebase que corre en el navegador nunca puede listar ni borrar
usuarios de Authentication — esa es una capacidad exclusiva del Admin SDK, y
las credenciales del Admin SDK (`serviceAccountKey.json`) no pueden vivir en
una página que abres en el navegador. Por eso son dos piezas:

- [`public/index.html`](scripts/admin-console/public/index.html) — la página
  que abres. Hace un login real contra Firebase Auth (mismo proyecto que la
  app) con `signInWithEmailAndPassword`, y luego habla con el servidor local
  mandando el ID token en cada petición (`Authorization: Bearer <token>`).
  No tiene ni ve el service account.
- [`server.js`](scripts/admin-console/server.js) — un servidor Express que
  corre en tu máquina (`http://127.0.0.1:4321`, solo localhost) y sí tiene el
  Admin SDK. En cada petición valida el token con
  `auth.verifyIdToken()` y revisa que el correo esté en
  `admin-emails.json` (`requireAdmin`) antes de hacer nada. Expone dos rutas:
  - `GET /api/users` — pagina todos los usuarios de Auth
    (`auth.listUsers()`) y los cruza con Firestore (`buildIdentityMap()`)
    recorriendo `professors/*/profile`, `professors/*/courses/*/students` y
    `temp-students` para resolver nombre/rol/curso de cada `uid`. Ese cruce
    se dispara en paralelo con `Promise.all` (secuencial tardaba ~7s con los
    datos reales; así queda en 1-2s).
  - `POST /api/users/delete` — recibe una lista de `uid`, y por cada uno
    aplica la limpieza de Firestore según su rol (ver abajo) antes de
    `auth.deleteUser()`.

**Qué borra según el rol del usuario:**
- **Estudiante matriculado:** su registro en cada curso (roster + badges) y
  su matrícula global.
- **Estudiante pendiente:** su solicitud en `temp-students`.
- **Profesor:** solo su perfil. A propósito **no** se tocan sus cursos —
  quedarían huérfanos, y la consola te avisa antes de confirmar.
- **Sin rastro en Firestore ("huérfano"):** solo la cuenta de Auth.

**Configuración (primera vez):**
```bash
cd scripts/admin-console
cp admin-emails.example.json admin-emails.json   # si no existe ya
# edita admin-emails.json con los correos autorizados a entrar
```
`admin-emails.json` está en `.gitignore` — nunca se sube.

**Uso:**
```bash
cd scripts
npm install
npm run admin-console
```
Abre `http://127.0.0.1:4321`, inicia sesión con un correo de la allowlist
(cuenta real de Firebase Auth de ese proyecto) y ya tienes la tabla.

Corre solo en tu máquina — usa el mismo `serviceAccountKey.json` que los
demás scripts, así que **nunca lo expongas a internet** (no hagas port
forwarding, no lo despliegues).