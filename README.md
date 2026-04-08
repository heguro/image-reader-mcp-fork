# Image Reader MCP Server

A simple MCP server built with FastMCP that provides tools to:

- List image files in a specified directory.
- Get the size of an image.
- Read a specific image file and return its content.


## Tools

This server provides the following tools:

### `list_images`

*   **Description:** List image files in a specified directory.
*   **Parameters:**
    *   `directoryPath` (string): The absolute path to the directory to scan for images.
*   **Returns:** A list of image filenames found in the directory or a message indicating no images were found.
*   **Supported Extensions:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`, `.svg`

### `read_image`

*   **Description:** Reads a specific image file and returns its content as base64. Optional crop parameters support `px` or `%` values, and the result can be resized automatically using environment variables.
*   **Parameters:**
    *   `filePath` (string): The absolute path to the image file to read.
  *   `x` (string | number, optional): Crop left offset, for example `120px` or `12.5%`.
  *   `y` (string | number, optional): Crop top offset, for example `80px` or `10%`.
  *   `width` (string | number, optional): Crop width, for example `640px` or `50%`.
  *   `height` (string | number, optional): Crop height, for example `480px` or `50%`.
*   **Returns:** An object containing the image content suitable for display (using `imageContent` helper from `fastmcp`).
*   **Supported Extensions:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`, `.svg`

### `get_image_size`

*   **Description:** Get the dimensions of an image file.
*   **Parameters:**
  *   `filePath` (string): The absolute path to the image file to inspect.
*   **Returns:** A JSON string containing `width` and `height`.

### Environment Variables

*   `IMAGE_READER_MAX_WIDTH`: Optional maximum output width in pixels. Images wider than this are resized with Sharp.
*   `IMAGE_READER_MAX_HEIGHT`: Optional maximum output height in pixels. Images taller than this are resized with Sharp.

### Setup

To configure an MCP client, add the `imageReader` entry to the `mcpServers` object. It should look something like this:

```json
{
  "mcpServers": {
    // ... other servers might be here ...
    "imageReader": {
      "command": "npx",
      "args": ["image-reader-mcp"],
      "env": {}
    }
  }
}
```

**Important Note:** When using this server with Cursor, it currently seems to function only when Claude Sonnet is selected (other models don't seem to have vision enabled).
