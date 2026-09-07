// Escanea el index.html real (la fuente que se edita en main) para generar
// solo las clases de Tailwind que de verdad se usan — equivalente a lo que
// hace el CDN en el navegador, pero calculado una vez en el build, no en
// cada carga de página de cada estudiante/profesor.
module.exports = {
  content: ['../index.html'],
  theme: {
    extend: {},
  },
  plugins: [],
};
