import JSZip from 'jszip';

export const STARFIELD_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'];
export const STARFIELD_ACCEPT = `.zip,${STARFIELD_EXTENSIONS.map((extension) => `.${extension}`).join(',')}`;

export type StarfieldEntry = {
  id: string;
  path: string;
  name: string;
  size: number;
  blob: Blob;
};

export type StarfieldOutput = {
  direction: 'Down' | 'Top' | 'Right' | 'Front' | 'Left' | 'Back';
  name: string;
  blob: Blob;
  width: number;
  height: number;
};

const WORLD0_PATHS = [
  'assets/minecraft/mcpatcher/sky/world0/',
  'assets/minecraft/optifine/sky/world0/',
];

export function starfieldExtension(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

export function isStarfieldImage(name: string) {
  return STARFIELD_EXTENSIONS.includes(starfieldExtension(name));
}

function normalizedPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isDetectedPath(path: string) {
  return WORLD0_PATHS.some((base) => path.startsWith(base)) || !path.includes('/');
}

export async function inspectStarfieldZip(file: File) {
  const zip = await JSZip.loadAsync(file);
  const entries: StarfieldEntry[] = [];
  const seen = new Set<string>();

  for (const zipEntry of Object.values(zip.files)) {
    const path = normalizedPath(zipEntry.name);
    if (zipEntry.dir || !isStarfieldImage(path) || !isDetectedPath(path) || seen.has(path)) continue;
    const blob = await zipEntry.async('blob');
    seen.add(path);
    entries.push({
      id: `starfield-${path}-${blob.size}`,
      path,
      name: path.split('/').pop() ?? path,
      size: blob.size,
      blob,
    });
  }

  return { zip, entries };
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected image could not be decoded by this browser.'));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode a PNG from this image.'));
    }, 'image/png');
  });
}

/**
 * Starfield slicing logic adapted from MellowSkyConverter by Misumeh, MIT License.
 * The source panorama is a 3 × 2 grid; the two upper-left cells are flipped 180°.
 */
export async function sliceStarfield(blob: Blob): Promise<StarfieldOutput[]> {
  const image = await loadImage(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('The selected image has no readable dimensions.');
  if (width / height !== 3 / 2) {
    throw new Error(`Source must be a 3:2 panorama. Found ${width} × ${height}.`);
  }

  const cellWidth = width / 3;
  const cellHeight = height / 2;
  const directions: StarfieldOutput['direction'][] = ['Down', 'Top', 'Right', 'Front', 'Left', 'Back'];
  const outputs: StarfieldOutput[] = [];

  for (let index = 0; index < 6; index += 1) {
    const x = index % 3;
    const y = Math.floor(index / 3);
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth;
    canvas.height = cellHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a canvas for conversion.');

    if ((x === 0 && y === 0) || (x === 1 && y === 0)) {
      context.translate(cellWidth, cellHeight);
      context.rotate(Math.PI);
    }
    context.drawImage(image, x * cellWidth, y * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
    outputs.push({
      direction: directions[index],
      name: `${directions[index]}.png`,
      blob: await canvasBlob(canvas),
      width: cellWidth,
      height: cellHeight,
    });
  }
  return outputs;
}