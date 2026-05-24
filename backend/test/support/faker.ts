import { Faker, en } from '@faker-js/faker';

export const testFaker = new Faker({
  locale: [en],
  seed: [20260524],
});

export interface FolderFixture {
  name: string;
}

export interface FileFixture {
  contents: string;
  mimeType: string;
  name: string;
}

export interface UserFixture {
  email: string;
  password: string;
}

export function createFolderFixture(): FolderFixture {
  return {
    name: testFaker.lorem.slug(2),
  };
}

export function createFileFixture(): FileFixture {
  return {
    contents: testFaker.lorem.paragraph(),
    mimeType: 'image/jpeg',
    name: `${testFaker.lorem.slug(2)}.jpg`,
  };
}

export function createUserFixture(): UserFixture {
  return {
    email: testFaker.internet.email().toLowerCase(),
    password: `Password-${testFaker.string.alphanumeric(12)}`,
  };
}
