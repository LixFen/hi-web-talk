import fs from "fs";
import path from "path";

const fontsPath = "node_modules/@prinsss/dvi2html/lib/tfm/fonts.json";
const FONT_SIZES = [5, 6, 7, 8, 9, 10, 12, 17];

const FONT_FAMILIES = [
  ["cmr", "cmr"],       // Computer Modern Roman
  ["cmmi", "cmmi"],     // Computer Modern Math Italic
  ["cmmib", "cmmib"],   // Computer Modern Math Bold Italic
  ["cmb", "cmb"],       // Computer Modern Bold
  ["cmbx", "cmbx"],     // Computer Modern Bold Extended
  ["cmss", "cmss"],     // Computer Modern Sans Serif
  ["cmssi", "cmssi"],   // Computer Modern Sans Serif Italic
  ["cmssbx", "cmssbx"], // Computer Modern Sans Serif Bold Extended
  ["cmtt", "cmtt"],     // Computer Modern Typewriter
  ["cmsl", "cmsl"],     // Computer Modern Slanted
  ["cmti", "cmti"],     // Computer Modern Text Italic
  ["cmsy", "cmsy"],     // Computer Modern Math Symbols
  ["cmex", "cmex"],     // Computer Modern Math Extension
  ["cmbsy", "cmbsy"],   // Computer Modern Bold Math Symbols
  ["msam", "msam"],     // AMS Math A
  ["msbm", "msbm"],     // AMS Math B
  ["eurm", "eurm"],     // Euler Roman
  ["eurb", "eurb"],     // Euler Bold
  ["eusm", "eusm"],     // Euler Script Medium
  ["eusb", "eusb"],     // Euler Script Bold
];

function parseFamily(fontName) {
  for (const [family] of FONT_FAMILIES) {
    const match = fontName.match(new RegExp(`^${family}(\\d+)$`));
    if (match) return { family, size: parseInt(match[1], 10) };
  }
  return null;
}

function parseFontName(fontName) {
  for (const [prefix] of FONT_FAMILIES) {
    if (fontName.startsWith(prefix)) {
      const suffix = fontName.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        return { prefix, size: parseInt(suffix, 10) };
      }
    }
  }
  return null;
}

function closestSize(available, target) {
  return available.reduce((prev, curr) =>
    Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev
  );
}

const data = fs.readFileSync(fontsPath, "utf8");
const j = JSON.parse(data);
const added = [];

// Build index: for each font family, track available sizes
const fontMap = {};
for (const key of Object.keys(j)) {
  const info = parseFontName(key);
  if (info) {
    if (!fontMap[info.prefix]) fontMap[info.prefix] = new Set();
    fontMap[info.prefix].add(info.size);
  }
}

// Fill missing sizes for each family using data from nearest available size
for (const [prefix] of FONT_FAMILIES) {
  if (!fontMap[prefix]) continue;
  const available = [...fontMap[prefix]].sort((a, b) => a - b);
  for (const size of FONT_SIZES) {
    const name = `${prefix}${size}`;
    if (j[name]) continue;
    const nearest = closestSize(available, size);
    const srcName = `${prefix}${nearest}`;
    if (j[srcName]) {
      j[name] = j[srcName];
      added.push(`${name} <- ${srcName}`);
    }
  }
}

fs.writeFileSync(fontsPath, JSON.stringify(j));
console.log(`Total fonts: ${Object.keys(j).length}`);
console.log(`Added: ${added.length} fonts`);
for (const a of added) {
  console.log(`  ${a}`);
}
