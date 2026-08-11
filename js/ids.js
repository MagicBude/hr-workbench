/*
 * ids.js — 浏览器端业务 ID 生成
 *
 * 输入：业务前缀，以及可选的 Web Crypto 实现（测试和旧浏览器兼容时使用）。
 * 输出：`前缀_UUID` 形式的低碰撞标识。
 * 协作：员工、组织和快照统一从这里取 ID；导入数据仍由 domain.js 校验唯一性。
 *
 * ID 只用于标识和关联，不承担鉴权或保密职责。优先使用 randomUUID；旧环境退回到
 * UUID v4 字节生成。极旧环境没有 Web Crypto 时才使用 Math.random，以保证功能可用。
 */

function uuidFromBytes(bytes) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID v4 版本位
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 变体位
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function createId(prefix, cryptoProvider = globalThis.crypto) {
  if (!/^[a-z][a-z0-9]*$/i.test(prefix)) throw new TypeError("ID 前缀只能包含字母和数字");
  if (typeof cryptoProvider?.randomUUID === "function") return `${prefix}_${cryptoProvider.randomUUID()}`;

  const bytes = new Uint8Array(16);
  if (typeof cryptoProvider?.getRandomValues === "function") {
    cryptoProvider.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `${prefix}_${uuidFromBytes(bytes)}`;
}
