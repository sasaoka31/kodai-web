// 立体のプレビュー(WebGL2。外部ライブラリなし)。ドラッグで回す・ホイールで拡大縮小
//   const v = createSolidView(canvas); v.setSolid(solid); v.render();  v.yaw / v.pitch / v.zoom を変えて render()
//   renderSolidViews(solid, [[yaw, pitch], …], size) → 向きを変えた絵を横に並べたキャンバス(確認用・Claude 連携用)
import { createCanvas } from './document.js';

const VS = `#version 300 es
in vec3 aPos; in vec2 aUv; in vec3 aNor;
uniform mat4 uMvp; uniform mat4 uRot; uniform float uShadow; uniform float uGround;
out vec2 vUv; out vec3 vNor; out vec3 vPos;
void main() {
  // 影: 立体を地面(y = uGround)に押しつぶして、高さの分だけ右奥へずらす(左手前の上から光)
  vec3 q = aPos;
  if (uShadow > 0.5) { float h = aPos.y - uGround; q = vec3(aPos.x + h * 0.3, uGround, aPos.z - h * 0.3); }
  vUv = aUv; vNor = (uRot * vec4(aNor, 0.0)).xyz; vec4 p = uRot * vec4(q, 1.0); vPos = p.xyz; gl_Position = uMvp * vec4(q, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 vUv; in vec3 vNor; in vec3 vPos;
uniform sampler2D uTex; uniform bool uFlat; uniform bool uWire; uniform float uShadowA;
out vec4 o;
void main() {
  if (uShadowA > 0.0) { o = vec4(0.0, 0.0, 0.0, uShadowA); return; }
  vec3 n = uFlat ? normalize(cross(dFdx(vPos), dFdy(vPos))) : normalize(vNor);
  float l = 0.62 + 0.38 * max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
  vec4 c = texture(uTex, vUv);
  o = uWire ? vec4(0.0, 0.0, 0.0, 0.35) : vec4(c.rgb * l, 1.0);
}`;

// 4×4 行列(列優先)
const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const rotY = (t) => { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const rotX = (t) => { const c = Math.cos(t), s = Math.sin(t); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const trans = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const ortho = (w, h, d) => new Float32Array([2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, -1 / d, 0, 0, 0, 0, 1]);

export function createSolidView(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: true, stencil: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const loc = { pos: gl.getAttribLocation(prog, 'aPos'), uv: gl.getAttribLocation(prog, 'aUv'), nor: gl.getAttribLocation(prog, 'aNor'),
    mvp: gl.getUniformLocation(prog, 'uMvp'), rot: gl.getUniformLocation(prog, 'uRot'), flat: gl.getUniformLocation(prog, 'uFlat'), wire: gl.getUniformLocation(prog, 'uWire'),
    shadow: gl.getUniformLocation(prog, 'uShadow'), ground: gl.getUniformLocation(prog, 'uGround'), shadowA: gl.getUniformLocation(prog, 'uShadowA') };
  const vao = gl.createVertexArray();
  const bufs = { pos: gl.createBuffer(), uv: gl.createBuffer(), nor: gl.createBuffer(), idx: gl.createBuffer(), line: gl.createBuffer() };
  const tex = gl.createTexture();
  let count = 0, lineCount = 0, center = [0, 0.5, 0], radius = 1, flat = true, ground = 0;
  const view = {
    yaw: 0.5, pitch: 0.15, zoom: 1, wire: false, bg: [0.16, 0.17, 0.2, 1], shadow: false, // bg の4つ目を 0 にすると透明(書き出し用)
    // 位置だけ入れ替える(動きの再生用。向き・大きさの基準は setSolid のときのまま)
    setPositions(positions) { gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions); },
    setSolid(solid) {
      gl.bindVertexArray(vao);
      const attr = (buf, data, l, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0); } };
      attr(bufs.pos, solid.positions, loc.pos, 3); gl.bufferData(gl.ARRAY_BUFFER, solid.positions, gl.DYNAMIC_DRAW); attr(bufs.uv, solid.uvs, loc.uv, 2); attr(bufs.nor, solid.normals, loc.nor, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, solid.indices, gl.STATIC_DRAW);
      count = solid.indices.length;
      // 面のふちの線(確認用)
      const lines = new Uint32Array(count * 2);
      for (let t = 0; t < count; t += 3) { const [a, b, c] = [solid.indices[t], solid.indices[t + 1], solid.indices[t + 2]]; lines.set([a, b, b, c, c, a], t * 2); }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.line); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      lineCount = lines.length;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, solid.atlas);
      const f = solid.options.nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const { min, max } = solid.stats;
      center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
      flat = !!solid.options.flat;
      ground = min[1];
    },
    render() {
      const W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.clearColor(...view.bg); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      if (!count) return;
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      const rot = mul(rotX(view.pitch), mul(rotY(view.yaw), trans(-center[0], -center[1], -center[2])));
      const span = (radius * 2.15) / view.zoom, aspect = W / H;
      const mvp = mul(ortho(aspect >= 1 ? span * aspect : span, aspect >= 1 ? span : span / aspect, radius * 4), rot);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.mvp, false, mvp); gl.uniformMatrix4fv(loc.rot, false, rot);
      gl.uniform1i(loc.flat, flat ? 1 : 0); gl.uniform1i(loc.wire, 0);
      gl.uniform1f(loc.shadow, 0); gl.uniform1f(loc.shadowA, 0); gl.uniform1f(loc.ground, ground);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
      if (view.shadow) {
        // 地面の影: 同じ所を2回塗らないようにステンシルで1回だけ。立体より先に描く
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // 色は黒なので、透明な背景でもそのまま重ねられる
        gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
        gl.uniform1f(loc.shadow, 1); gl.uniform1f(loc.shadowA, 0.3);
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
        gl.uniform1f(loc.shadow, 0); gl.uniform1f(loc.shadowA, 0);
        gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      }
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      if (view.wire) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1i(loc.wire, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.line);
        gl.drawElements(gl.LINES, lineCount, gl.UNSIGNED_INT, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  return view;
}

// 向きを変えた絵を横に並べる。views = [[yaw(ラジアン), pitch], …]
export function renderSolidViews(solid, views = [[0, 0.1], [0.8, 0.15], [Math.PI / 2, 0.1], [Math.PI, 0.1]], size = 256, { wire = false } = {}) {
  const gc = createCanvas(size, size);
  const v = createSolidView(gc);
  if (!v) throw new Error('この環境では 3D の表示(WebGL2)が使えません');
  v.setSolid(solid);
  v.wire = wire;
  const out = createCanvas(size * views.length, size), ox = out.getContext('2d');
  views.forEach(([yaw, pitch], i) => { v.yaw = yaw; v.pitch = pitch; v.render(); ox.drawImage(gc, i * size, 0); });
  v.dispose();
  return out;
}
