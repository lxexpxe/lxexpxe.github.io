/**
 * Copia recursivamente todo el árbol de Firestore de un namespace a otro
 * dentro de `artifacts/`. NO borra el namespace de origen — es un paso
 * aditivo y seguro; el borrado se hace aparte, después de verificar.
 *
 * Uso: node migrate-namespace.js
 */

const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

const OLD_NAMESPACE = 'seminario-investigacion-app';
const NEW_NAMESPACE = 'academic-platform';

admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH))
});

const db = admin.firestore();

const stats = { docsCopied: 0, collectionsVisited: 0, phantomDocsSkipped: 0 };

async function copyDocument(sourceRef, destRef) {
    const snap = await sourceRef.get();
    if (snap.exists) {
        await destRef.set(snap.data());
        stats.docsCopied++;
        console.log(`  doc: ${sourceRef.path} -> ${destRef.path}`);
    } else {
        stats.phantomDocsSkipped++;
    }

    const subcols = await sourceRef.listCollections();
    for (const subcol of subcols) {
        await copyCollection(subcol, destRef.collection(subcol.id));
    }
}

async function copyCollection(sourceColRef, destColRef) {
    stats.collectionsVisited++;
    const refs = await sourceColRef.listDocuments();
    for (const ref of refs) {
        await copyDocument(ref, destColRef.doc(ref.id));
    }
}

async function main() {
    const sourceRoot = db.doc(`artifacts/${OLD_NAMESPACE}`);
    const destRoot = db.doc(`artifacts/${NEW_NAMESPACE}`);

    const destSnap = await destRoot.get();
    const destSubcols = await destRoot.listCollections();
    if (destSnap.exists || destSubcols.length > 0) {
        console.error(`El destino artifacts/${NEW_NAMESPACE} ya tiene datos. Abortando para no mezclar/sobrescribir.`);
        process.exit(1);
    }

    console.log(`Copiando artifacts/${OLD_NAMESPACE} -> artifacts/${NEW_NAMESPACE}\n`);
    await copyDocument(sourceRoot, destRoot);

    console.log('\nResumen:');
    console.log(`  Documentos copiados: ${stats.docsCopied}`);
    console.log(`  Documentos fantasma (sin datos, solo contenedor): ${stats.phantomDocsSkipped}`);
    console.log(`  Colecciones visitadas: ${stats.collectionsVisited}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error migrando:', err);
    process.exit(1);
});
