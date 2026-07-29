/**
 * Borra recursivamente el namespace viejo de Firestore, ya migrado y
 * verificado en NEW_NAMESPACE (ver migrate-namespace.js).
 *
 * Uso: node delete-old-namespace.js
 */

const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const OLD_NAMESPACE = 'seminario-investigacion-app';

admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH))
});

const db = admin.firestore();

const stats = { docsDeleted: 0 };

async function deleteDocument(docRef) {
    const subcols = await docRef.listCollections();
    for (const subcol of subcols) {
        await deleteCollection(subcol);
    }

    const snap = await docRef.get();
    if (snap.exists) {
        await docRef.delete();
        stats.docsDeleted++;
        console.log(`  borrado: ${docRef.path}`);
    }
}

async function deleteCollection(colRef) {
    const refs = await colRef.listDocuments();
    for (const ref of refs) {
        await deleteDocument(ref);
    }
}

async function main() {
    const rootRef = db.doc(`artifacts/${OLD_NAMESPACE}`);
    console.log(`Borrando artifacts/${OLD_NAMESPACE} recursivamente...\n`);
    await deleteDocument(rootRef);

    console.log(`\nDocumentos borrados: ${stats.docsDeleted}`);

    const remainingSubcols = await rootRef.listCollections();
    console.log('Subcolecciones restantes bajo el namespace viejo:', remainingSubcols.map(c => c.id));
    process.exit(0);
}

main().catch(err => {
    console.error('Error borrando:', err);
    process.exit(1);
});
