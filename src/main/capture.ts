// One-shot screenshot of a single display, downscaled for the vision model.
// Each capture records exactly which display it came from and the geometry
// needed to map model coordinates back. It never silently captures a
// different screen than the one requested.
import { desktopCapturer, type Display } from 'electron';
import { fitWithin, type Size } from '../shared/geometry';
import { pickSource } from './capture-pick';

/** Claude recommends <= 1568px on the long side; Gemini is happy with that too. */
const MAX_LONG_SIDE = 1568;

export interface CaptureInfo {
  captureId: string;
  takenAt: number;
  displayId: number;
  /** display bounds in desktop DIPs (origin may be negative on multi-monitor setups) */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  /** pixels sent to the model */
  imageSize: Size;
}

export interface Screenshot {
  jpegBase64: string;
  size: Size;
  info: CaptureInfo;
}

let counter = 0;

export async function captureDisplay(display: Display, displayCount: number): Promise<Screenshot> {
  const physical = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const target = fitWithin(physical, MAX_LONG_SIDE);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: target });
  if (sources.length === 0) throw new Error('No screen available to capture. On Windows, check Settings → Privacy → Screen capture.');
  const source = pickSource(sources, display.id, displayCount);
  if (!source) {
    throw new Error("Couldn't match the screen under your cursor to a capture source, so I didn't take a screenshot. Move the mouse to that screen and try again.");
  }
  let img = source.thumbnail;
  if (img.isEmpty()) throw new Error('Screen capture returned an empty image.');
  // thumbnails keep aspect ratio and may come back slightly smaller than requested
  const got = img.getSize();
  if (Math.max(got.width, got.height) > MAX_LONG_SIDE) img = img.resize(fitWithin(got, MAX_LONG_SIDE));
  const s = img.getSize();
  const size = { width: s.width, height: s.height };
  return {
    jpegBase64: img.toJPEG(82).toString('base64'),
    size,
    info: {
      captureId: `cap-${Date.now().toString(36)}-${++counter}`,
      takenAt: Date.now(),
      displayId: display.id,
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
      imageSize: size,
    },
  };
}
