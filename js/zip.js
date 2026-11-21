/* my-handwriting - minimal ZIP writer (files stored without compression, UTF-8 names).
 * Used to build the Claude skill package in the browser. Works in node too (tests). */
(function () {
  'use strict';
  var TABLE = null;
  function crc32(bytes) {
    if (!TABLE) {
      TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
             date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }

  /** files: [{name: 'folder/file.txt', data: string | Uint8Array}] -> Uint8Array (a .zip file) */
  function build(files, when) {
    var t = dosTime(when || new Date()), parts = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    files.forEach(function (f) {
      var name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(t.time), u16(t.date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      parts.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    var all = parts.concat(central, [end]), size = all.reduce(function (n, p) { return n + p.length; }, 0);
    var out = new Uint8Array(size), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  var api = { build: build, crc32: crc32 };
  if (typeof window !== 'undefined') window.Zip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
