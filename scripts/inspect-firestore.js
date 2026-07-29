/**
 * Inspecciona la estructura de Firestore (colecciones, subcolecciones y forma
 * de los documentos) sin exponer datos reales de usuarios.
 *
 * Uso:
 *   1. npm install
 *   2. Coloca tu service account key como scripts/serviceAccountKey.json
 *      (Firebase Console > Project settings > Service accounts > Generate new private key)
 *   3. node inspect-firestore.js
 *
 * Salida: scripts/firestore-structure.json (solo tipos/formas, no valores reales)
 * y un resumen en consola.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const OUTPUT_PATH = path.join(__dirname, 'firestore-structure.json');

const MAX_SAMPLE_DOCS = 5; // cuántos documentos muestrear por colección
const MAX_DEPTH = 12; // límite de recursión por seguridad

if (!fs.existsSync(KEY_PATH)) {
    console.error(`No se encontró ${KEY_PATH}.`);
    console.error('Genera una service account key en Firebase Console > Project settings > Service accounts');
    console.error('y guárdala como scripts/serviceAccountKey.json (ya está en .gitignore, no la commitees).');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH))
});

const db = admin.firestore();

function describeValue(value) {
    if (value === null) return 'null';
    if (value instanceof admin.firestore.Timestamp) return 'timestamp';
    if (value instanceof admin.firestore.GeoPoint) return 'geopoint';
    if (value instanceof admin.firestore.DocumentReference) return `reference(${value.path})`;
    if (Array.isArray(value)) {
        if (value.length === 0) return 'array(empty)';
        return { arrayLength: value.length, itemShape: describeValue(value[0]) };
    }
    if (typeof value === 'object') {
        return describeFields(value);
    }
    return typeof value; // string | number | boolean
}

function describeFields(obj) {
    const shape = {};
    for (const [key, val] of Object.entries(obj)) {
        shape[key] = describeValue(val);
    }
    return shape;
}

// Combina las "formas" de varios documentos muestreados en un único esquema,
// listando los tipos vistos por campo (útil si los docs no son homogéneos).
function mergeShapes(shapes) {
    const merged = {};
    for (const shape of shapes) {
        for (const [key, type] of Object.entries(shape)) {
            if (!merged[key]) merged[key] = new Set();
            merged[key].add(typeof type === 'object' ? JSON.stringify(type) : type);
        }
    }
    const result = {};
    for (const [key, typeSet] of Object.entries(merged)) {
        const types = [...typeSet];
        result[key] = types.length === 1 ? safeParseJSON(types[0]) : types.map(safeParseJSON);
    }
    return result;
}

function safeParseJSON(str) {
    if (typeof str !== 'string') return str;
    try {
        return JSON.parse(str);
    } catch {
        return str;
    }
}

async function exploreCollection(collectionRef, depth) {
    if (depth > MAX_DEPTH) return { truncated: true };

    const countSnap = await collectionRef.count().get();
    const totalDocsWithData = countSnap.data().count;

    // listDocuments() finds ALL doc refs, including "phantom" documents that
    // only exist as containers for subcollections (never had .set() called on
    // them directly) — a query .get() would silently skip those.
    const allRefs = await collectionRef.listDocuments();
    const sampleRefs = allRefs.slice(0, MAX_SAMPLE_DOCS);

    const shapes = [];
    let phantomCount = 0;
    for (const ref of sampleRefs) {
        const snap = await ref.get();
        if (snap.exists) {
            shapes.push(describeFields(snap.data()));
        } else {
            phantomCount++;
        }
    }
    const fieldSchema = mergeShapes(shapes);

    // Group subcollection refs by name across ALL sampled parent docs, then
    // explore + merge each group. A name can repeat under multiple parents
    // (e.g. every professor doc has its own "courses" subcollection) — only
    // exploring the first one found would silently drop the rest.
    const subcolRefsByName = {};
    for (const ref of sampleRefs) {
        const subcols = await ref.listCollections();
        for (const subcol of subcols) {
            (subcolRefsByName[subcol.id] ??= []).push(subcol);
        }
    }

    const subcollections = {};
    for (const [name, refs] of Object.entries(subcolRefsByName)) {
        const explorations = [];
        for (const ref of refs) {
            explorations.push(await exploreCollection(ref, depth + 1));
        }
        subcollections[name] = mergeExplorations(explorations);
    }

    return {
        totalDocsWithData,
        totalDocRefs: allRefs.length,
        phantomDocsInSample: phantomCount,
        sampledDocs: sampleRefs.length,
        exampleDocIds: sampleRefs.slice(0, 3).map(d => d.id),
        fieldSchema,
        subcollections
    };
}

function mergeExplorations(explorations) {
    if (explorations.length === 1) return explorations[0];

    const merged = {
        totalDocsWithData: 0,
        totalDocRefs: 0,
        phantomDocsInSample: 0,
        sampledDocs: 0,
        exampleDocIds: [],
        fieldSchema: {},
        subcollections: {},
        mergedFromParentDocs: explorations.length
    };

    const fieldShapes = [];
    const subcolGroups = {};
    for (const exp of explorations) {
        merged.totalDocsWithData += exp.totalDocsWithData || 0;
        merged.totalDocRefs += exp.totalDocRefs || 0;
        merged.phantomDocsInSample += exp.phantomDocsInSample || 0;
        merged.sampledDocs += exp.sampledDocs || 0;
        merged.exampleDocIds.push(...(exp.exampleDocIds || []));
        fieldShapes.push(exp.fieldSchema || {});
        for (const [subName, subExp] of Object.entries(exp.subcollections || {})) {
            (subcolGroups[subName] ??= []).push(subExp);
        }
    }

    merged.exampleDocIds = merged.exampleDocIds.slice(0, 3);
    merged.fieldSchema = mergeShapes(fieldShapes);
    for (const [subName, subExpList] of Object.entries(subcolGroups)) {
        merged.subcollections[subName] = mergeExplorations(subExpList);
    }

    return merged;
}

async function main() {
    console.log('Explorando Firestore...\n');

    const rootCollections = await db.listCollections();
    const structure = {};

    for (const col of rootCollections) {
        console.log(`Colección raíz: ${col.id}`);
        structure[col.id] = await exploreCollection(col, 0);
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(structure, null, 2));
    console.log(`\nEstructura guardada en ${OUTPUT_PATH}`);
    console.log('Revisa el archivo: solo debería contener nombres de colecciones/campos y tipos, no valores reales.');
    console.log('Compártelo (contenido o ruta) para el análisis.');

    process.exit(0);
}

main().catch(err => {
    console.error('Error explorando Firestore:', err);
    process.exit(1);
});
