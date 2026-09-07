// Compila index.html (la fuente que se edita en main: JSX inline + Tailwind
// vía CDN, pensada para poder abrirse y probarse tal cual, sin build) a la
// versión que de verdad se publica en gh-pages: JSX ya transformado a JS
// plano y el CSS de Tailwind generado una sola vez en el build, en vez de
// que cada visitante tenga que descargar Babel/Tailwind y hacerlo en su
// propio navegador. No cambia qué se edita ni cómo — index.html sigue
// siendo el único archivo fuente.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '..');
const SOURCE_HTML = path.join(ROOT, 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function generateTailwindCss() {
    const output = execFileSync(
        path.join(__dirname, 'node_modules', '.bin', 'tailwindcss'),
        ['-i', path.join(__dirname, 'tailwind-input.css'), '-c', path.join(__dirname, 'tailwind.config.js'), '--minify'],
        { encoding: 'utf8' }
    );
    return output;
}

function compileJsx(jsxCode) {
    const result = babel.transform(jsxCode, {
        presets: [['@babel/preset-react', { runtime: 'classic' }]],
        filename: 'app.jsx',
    });
    return result.code;
}

function build() {
    const html = fs.readFileSync(SOURCE_HTML, 'utf8');

    if (!html.includes('<script src="https://cdn.tailwindcss.com"></script>')) {
        throw new Error('No se encontró el <script> del CDN de Tailwind en index.html — el HTML fuente cambió de forma inesperada, revisar el script de build.');
    }
    if (!html.includes('<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>')) {
        throw new Error('No se encontró el <script> de Babel standalone en index.html — el HTML fuente cambió de forma inesperada, revisar el script de build.');
    }

    const jsxMatch = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
    if (!jsxMatch) {
        throw new Error('No se encontró el bloque <script type="text/babel"> en index.html.');
    }

    console.log('Generando CSS de Tailwind (escaneando index.html)...');
    const css = generateTailwindCss();
    console.log(`  -> ${css.length} bytes de CSS generado.`);

    console.log('Compilando JSX a JS plano (runtime classic, sin imports)...');
    const compiledJs = compileJsx(jsxMatch[1]);
    console.log(`  -> ${compiledJs.length} bytes de JS compilado.`);

    let finalHtml = html
        .replace('<script src="https://cdn.tailwindcss.com"></script>', `<style>${css}</style>`)
        .replace('<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>\n    ', '')
        .replace(jsxMatch[0], `<script>${compiledJs}</script>`);

    if (finalHtml.includes('text/babel') || finalHtml.includes('babel.min.js') || finalHtml.includes('cdn.tailwindcss.com')) {
        throw new Error('El HTML final todavía contiene referencias a Babel standalone o al CDN de Tailwind — el reemplazo falló.');
    }

    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(DIST_HTML, finalHtml);

    // assets/expedition-map-bg.png se referencia con ruta relativa desde el
    // mapa de misiones de Expedición — sin copiar la carpeta, esa imagen
    // quedaría rota en el sitio publicado.
    const assetsDir = path.join(ROOT, 'assets');
    if (fs.existsSync(assetsDir)) {
        fs.cpSync(assetsDir, path.join(DIST_DIR, 'assets'), { recursive: true });
        console.log('Copiado assets/ a dist/assets/.');
    }

    // Le dice a GitHub Pages que no procese esto con Jekyll (que por defecto
    // ignora/renombra archivos y carpetas que empiezan con "_", entre otras
    // cosas) — se sirve tal cual, como ya pasa hoy publicando desde main.
    fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '');

    console.log(`\nListo: ${DIST_HTML} (${finalHtml.length} bytes)`);
}

build();
