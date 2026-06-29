import express, { Request, Response } from "express";
import { krovakToWgs84 } from "../bim-components/GISMap/krovak.js";
import fs from "fs";
import path from "path";

const router = express.Router();

function lonLatToTile(lon: number, lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function tileToLonLat(x: number, y: number, z: number) {
  const n = Math.pow(2, z);
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

router.post("/api/download-map-tiles", async (req: Request, res: Response): Promise<any> => {
  const { eastings, northings, zoom, gridSize } = req.body;

  if (eastings === undefined || northings === undefined) {
    return res.status(400).json({ error: "Missing eastings or northings in request body." });
  }

  try {
    const east = Number(eastings);
    const north = Number(northings);

    // Convert EPSG:5514 coordinates to WGS84
    const [lon, lat] = krovakToWgs84(east, north);
    console.log(`[Backend TileDownloader] Input EPSG:5514: [${east}, ${north}] -> WGS84: [${lon}, ${lat}]`);

    const z = Number(zoom ?? 17);
    const gSize = Number(gridSize ?? 3);
    console.log(`[Backend TileDownloader] Target Grid: Zoom=${z}, GridSize=${gSize}x${gSize}`);

    // Compute Slippy Map index of the center tile at the requested zoom level
    const centerTile = lonLatToTile(lon, lat, z);

    // Determine coordinate bounding box for the requested grid
    const halfGrid = Math.floor(gSize / 2);
    const tlTile = { x: centerTile.x - halfGrid, y: centerTile.y - halfGrid };
    const brTile = { x: centerTile.x + halfGrid + 1, y: centerTile.y + halfGrid + 1 }; // +1 to cover full tile space

    const tlCoords = tileToLonLat(tlTile.x, tlTile.y, z);
    const brCoords = tileToLonLat(brTile.x, brTile.y, z);

    const minLat = Math.min(tlCoords.lat, brCoords.lat);
    const maxLat = Math.max(tlCoords.lat, brCoords.lat);
    const minLon = Math.min(tlCoords.lon, brCoords.lon);
    const maxLon = Math.max(tlCoords.lon, brCoords.lon);

    // Calculate dynamic zoom levels based on user request (e.g. z-1, z, z+1 bounded by 12~19)
    const zoomLevels = [z - 1, z, z + 1].filter(v => v >= 12 && v <= 19);
    const outputDir = path.resolve(process.cwd(), "public/map-tiles");

    // Send immediate response to avoid pending requests
    res.json({
      success: true,
      message: `Tile download started in the background for Zoom ${z-1}~${z+1}.`
    });

    // Run actual downloading process in the background
    (async () => {
      let downloadedCount = 0;
      let skippedCount = 0;

      for (const zoomVal of zoomLevels) {
        const tileMin = lonLatToTile(minLon, maxLat, zoomVal);
        const tileMax = lonLatToTile(maxLon, minLat, zoomVal);

        const xMin = Math.min(tileMin.x, tileMax.x);
        const xMax = Math.max(tileMin.x, tileMax.x);
        const yMin = Math.min(tileMin.y, tileMax.y);
        const yMax = Math.max(tileMin.y, tileMax.y);

        const totalTiles = (xMax - xMin + 1) * (yMax - yMin + 1);

        if (totalTiles > 120) {
          console.warn(`[Backend TileDownloader] Skipped Zoom ${zoomVal} because tile count (${totalTiles}) exceeds 120.`);
          continue;
        }

        console.log(`[Backend TileDownloader] Processing Zoom ${zoomVal}: download range X[${xMin}~${xMax}], Y[${yMin}~${yMax}] (${totalTiles} tiles)`);

        for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) {
            const url = `https://basemaps.cartocdn.com/rastertiles/light_all/${zoomVal}/${x}/${y}.png`;
            const destFolder = path.join(outputDir, String(zoomVal), String(x));
            const destFile = path.join(destFolder, `${y}.png`);

            if (fs.existsSync(destFile)) {
              skippedCount++;
              continue;
            }

            fs.mkdirSync(destFolder, { recursive: true });

            try {
              const fetchResponse = await fetch(url, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                  "Referer": "https://github.com/CartoDB/basemap-styles"
                }
              });

              if (!fetchResponse.ok) {
                throw new Error(`HTTP error! status: ${fetchResponse.status}`);
              }

              const arrayBuffer = await fetchResponse.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              fs.writeFileSync(destFile, buffer);
              downloadedCount++;

              // Delay between requests
              await new Promise((resolve) => setTimeout(resolve, 80));
            } catch (err: any) {
              console.error(`[Backend TileDownloader] Failed to fetch tile ${zoomVal}/${x}/${y}:`, err.message);
            }
          }
        }
      }

      console.log(`[Backend TileDownloader] Background download finished. Downloaded: ${downloadedCount}, Skipped: ${skippedCount}`);
    })().catch(err => {
      console.error("[Backend TileDownloader] Background download error:", err);
    });

  } catch (err: any) {
    console.error("[Backend TileDownloader] Error starting download:", err);
    // Since we might have already responded, we only send 500 if headers aren't sent
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to start tile download.", details: err.message });
    }
  }
});

export default router;
