// Themes for the 3D world. The interface (HTML) themes live in css/themes.css and are independent.

export const DIM = {
  BELT_Z0: 34, // gap between the board and the belt
  BELT_DEPTH: 96,
  BELT_THICK: 20,
  CARGO_Z0: 37,
  CARGO_DEPTH: 90,
  CARGO_BASE: 14,
};

export const WORLD_THEMES = {
  arcane: {
    name: 'Arcane Lab',
    background: 0x0a0e13, fog: 0x0a0e13, fogNear: 2600, fogFar: 9000,
    board: 0x232b35, boardHole: 0x06080b, boardLine: 0x39444f,
    metal: 0x3a434e, metalLight: 0x7d8a99, belt: 0x161a20, plastic: 0x3b4552, cargo: 0x66717f,
    plate: 0xaab4c0, glass: 0xbfd8e6,
    accent: 0x35e6ff, accent2: 0xf2b84b, warn: 0xff3b68, ok: 0x55f0a0, ghost: 0xb48cff,
    sky: 0x9fc4dc, ground: 0x1c1410, key: 0xfff1dc, fill: 0x35e6ff,
    bloom: { strength: 0.62, radius: 0.55, threshold: 1.0 }, exposure: 1.05, dark: true,
  },
  neon: {
    name: 'Neon Noir',
    background: 0x0b0714, fog: 0x0b0714, fogNear: 2400, fogFar: 8500,
    board: 0x241c34, boardHole: 0x07050c, boardLine: 0x3b3052,
    metal: 0x3a3150, metalLight: 0x82789b, belt: 0x17121f, plastic: 0x3f3554, cargo: 0x6a6084,
    plate: 0xb3a9c9, glass: 0xd9c8f0,
    accent: 0xff2fd0, accent2: 0xf9f002, warn: 0xff4b3a, ok: 0x29ffc6, ghost: 0x4de1ff,
    sky: 0xc3a6ff, ground: 0x190b1c, key: 0xffe6fb, fill: 0xff2fd0,
    bloom: { strength: 0.8, radius: 0.65, threshold: 1.0 }, exposure: 1.05, dark: true,
  },
  undercity: {
    name: 'Undercity',
    background: 0x0b0d09, fog: 0x0b0d09, fogNear: 2400, fogFar: 8500,
    board: 0x2b3023, boardHole: 0x080906, boardLine: 0x444a36,
    metal: 0x45483a, metalLight: 0x8c8b72, belt: 0x191a13, plastic: 0x484b3b, cargo: 0x74755d,
    plate: 0xb9b99f, glass: 0xdfe6c2,
    accent: 0x9cff2f, accent2: 0xff8a1f, warn: 0xff3d3d, ok: 0x9cff2f, ghost: 0x4fe0c0,
    sky: 0xcbd6a0, ground: 0x1c1408, key: 0xfff0c9, fill: 0x9cff2f,
    bloom: { strength: 0.6, radius: 0.5, threshold: 1.0 }, exposure: 1.0, dark: true,
  },
  cleanroom: {
    name: 'Clean Room',
    background: 0xc9d1d8, fog: 0xc9d1d8, fogNear: 3500, fogFar: 11000,
    board: 0xdfe4e8, boardHole: 0x6f7c88, boardLine: 0xb4bec7,
    metal: 0x8e9aa6, metalLight: 0xc5ced6, belt: 0x2e363f, plastic: 0x6c7885, cargo: 0xaab4be,
    plate: 0xf2f5f7, glass: 0x9fc3d6,
    accent: 0x0a7cff, accent2: 0xff6a00, warn: 0xe5143c, ok: 0x0aa864, ghost: 0x7a3cff,
    sky: 0xffffff, ground: 0xb9c2cb, key: 0xffffff, fill: 0xbfe0ff,
    bloom: { strength: 0.1, radius: 0.3, threshold: 1.0 }, exposure: 0.92, dark: false,
    light: { hemi: 0.95, key: 1.5, fill: 0.2 },
  },
};

export const themeOf = (name) => WORLD_THEMES[name] || WORLD_THEMES.arcane;
