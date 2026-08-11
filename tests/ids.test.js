import test from "node:test";
import assert from "node:assert/strict";

import { createId } from "../js/ids.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("优先使用浏览器 randomUUID 并保留业务前缀", () => {
  const uuid = "12345678-1234-4123-8123-123456789abc";
  assert.equal(createId("org", { randomUUID: () => uuid }), `org_${uuid}`);
});

test("旧浏览器使用随机字节生成符合 UUID v4 的 ID", () => {
  let seed = 0;
  const provider = {
    getRandomValues(bytes) {
      bytes.forEach((_, index) => { bytes[index] = seed + index; });
      seed += 16;
      return bytes;
    }
  };
  const first = createId("e", provider);
  const second = createId("e", provider);

  assert.match(first.slice(2), UUID_PATTERN);
  assert.match(second.slice(2), UUID_PATTERN);
  assert.notEqual(first, second);
});

test("拒绝可能破坏存储键结构的 ID 前缀", () => {
  assert.throws(() => createId("../org", {}), /ID 前缀/);
});
