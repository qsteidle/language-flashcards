// Guard: no native-submitting <form> in the markup. Forms cause page
// navigation; this app handles everything in JS. A <form> is only allowed
// if it carries an explicit onsubmit="return false" or is absent entirely.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8').catch(() => '');

const formTags = html.match(/<form[^>]*>/gi) || [];
const bad = formTags.filter((tag) => !/onsubmit\s*=\s*["']return false/i.test(tag));

if (bad.length) {
  console.error('Found <form> tag(s) without onsubmit="return false" in index.html:');
  for (const t of bad) console.error('  ' + t);
  console.error('Use JS event handlers instead of native form submission.');
  process.exit(1);
}
console.log(`OK: no native-submit <form> tags in ${ROOT.replace(/\\/g, '/')}index.html`);
