import test from 'node:test';
import assert from 'node:assert/strict';
import { focusAnswerInput } from '../src/question-focus.mjs';

test('focusAnswerInput clicks the first visible answer target in priority order', async () => {
  const clicked = [];
  const page = createFakePage({
    namedTextbox: createFakeLocator({ count: 0, clicked }),
    contentEditableTextbox: createFakeLocator({ count: 1, visible: true, clicked, name: 'contentEditableTextbox' }),
    textarea: createFakeLocator({ count: 1, visible: true, clicked, name: 'textarea' }),
    input: createFakeLocator({ count: 1, visible: true, clicked, name: 'input' }),
  });

  const focused = await focusAnswerInput(page);

  assert.equal(focused, true);
  assert.deepEqual(clicked, ['contentEditableTextbox']);
});

test('focusAnswerInput skips hidden matches and falls back to the next visible input', async () => {
  const clicked = [];
  const page = createFakePage({
    namedTextbox: createFakeLocator({ count: 1, visible: false, clicked, name: 'namedTextbox' }),
    contentEditableTextbox: createFakeLocator({ count: 1, visible: false, clicked, name: 'contentEditableTextbox' }),
    textarea: createFakeLocator({ count: 1, visible: true, clicked, name: 'textarea' }),
    input: createFakeLocator({ count: 1, visible: true, clicked, name: 'input' }),
  });

  const focused = await focusAnswerInput(page);

  assert.equal(focused, true);
  assert.deepEqual(clicked, ['textarea']);
});

test('focusAnswerInput returns false when no visible input exists', async () => {
  const clicked = [];
  const page = createFakePage({
    namedTextbox: createFakeLocator({ count: 0, clicked }),
    contentEditableTextbox: createFakeLocator({ count: 0, clicked }),
    textarea: createFakeLocator({ count: 0, clicked }),
    input: createFakeLocator({ count: 0, clicked }),
  });

  const focused = await focusAnswerInput(page);

  assert.equal(focused, false);
  assert.deepEqual(clicked, []);
});

function createFakePage(locators) {
  return {
    getByRole(role, options) {
      if (role === 'textbox' && options?.name) {
        return locators.namedTextbox;
      }
      throw new Error(`Unexpected getByRole(${role}) call`);
    },
    locator(selector) {
      if (selector === '[role="textbox"][contenteditable="true"]') {
        return locators.contentEditableTextbox;
      }
      if (selector === 'textarea') {
        return locators.textarea;
      }
      if (selector === 'input:not([type]), input[type="text"], input[type="search"]') {
        return locators.input;
      }
      throw new Error(`Unexpected locator(${selector}) call`);
    },
  };
}

function createFakeLocator({ count = 0, visible = false, clicked, name = 'unknown' }) {
  return {
    first() {
      return this;
    },
    async count() {
      return count;
    },
    async isVisible() {
      return visible;
    },
    async scrollIntoViewIfNeeded() {},
    async click() {
      clicked.push(name);
    },
  };
}
