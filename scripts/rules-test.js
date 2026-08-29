/**
 * Prueba las reglas de firestore.rules contra el emulador local (staging).
 * Correr con: npx firebase emulators:exec --only firestore "node scripts/rules-test.js"
 */

const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails
} = require('@firebase/rules-unit-testing');

const NS = 'academic-platform';
let pass = 0;
let fail = 0;

async function check(name, promise, expectSuccess) {
    try {
        if (expectSuccess) {
            await assertSucceeds(promise);
        } else {
            await assertFails(promise);
        }
        console.log(`  OK   ${name}`);
        pass++;
    } catch (err) {
        console.log(`  FAIL ${name}`);
        console.log(`       ${err.message.split('\n')[0]}`);
        fail++;
    }
}

async function main() {
    const testEnv = await initializeTestEnvironment({
        projectId: 'rules-test-academic-platform',
        firestore: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8089
        }
    });

    const PROF_A = 'profA';
    const PROF_B = 'profB';
    const COURSE_A = 'courseA';
    const STUDENT_1 = 'student1';
    const STUDENT_2 = 'student2';
    const STUDENT_3_NOT_ENROLLED = 'student3';
    const TEAM_A = 'teamA';

    // --- Seed baseline data with admin (rules bypassed) ---
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc(`artifacts/${NS}/professors/${PROF_A}/profile/data`).set({ email: 'profa@icesi.edu.co', fullName: 'Profesor A' });
        await db.doc(`artifacts/${NS}/professors/${PROF_B}/profile/data`).set({ email: 'profb@icesi.edu.co', fullName: 'Profesor B' });
        await db.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}`).set({ name: 'HCI', courseCode: '#HCI', professorId: PROF_A });
        await db.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).set({ fullName: 'Estudiante 1', badgesEarned: [], studentId: STUDENT_1 });
        await db.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_2}`).set({ fullName: 'Estudiante 2', badgesEarned: [], studentId: STUDENT_2 });
        await db.doc(`artifacts/${NS}/courses/${COURSE_A}`).set({ courseName: 'Catálogo: HCI', professorId: PROF_A });
        await db.doc(`artifacts/${NS}/temp-students/otroEstudiante`).set({ email: 'x@icesi.edu.co' });
        await db.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-04`).set({
            date: '2026-08-04', courseId: COURSE_A, professorId: PROF_A,
            students: [{ studentId: STUDENT_2, studentName: 'Estudiante 2', timestamp: new Date() }]
        });
        // Simula el botón "Crear día de hoy": doc de asistencia pre-creado por
        // el profesor con students vacío, antes de que nadie escanee.
        await db.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-05`).set({
            date: '2026-08-05', courseId: COURSE_A, professorId: PROF_A, students: []
        });
        await db.doc(`artifacts/${NS}/teams/${TEAM_A}`).set({
            name: 'Equipo A', memberUids: [STUDENT_1], professorId: PROF_A, createdAt: new Date()
        });
        await db.doc(`artifacts/${NS}/progress/${TEAM_A}`).set({
            '1': { status: 'open', note: '', crystals: 0 }
        });
    });

    const profA = testEnv.authenticatedContext(PROF_A).firestore();
    const profB = testEnv.authenticatedContext(PROF_B).firestore();
    const student1 = testEnv.authenticatedContext(STUDENT_1).firestore();
    const student2 = testEnv.authenticatedContext(STUDENT_2).firestore();
    const student3 = testEnv.authenticatedContext(STUDENT_3_NOT_ENROLLED).firestore();
    const anon = testEnv.unauthenticatedContext().firestore();

    console.log('\n--- Casos que DEBEN funcionar ---');

    await check(
        'Profesor A lee su propio perfil',
        profA.doc(`artifacts/${NS}/professors/${PROF_A}/profile/data`).get(),
        true
    );

    await check(
        'Profesor A escribe en su propio curso',
        profA.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}`).update({ description: 'nuevo' }),
        true
    );

    await check(
        'Profesor A asigna badge a su estudiante',
        profA.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).update({ badgesEarned: ['b1'] }),
        true
    );

    await check(
        'Estudiante 1 lee su propio registro en el curso',
        student1.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).get(),
        true
    );

    await check(
        'Cualquier usuario autenticado puede leer un curso (búsqueda por código)',
        student2.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}`).get(),
        true
    );

    await check(
        'Búsqueda de curso por código vía collectionGroup (necesaria porque professors/{uid} suele ser un doc fantasma)',
        student2.collectionGroup('courses').where('courseCode', '==', '#HCI').get(),
        true
    );

    await check(
        'Estudiante 1 encuentra sus cursos vía collectionGroup(students).where(studentId==uid) (fix del profesor fantasma)',
        student1.collectionGroup('students').where('studentId', '==', STUDENT_1).get(),
        true
    );

    await check(
        'Estudiante 2 crea su propia solicitud pendiente (temp-students)',
        student2.doc(`artifacts/${NS}/temp-students/${STUDENT_2}`).set({ email: 's2@icesi.edu.co', courseCode: '#HCI' }),
        true
    );

    await check(
        'Profesor A (cualquier profesor) puede leer temp-students pendientes',
        profA.collection(`artifacts/${NS}/temp-students`).get(),
        true
    );

    await check(
        'Estudiante 1 se auto-registra en asistencia (primer check-in del día, incluye professorId)',
        student1.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-01`).set({
            date: '2026-08-01', courseId: COURSE_A, professorId: PROF_A,
            students: [{ studentId: STUDENT_1, studentName: 'Estudiante 1', timestamp: new Date() }]
        }),
        true
    );

    await check(
        'Estudiante 1 se auto-registra en un doc de asistencia ya creado con students=[] ("Crear día de hoy")',
        student1.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-05`).update({
            students: [{ studentId: STUDENT_1, studentName: 'Estudiante 1', timestamp: new Date() }]
        }),
        true
    );

    await check(
        'Profesor A marca asistencia manual en su curso',
        profA.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-02`).set({
            date: '2026-08-02', courseId: COURSE_A, professorId: PROF_A,
            students: [{ studentId: STUDENT_1, studentName: 'Estudiante 1', timestamp: new Date(), source: 'manual' }]
        }),
        true
    );

    await check(
        'Estudiante 1 corrige su propio fullName (único campo que cambia)',
        student1.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).update({ fullName: 'Nombre Corregido' }),
        true
    );

    await check(
        'Profesor A archiva un doc de asistencia en attendance-archive ("Nuevo Semestre")',
        profA.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance-archive/2026-08-02`).set({
            date: '2026-08-02', courseId: COURSE_A, professorId: PROF_A,
            students: [{ studentId: STUDENT_1, studentName: 'Estudiante 1', timestamp: new Date(), source: 'manual' }]
        }),
        true
    );

    await check(
        'Profesor A borra un doc de asistencia de su curso ("Nuevo Semestre")',
        profA.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-02`).delete(),
        true
    );

    await check(
        'Cualquier profesor crea un equipo de la expedición',
        profA.doc(`artifacts/${NS}/teams/otroEquipo`).set({ name: 'Otro Equipo', memberUids: [STUDENT_2], professorId: PROF_A, createdAt: new Date() }),
        true
    );

    await check(
        'Estudiante 2 (no es del equipo) puede LEER el equipo de Estudiante 1',
        student2.doc(`artifacts/${NS}/teams/${TEAM_A}`).get(),
        true
    );

    await check(
        'Estudiante 1 (miembro del equipo) envía su propio avance: status y note',
        student1.doc(`artifacts/${NS}/progress/${TEAM_A}`).update({ '1.status': 'submitted', '1.note': 'Bitácora lista' }),
        true
    );

    await check(
        'Profesor A califica el avance del equipo: crystals y status:"done"',
        profA.doc(`artifacts/${NS}/progress/${TEAM_A}`).update({ '1.status': 'done', '1.crystals': 80 }),
        true
    );

    await check(
        'Cualquier profesor publica un anuncio de la expedición',
        profA.doc(`artifacts/${NS}/announcements/annA`).set({ text: 'Nueva señal detectada', date: new Date().toISOString(), professorId: PROF_A }),
        true
    );

    console.log('\n--- Casos que DEBEN bloquearse ---');

    await check(
        'Estudiante 1 NO puede asignarse un badge a sí mismo',
        student1.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).update({ badgesEarned: ['b1', 'b2'] }),
        false
    );

    await check(
        'Estudiante 2 NO puede leer el registro de Estudiante 1',
        student2.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).get(),
        false
    );

    await check(
        'Estudiante 2 NO puede usar collectionGroup(students) para leer los cursos de Estudiante 1',
        student2.collectionGroup('students').where('studentId', '==', STUDENT_1).get(),
        false
    );

    await check(
        'Profesor B NO puede escribir en un curso de Profesor A',
        profB.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}`).update({ description: 'hackeado' }),
        false
    );

    await check(
        'Profesor B NO puede escribir en el perfil de Profesor A',
        profB.doc(`artifacts/${NS}/professors/${PROF_A}/profile/data`).update({ fullName: 'hackeado' }),
        false
    );

    await check(
        'Estudiante 2 NO puede leer la solicitud pendiente de otro estudiante',
        student2.doc(`artifacts/${NS}/temp-students/otroEstudiante`).get(),
        false
    );

    await check(
        'Estudiante 3 (no matriculado) NO puede crear asistencia fingiendo estar inscrito',
        student3.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-03`).set({
            date: '2026-08-03', courseId: COURSE_A, professorId: PROF_A,
            students: [{ studentId: STUDENT_3_NOT_ENROLLED, studentName: 'Estudiante 3', timestamp: new Date() }]
        }),
        false
    );

    await check(
        'Estudiante 1 NO puede alterar el registro de otro al "agregarse" a la asistencia',
        // Estudiante 1 intenta "agregarse" pero en realidad reemplaza el registro existente de Estudiante 2
        student1.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-04`).update({
            students: [{ studentId: STUDENT_1, studentName: 'Estudiante 1 (suplantando)', timestamp: new Date() }]
        }),
        false
    );

    await check(
        'Usuario no autenticado NO puede leer nada',
        anon.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}`).get(),
        false
    );

    await check(
        'Estudiante NO puede borrar el curso de un profesor',
        student1.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}`).delete(),
        false
    );

    await check(
        'Estudiante 2 NO puede cambiar el fullName de Estudiante 1',
        student2.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).update({ fullName: 'Suplantado' }),
        false
    );

    await check(
        'Estudiante 1 NO puede colar un cambio de badges junto con su fullName',
        student1.doc(`artifacts/${NS}/professors/${PROF_A}/courses/${COURSE_A}/students/${STUDENT_1}`).update({ fullName: 'Otro Nombre', badgesEarned: ['b1', 'b2', 'b3'] }),
        false
    );

    await check(
        'Estudiante 1 NO puede leer attendance-archive del curso',
        student1.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance-archive/2026-08-02`).get(),
        false
    );

    await check(
        'Profesor B NO puede borrar asistencia del curso de Profesor A',
        profB.doc(`artifacts/${NS}/courses/${COURSE_A}/attendance/2026-08-04`).delete(),
        false
    );

    await check(
        'Estudiante 1 NO puede asignarse crystals a sí mismo (semana aparte para no chocar con el caso ya calificado)',
        student1.doc(`artifacts/${NS}/progress/${TEAM_A}`).update({ '2.status': 'submitted', '2.crystals': 100 }),
        false
    );

    await check(
        'Estudiante 1 NO puede ponerse status:"done" a sí mismo',
        student1.doc(`artifacts/${NS}/progress/${TEAM_A}`).update({ '3.status': 'done', '3.note': 'listo' }),
        false
    );

    await check(
        'Estudiante 2 (no es del equipo) NO puede escribir el avance de Equipo A',
        student2.doc(`artifacts/${NS}/progress/${TEAM_A}`).update({ '4.status': 'submitted', '4.note': 'intento ajeno' }),
        false
    );

    await check(
        'Estudiante NO puede crear/editar equipos de la expedición',
        student1.doc(`artifacts/${NS}/teams/equipoFalso`).set({ name: 'Equipo Falso', memberUids: [STUDENT_1], professorId: PROF_A }),
        false
    );

    await check(
        'Estudiante NO puede publicar anuncios de la expedición',
        student1.doc(`artifacts/${NS}/announcements/annFalso`).set({ text: 'falso', date: new Date().toISOString(), professorId: PROF_A }),
        false
    );

    console.log(`\n${pass} pasaron, ${fail} fallaron\n`);
    await testEnv.cleanup();
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Error corriendo pruebas:', err);
    process.exit(1);
});
