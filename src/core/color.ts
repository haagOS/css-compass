/** RGBA with channels 0–1, like `vscode.Color`. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

// CSS named colours (CSS Color 4), hex without `#`.
const NAMED: Record<string, string> = Object.fromEntries(
  (
    "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc " +
    "bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a " +
    "burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 " +
    "cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b " +
    "darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 " +
    "darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 " +
    "darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b " +
    "darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 " +
    "deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff " +
    "firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc " +
    "ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f " +
    "grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 " +
    "khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd " +
    "lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 " +
    "lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a " +
    "lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 " +
    "lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 " +
    "magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 " +
    "mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a " +
    "mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa " +
    "mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 " +
    "olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa " +
    "palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 " +
    "peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 " +
    "rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 " +
    "salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 " +
    "skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa " +
    "springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 " +
    "turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 " +
    "yellowgreen:9acd32"
  )
    .split(" ")
    .map((pair) => pair.split(":") as [string, string]),
);

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const byte = (n: number) => Math.round(n * 255);

function fromHex(hex: string): Rgba | undefined {
  if (!/^[0-9a-f]+$/i.test(hex)) return undefined;
  const short = hex.length === 3 || hex.length === 4;
  if (!short && hex.length !== 6 && hex.length !== 8) return undefined;
  const channel = (i: number) => {
    const s = short ? (hex[i] ?? "0").repeat(2) : hex.slice(i * 2, i * 2 + 2);
    return Number.parseInt(s, 16) / 255;
  };
  const hasAlpha = hex.length === 4 || hex.length === 8;
  return { r: channel(0), g: channel(1), b: channel(2), a: hasAlpha ? channel(3) : 1 };
}

/** A number or percentage; `scale` is the value of 100%. */
function num(s: string | undefined, scale: number): number | undefined {
  if (s === undefined) return undefined;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] ? (n / 100) * scale : n;
}

function hue(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "deg").toLowerCase();
  const deg =
    unit === "turn"
      ? n * 360
      : unit === "rad"
        ? (n * 180) / Math.PI
        : unit === "grad"
          ? n * 0.9
          : n;
  return ((deg % 360) + 360) % 360;
}

/** Splits `a, b, c` or `a b c / d` into channel strings, alpha last. */
function args(body: string): string[] | undefined {
  const trimmed = body.trim();
  if (trimmed.includes(",")) return trimmed.split(",").map((s) => s.trim());
  const [channels, alpha, extra] = trimmed.split("/");
  if (extra !== undefined || channels === undefined) return undefined;
  const parts = channels.trim().split(/\s+/);
  return alpha === undefined ? parts : [...parts, alpha.trim()];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Parses a CSS colour value; undefined if the whole value isn't one colour. */
export function parseColor(value: string): Rgba | undefined {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return fromHex(v.slice(1));
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED[v];
  if (named) return fromHex(named);
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(v);
  if (!fn) return undefined;
  const parts = args(fn[2] ?? "");
  if (!parts || (parts.length !== 3 && parts.length !== 4)) return undefined;
  const alpha = parts.length === 4 ? num(parts[3], 1) : 1;
  if (alpha === undefined) return undefined;
  if (fn[1]?.startsWith("rgb")) {
    const [r, g, b] = [0, 1, 2].map((i) => num(parts[i], 255));
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r: clamp(r / 255), g: clamp(g / 255), b: clamp(b / 255), a: clamp(alpha) };
  }
  const h = hue(parts[0]);
  const s = num(parts[1], 1);
  const l = num(parts[2], 1);
  if (h === undefined || s === undefined || l === undefined) return undefined;
  const [r, g, b] = hslToRgb(h, clamp(s), clamp(l));
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: clamp(alpha) };
}

/** `#rrggbb` when opaque, else `rgba(r, g, b, a)`: formats VS Code renders as a swatch. */
export function formatColor(c: Rgba): string {
  if (c.a >= 1) {
    return `#${[c.r, c.g, c.b].map((n) => byte(n).toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${byte(c.r)}, ${byte(c.g)}, ${byte(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}
