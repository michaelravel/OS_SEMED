const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('application parses and initializes the login with isolated storage', () => {
  const app = { innerHTML: '' };
  const storage = new Map();
  let submit;
  const context = vm.createContext({
    window: {},
    document: { querySelector(selector) {
      if (selector === '#app') return app;
      if (selector === '#login-template') return { innerHTML: '<form id="login-form"></form>' };
      if (selector === '#login-form') return { addEventListener(event, callback) {
        assert.equal(event, 'submit');
        submit = callback;
      } };
      throw new Error(`Unexpected selector: ${selector}`);
    } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  vm.runInContext(source, context);
  assert.match(app.innerHTML, /login-form/);
  assert.equal(typeof submit, 'function');
  const saved = JSON.parse(storage.get('dirlogistica-os-state-v1'));
  assert.equal(saved.session, null);
  assert.equal(saved.users.length, 4);
  assert.equal(saved.users.find(user => user.id === 'u-tecnico').email, 'tecnico@dirlogistica.local');
});

test('seed JavaScript parses independently', () => {
  new vm.Script(fs.readFileSync(path.join(root, 'assets/seed-data.js'), 'utf8'));
});
