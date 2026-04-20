import * as THREE from "three";

/**
 * Shader-based grid: dark grey cells at block positions (mod 3 ≡ 0), light
 * grey cells at pipe positions (mod 3 ≡ 1), with light edges on each cell.
 * Two world-space basis vectors are supplied as uniforms so the same shader
 * can render the floor (TQEC X/Y) or any iso-view plane.
 */
const vertexShader = `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 axisU;
  uniform vec3 axisV;
  uniform vec3 fadeCenter;
  varying vec3 vWorldPos;
  float pmod(float a, float b) { return a - b * floor(a / b); }
  void main() {
    float tx = dot(axisU, vWorldPos);
    float ty = dot(axisV, vWorldPos);
    float mx = pmod(floor(tx), 3.0);
    float my = pmod(floor(ty), 3.0);

    bool xBlock = mx < 0.5;
    bool yBlock = my < 0.5;
    bool xPipe = mx > 0.5;
    bool yPipe = my > 0.5;

    bool isBlock = xBlock && yBlock;
    bool isPipe = (xPipe && yBlock) || (xBlock && yPipe);

    if (!isBlock && !isPipe) discard;

    float fx = fract(tx);
    float fy = fract(ty);
    float edgeWidth = 0.03;

    float edgeX, edgeY;
    if (isPipe && xPipe) {
      float px = pmod(tx, 3.0) - 1.0;
      edgeX = min(px, 2.0 - px);
    } else {
      edgeX = min(fx, 1.0 - fx);
    }
    if (isPipe && yPipe) {
      float py = pmod(ty, 3.0) - 1.0;
      edgeY = min(py, 2.0 - py);
    } else {
      edgeY = min(fy, 1.0 - fy);
    }

    float edgeDist = min(edgeX, edgeY);
    bool onEdge = edgeDist < edgeWidth;

    if (onEdge) {
      gl_FragColor = vec4(0.85, 0.85, 0.85, 0.35);
    } else if (isBlock) {
      gl_FragColor = vec4(0.45, 0.45, 0.45, 0.18);
    } else {
      gl_FragColor = vec4(0.65, 0.65, 0.65, 0.12);
    }

    // Fade by distance from center along in-plane axes only.
    vec3 d = vWorldPos - fadeCenter;
    float du = dot(axisU, d);
    float dv = dot(axisV, d);
    float dist = sqrt(du * du + dv * dv);
    float fade = 1.0 - smoothstep(100.0, 300.0, dist);
    gl_FragColor.a *= fade;
  }
`;

export function makeGridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      // World-space directions whose dot products with vWorldPos give the two
      // in-plane TQEC coordinates used for the mod-3 checkerboard.
      axisU: { value: new THREE.Vector3(1, 0, 0) },   // TQEC X
      axisV: { value: new THREE.Vector3(0, 0, -1) },  // TQEC Y
      // Center used for the distance fade (orbit target along the in-plane axes).
      fadeCenter: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader,
    fragmentShader,
  });
}
