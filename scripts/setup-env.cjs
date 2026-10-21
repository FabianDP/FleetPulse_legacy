const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes } = require('node:crypto');

function setupEnvironment(root = resolve(__dirname, '..')) {
  let contents = readFileSync(resolve(root, '.env.example'), 'utf8');
  for (const key of ['DB_PASSWORD', 'API_KEY', 'REPLAY_PASSWORD']) {
    contents = contents.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(24).toString('hex')}`);
  }
  // Exclusive creation: even a concurrent invocation cannot overwrite an existing file.
  writeFileSync(resolve(root, '.env'), contents, { flag: 'wx', mode: 0o600 });
}

if (require.main === module) {
  try {
    setupEnvironment();
    console.log('Root .env created with independent local credentials. No values printed.');
  } catch (error) {
    console.error(error.code === 'EEXIST'
      ? 'A root .env already exists; it was not read or overwritten. Review it manually.'
      : 'Could not create .env. Check the template and directory permissions.');
    process.exitCode = 1;
  }
}

module.exports = { setupEnvironment };
