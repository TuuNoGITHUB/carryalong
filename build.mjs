import {readFile, writeFile} from 'node:fs/promises';

const file = name => new URL(name, import.meta.url);
const [page, style, model, app, cover] = await Promise.all(
  ['page.html', 'styles.css', 'model.js', 'app.js'].map(name => readFile(file(name), 'utf8'))
    .concat(readFile(file('campus-commute.webp')))
);
const html = page.replace('/* STYLE */', () => style)
  .replace('/* MODEL */', () => model).replace('/* APP */', () => app)
  .replace('/* COVER */', () => `data:image/webp;base64,${cover.toString('base64')}`);

await writeFile(file('index.html'), html);
