/**
 * Consola local de administración de usuarios (Firebase Authentication +
 * limpieza de sus rastros en Firestore). Corre SOLO en tu máquina — usa el
 * service account (Admin SDK), así que nunca debe exponerse a internet.
 *
 * Uso: node server.js   (ver README.md para más detalle)
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'serviceAccountKey.json');
const ADMIN_EMAILS_PATH = path.join(__dirname, 'admin-emails.json');
const NS = 'academic-platform';
const PORT = process.env.PORT || 4321;

if (!fs.existsSync(KEY_PATH)) {
    console.error(`No se encontró ${KEY_PATH}. Ver scripts/README (o el README principal) para generarla.`);
    process.exit(1);
}

if (!fs.existsSync(ADMIN_EMAILS_PATH)) {
    console.error(`No se encontró ${ADMIN_EMAILS_PATH}.`);
    console.error('Crea ese archivo con tu(s) correo(s) autorizados, por ejemplo:');
    console.error('  ["tu.correo@u.icesi.edu.co"]');
    process.exit(1);
}

const ADMIN_EMAILS = new Set(JSON.parse(fs.readFileSync(ADMIN_EMAILS_PATH, 'utf8')));
if (ADMIN_EMAILS.size === 0) {
    console.error(`${ADMIN_EMAILS_PATH} está vacío — agrega al menos un correo autorizado.`);
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();
const auth = admin.auth();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Falta token' });

    try {
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.email || !ADMIN_EMAILS.has(decoded.email)) {
            return res.status(403).json({ error: `${decoded.email || '(sin email)'} no está en la lista de administradores` });
        }
        req.adminEmail = decoded.email;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token inválido: ' + err.message });
    }
}

// --- Resolución de identidad: cruza cada uid de Auth con sus rastros en Firestore ---

async function buildIdentityMap() {
    // uid -> { role, fullName, courses: [{courseId, courseName, professorId, professorName}] }
    const map = new Map();

    // Todo lo que no depende de una llamada previa se dispara en paralelo
    // (Promise.all) en vez de recorrer secuencialmente — con datos reales
    // (varios profesores x cursos x estudiantes) la versión secuencial
    // tardaba ~7s; esto la deja en un par de segundos.
    const professorRefs = await db.collection(`artifacts/${NS}/professors`).listDocuments();

    await Promise.all(professorRefs.map(async (profRef) => {
        const profId = profRef.id;
        const [profileSnap, courseRefs] = await Promise.all([
            profRef.collection('profile').doc('data').get(),
            profRef.collection('courses').listDocuments()
        ]);

        if (profileSnap.exists) {
            map.set(profId, {
                role: 'profesor',
                fullName: profileSnap.data().fullName || '(sin nombre)',
                courses: []
            });
        }
        const profFullName = map.get(profId)?.fullName || profId;

        await Promise.all(courseRefs.map(async (courseRef) => {
            const [courseSnap, studentRefs] = await Promise.all([
                courseRef.get(),
                courseRef.collection('students').listDocuments()
            ]);
            const courseName = courseSnap.exists ? (courseSnap.data().name || courseRef.id) : courseRef.id;

            if (map.has(profId)) {
                map.get(profId).courses.push({ courseId: courseRef.id, courseName });
            }

            const studentSnaps = await Promise.all(studentRefs.map(ref => ref.get()));
            for (const studentSnap of studentSnaps) {
                if (!studentSnap.exists) continue;
                const sData = studentSnap.data();
                const uid = studentSnap.id;

                if (!map.has(uid)) {
                    map.set(uid, { role: 'estudiante', fullName: sData.fullName || '(sin nombre)', courses: [] });
                }
                map.get(uid).courses.push({
                    courseId: courseRef.id,
                    courseName,
                    professorId: profId,
                    professorName: profFullName
                });
            }
        }));
    }));

    const tempRefs = await db.collection(`artifacts/${NS}/temp-students`).listDocuments();
    const tempSnaps = await Promise.all(tempRefs.map(ref => ref.get()));
    for (const snap of tempSnaps) {
        if (!snap.exists) continue;
        const uid = snap.id;
        const data = snap.data();
        if (!map.has(uid)) {
            map.set(uid, { role: 'estudiante (pendiente)', fullName: data.fullName || '(sin nombre)', courses: [] });
        } else {
            map.get(uid).pending = true;
        }
        map.get(uid).pendingCourseCode = data.courseCode || null;
    }

    return map;
}

app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const identityMap = await buildIdentityMap();
        const users = [];
        let pageToken;
        do {
            const page = await auth.listUsers(1000, pageToken);
            for (const u of page.users) {
                const identity = identityMap.get(u.uid);
                users.push({
                    uid: u.uid,
                    email: u.email,
                    emailVerified: u.emailVerified,
                    disabled: u.disabled,
                    creationTime: u.metadata.creationTime,
                    lastSignInTime: u.metadata.lastSignInTime,
                    role: identity ? identity.role : 'sin rastro en Firestore',
                    fullName: identity ? identity.fullName : null,
                    courses: identity ? identity.courses : [],
                    pending: identity ? !!identity.pending || identity.role === 'estudiante (pendiente)' : false,
                    pendingCourseCode: identity ? identity.pendingCourseCode || null : null
                });
            }
            pageToken = page.pageToken;
        } while (pageToken);

        res.json({ users, adminEmail: req.adminEmail });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users/delete', requireAdmin, async (req, res) => {
    const uids = Array.isArray(req.body.uids) ? req.body.uids : [];
    if (uids.length === 0) return res.status(400).json({ error: 'uids vacío' });

    const identityMap = await buildIdentityMap();
    const results = [];

    for (const uid of uids) {
        const cleaned = [];
        try {
            const identity = identityMap.get(uid);

            if (identity) {
                if (identity.role === 'profesor') {
                    // Deliberadamente conservador: solo se borra el perfil del
                    // profesor, NUNCA sus cursos/estudiantes/asistencia — eso
                    // sería un borrado en cascada demasiado grande para una
                    // herramienta de limpieza masiva. Quedan huérfanos a propósito.
                    await db.doc(`artifacts/${NS}/professors/${uid}/profile/data`).delete();
                    cleaned.push('perfil de profesor');
                    if (identity.courses.length > 0) {
                        cleaned.push(`⚠ NO se tocaron sus ${identity.courses.length} curso(s) — quedan huérfanos`);
                    }
                } else {
                    // Estudiante: sí se limpia en cascada (roster + enrollments
                    // de cada curso en el que estaba, más su solicitud pendiente).
                    for (const c of identity.courses) {
                        await db.doc(`artifacts/${NS}/professors/${c.professorId}/courses/${c.courseId}/students/${uid}`).delete();
                        await db.doc(`artifacts/${NS}/courses/${c.courseId}/enrollments/${uid}`).delete();
                        cleaned.push(`registro en curso "${c.courseName}"`);
                    }
                }

                const tempSnap = await db.doc(`artifacts/${NS}/temp-students/${uid}`).get();
                if (tempSnap.exists) {
                    await db.doc(`artifacts/${NS}/temp-students/${uid}`).delete();
                    cleaned.push('solicitud pendiente');
                }
            }

            await auth.deleteUser(uid);
            results.push({ uid, ok: true, cleaned });
        } catch (err) {
            results.push({ uid, ok: false, error: err.message, cleaned });
        }
    }

    res.json({ results });
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(`Consola de administración en http://127.0.0.1:${PORT}`);
    console.log(`Admins autorizados: ${[...ADMIN_EMAILS].join(', ')}`);
});
