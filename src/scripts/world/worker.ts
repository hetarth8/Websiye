/**
 * The city's drawing thread.
 *
 * Every scene's canvas is handed over once (transferControlToOffscreen) and
 * drawn here, on the CPU, so the page thread keeps nothing but scrolling,
 * input and the scheduling decisions in terrain.ts, and the GPU keeps nothing
 * but compositing. Messages are plain data (see scene-renderer.ts):
 *
 *   init   { id, canvas, spec }      a scene arrives
 *   size   { id, w, h }              new bitmap size (0 × 0 releases it)
 *   masks  { id, host, anchors }     clearings to paint
 *   frame  { id, frame }             draw one frame; answered with `drawn`
 *   warm   { zMin, zMax }            build road ahead of need
 *   pixels { id }                    for tests: answered with `pixels`
 *
 * One frame per scene is ever in flight — terrain.ts waits for `drawn` before
 * sending the next — so a slow frame costs the city smoothness, never the page.
 */
import { SceneRenderer, warm, type FrameSpec, type MaskSpec, type ViewSpec } from './scene-renderer';

type Message =
  | { type: 'init'; id: number; canvas: OffscreenCanvas; spec: ViewSpec }
  | { type: 'size'; id: number; w: number; h: number }
  | { type: 'masks'; id: number; host: MaskSpec | null; anchors: MaskSpec[] }
  | { type: 'frame'; id: number; frame: FrameSpec }
  | { type: 'warm'; zMin: number; zMax: number }
  | { type: 'pixels'; id: number };

const scenes = new Map<number, SceneRenderer>();
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Message>) => void) | null;
};

scope.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case 'init':
      try {
        scenes.set(m.id, new SceneRenderer(m.canvas, m.spec, true));
      } catch {
        /* No 2D context here: that scene simply stays empty. */
      }
      break;
    case 'size':
      scenes.get(m.id)?.size(m.w, m.h);
      break;
    case 'masks':
      scenes.get(m.id)?.masks(m.host, m.anchors);
      break;
    case 'frame': {
      const ms = scenes.get(m.id)?.draw(m.frame) ?? 0;
      scope.postMessage({ type: 'drawn', id: m.id, ms });
      break;
    }
    case 'warm':
      warm(m.zMin, m.zMax);
      break;
    case 'pixels': {
      const img = scenes.get(m.id)?.pixels() ?? null;
      scope.postMessage({ type: 'pixels', id: m.id, img }, img ? [img.data.buffer] : []);
      break;
    }
  }
};

scope.postMessage({ type: 'ready' });
