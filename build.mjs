import {readFile, writeFile} from 'node:fs/promises';

const file = name => new URL(name, import.meta.url);
const [page, style, model, map, app, leafletCss, leafletJs, leafletLicense, cover] = await Promise.all(
  ['page.html', 'styles.css', 'model.js', 'map.js', 'app.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/LICENSE'].map(name => readFile(file(name), 'utf8'))
    .concat(readFile(file('campus-commute.webp')))
);
const html = page.replace('/* STYLE */', () => style)
  .replace('/* LEAFLET_CSS */', () => leafletCss)
  .replace('/* LEAFLET_JS */', () => `/*\n${leafletLicense.trim()}\n*/\n${leafletJs.replace(/^\/\/# sourceMappingURL=.*$/m, '')}`)
  .replace('/* MODEL */', () => model).replace('/* MAP */', () => map).replace('/* APP */', () => app)
  .replace('/* COVER */', () => `data:image/webp;base64,${cover.toString('base64')}`);

await writeFile(file('index.html'), html.replace(/\r\n/g, '\n'));
