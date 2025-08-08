# Seminario de Investigación - Aplicación Web

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

Aplica las siguientes reglas de seguridad en tu consola de Firebase:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Reglas para usuarios
    match /artifacts/seminario-investigacion-app/users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // Permitir que profesores lean todos los usuarios
      allow read: if request.auth != null && 
        exists(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)).data.userType == 'professor';
      
      // Permitir que profesores actualicen badges de estudiantes de su curso
      allow update: if request.auth != null && 
        exists(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)).data.userType == 'professor' &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['badgesEarned', 'lastBadgeEarned', 'badgeStatus']);
      
      // Permitir que profesores eliminen estudiantes
      allow delete: if request.auth != null && 
        exists(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)).data.userType == 'professor';
    }
    
    // Reglas para cursos
    match /artifacts/seminario-investigacion-app/courses/{courseId} {
      // Profesores pueden leer/escribir sus propios cursos
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.professorId;
      
      // Profesores pueden crear cursos
      allow create: if request.auth != null && 
        request.auth.uid == request.resource.data.professorId;
      
      // Estudiantes pueden leer cursos de su código
      allow read: if request.auth != null && 
        exists(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/artifacts/seminario-investigacion-app/users/$(request.auth.uid)).data.courseCode == resource.data.courseCode;
    }
  }
}
```

## Tipos de Usuario

- **Estudiantes:** Usar correos con dominio `@icesi.edu.co`
- **Profesores:** Usar correos con dominio `@u.icesi.edu.co`