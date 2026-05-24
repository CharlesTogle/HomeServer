import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFileFixture,
  createFolderFixture,
  createUserFixture,
} from './support/faker.js';

test('createFolderFixture returns a typed folder fixture', () => {
  const folderFixture = createFolderFixture();

  assert.notEqual(folderFixture.name.length, 0);
});

test('createUserFixture returns a typed user fixture', () => {
  const userFixture = createUserFixture();

  assert.match(userFixture.email, /@/u);
  assert.notEqual(userFixture.password.length, 0);
});

test('createFileFixture returns a typed file fixture', () => {
  const fileFixture = createFileFixture();

  assert.match(fileFixture.name, /\.jpg$/u);
  assert.notEqual(fileFixture.contents.length, 0);
});
