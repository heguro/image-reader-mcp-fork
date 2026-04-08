import { FastMCP, imageContent, UserError } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';

const server = new FastMCP({
  name: 'Image Reader Server',
  version: '1.0.0',
});

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);
const cropValueSchema = z.union([z.number(), z.string()]);

const maxWidth = parsePositiveIntegerEnv('IMAGE_READER_MAX_WIDTH');
const maxHeight = parsePositiveIntegerEnv('IMAGE_READER_MAX_HEIGHT');

type CropValue = z.infer<typeof cropValueSchema>;
type CropRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function parsePositiveIntegerEnv(name: string): number | undefined {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue.trim() === '') {
    return undefined;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (parsedValue <= 0) {
    throw new Error(`${name} must be greater than zero.`);
  }

  return parsedValue;
}

function ensureSupportedImage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  if (!imageExtensions.has(extension)) {
    throw new UserError(`Invalid file type. Only the following are supported: ${[...imageExtensions].join(', ')}`);
  }

  return extension;
}

async function readImageMetadata(filePath: string): Promise<Metadata> {
  try {
    return await sharp(filePath, { animated: true }).metadata();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new UserError(`Image file not found: ${filePath}`);
    }
    if (error.code === 'EACCES') {
      throw new UserError(`Permission denied to read file: ${filePath}`);
    }

    console.error('Error reading image metadata:', error);
    throw new UserError(`Failed to read image metadata: ${error.message}`);
  }
}

function getImageDimensions(metadata: Metadata): { height: number; width: number } {
  return {
    width: metadata.autoOrient.width,
    height: metadata.autoOrient.height,
  };
}

function parseCropValue(value: CropValue, basis: number, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new UserError(`${fieldName} must be a finite number.`);
    }

    return value;
  }

  const trimmedValue = value.trim().toLowerCase();
  const percentMatch = trimmedValue.match(/^(\d+(?:\.\d+)?)%$/);

  if (percentMatch) {
    return basis * (Number.parseFloat(percentMatch[1]) / 100);
  }

  const pixelMatch = trimmedValue.match(/^(\d+(?:\.\d+)?)(?:px)?$/);

  if (pixelMatch) {
    return Number.parseFloat(pixelMatch[1]);
  }

  throw new UserError(`${fieldName} must use either px or % values, for example "120px" or "12.5%".`);
}

function resolveCropRegion(
  args: { height?: CropValue; width?: CropValue; x?: CropValue; y?: CropValue },
  imageWidth: number,
  imageHeight: number,
): CropRegion | undefined {
  const hasCropArguments = [args.x, args.y, args.width, args.height].some(value => value !== undefined);

  if (!hasCropArguments) {
    return undefined;
  }

  if ([args.x, args.y, args.width, args.height].some(value => value === undefined)) {
    throw new UserError('Cropping requires x, y, width, and height to all be provided.');
  }

  const left = Math.round(parseCropValue(args.x!, imageWidth, 'x'));
  const top = Math.round(parseCropValue(args.y!, imageHeight, 'y'));
  const width = Math.round(parseCropValue(args.width!, imageWidth, 'width'));
  const height = Math.round(parseCropValue(args.height!, imageHeight, 'height'));

  if (left < 0 || top < 0) {
    throw new UserError('Crop x and y must be zero or greater.');
  }

  if (width <= 0 || height <= 0) {
    throw new UserError('Crop width and height must be greater than zero.');
  }

  if (left >= imageWidth || top >= imageHeight) {
    throw new UserError('Crop x and y must be within the image bounds.');
  }

  // Automatically adjust width and height if they exceed the image bounds
  const adjustedWidth = Math.min(width, imageWidth - left);
  const adjustedHeight = Math.min(height, imageHeight - top);

  return { left, top, width: adjustedWidth, height: adjustedHeight };
}

function needsResize(width: number, height: number): boolean {
  return (maxWidth !== undefined && width > maxWidth) || (maxHeight !== undefined && height > maxHeight);
}

async function transformImage(filePath: string, cropRegion: CropRegion | undefined, resize: boolean): Promise<Buffer> {
  let pipeline = sharp(filePath, { animated: true }).autoOrient();

  if (cropRegion) {
    pipeline = pipeline.extract(cropRegion);
  }

  if (resize) {
    pipeline = pipeline.resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  return pipeline.toBuffer();
}

// Tool to list images in a directory
server.addTool({
  name: 'list_images',
  description: 'List image files in a specified directory.',
  parameters: z.object({
    directoryPath: z.string().describe('The absolute path to the directory to scan for images.'),
  }),
  execute: async (args) => {
    try {
      const entries = await fs.readdir(args.directoryPath, { withFileTypes: true });
      const imageFiles = entries
        .filter(entry => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()))
        .map(entry => entry.name);

      if (imageFiles.length === 0) {
        return 'No image files found in the specified directory.';
      }
      return `Image files found:\n${imageFiles.join('\n')}`;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new UserError(`Directory not found: ${args.directoryPath}`);
      }
      if (error.code === 'EACCES') {
        throw new UserError(`Permission denied to access directory: ${args.directoryPath}`);
      }
      console.error('Error listing images:', error); // Log unexpected errors
      throw new UserError(`Failed to list images in directory: ${error.message}`);
    }
  },
});

server.addTool({
  name: 'get_image_size',
  description: 'Gets the width and height of an original image file.',
  parameters: z.object({
    filePath: z.string().describe('The absolute path to the image file to inspect.'),
  }),
  execute: async (args) => {
    ensureSupportedImage(args.filePath);

    const metadata = await readImageMetadata(args.filePath);
    const { width, height } = getImageDimensions(metadata);

    return JSON.stringify({ width, height });
  },
});

// Tool to read an image file
server.addTool({
  name: 'read_image',
  description: `Returns a specific image content`,
  parameters: z.object({
    filePath: z.string().describe('The absolute path to the image file to read.'),
    x: cropValueSchema.optional().describe('The crop x coordinate in px (number) or % (string like `"50.5%"`)'),
    y: cropValueSchema.optional().describe('The crop y coordinate in px or %'),
    width: cropValueSchema.optional().describe('The crop width in px or %'),
    height: cropValueSchema.optional().describe('The crop height in px or %'),
  }),
  execute: async (args) => {
    ensureSupportedImage(args.filePath);

    try {
      const metadata = await readImageMetadata(args.filePath);
      const { width: sourceWidth, height: sourceHeight } = getImageDimensions(metadata);
      const cropRegion = resolveCropRegion(args, sourceWidth, sourceHeight);
      const outputWidth = cropRegion?.width ?? sourceWidth;
      const outputHeight = cropRegion?.height ?? sourceHeight;
      const resize = needsResize(outputWidth, outputHeight);

      if (!cropRegion && !resize) {
        return imageContent({ path: args.filePath });
      }

      const buffer = await transformImage(args.filePath, cropRegion, resize);
      return imageContent({ buffer });
    } catch (error: any) {
      if (error instanceof UserError) {
        throw error;
      }
      if (error.code === 'ENOENT') {
        throw new UserError(`Image file not found: ${args.filePath}`);
      }
      if (error.code === 'EACCES') {
        throw new UserError(`Permission denied to read file: ${args.filePath}`);
      }
      console.error('Error reading image:', error); // Log unexpected errors
      throw new UserError(`Failed to read image file: ${error.message}`);
    }
  },
});

// Start the server using stdio by default
server.start({
  transportType: 'stdio',
  // To run with SSE, uncomment and configure below:
  // transportType: 'sse',
  // sse: {
  //   endpoint: '/sse',
  //   port: 8081, // Choose an appropriate port
  // },
});

process.stderr.write(`Image Reader MCP Server started.${process.platform === 'win32' ? '\r\n' : '\n'}`);
