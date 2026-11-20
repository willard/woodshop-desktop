/**
 * Renders the assembly video: the design drawn frame by frame in its own WebGL canvas, captioned
 * on a 2D canvas, encoded to H.264 with WebCodecs and wrapped as an MP4 (`mp4-muxer`).
 *
 * Frames are drawn and encoded one at a time, not recorded as they play, so the video comes out
 * smooth at its full frame rate however busy the design and however slow the machine, and the
 * same MP4 on every system that has an H.264 encoder (WebView2 on Windows, WebKit on macOS).
 * The scene is lit like the editor's (see `EditorEngine.addLighting`).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Spec } from '@/spec';
import { assemblyOrder } from '@/cutlist';
import { buildSpecGroup } from '@/engine/buildScene';
import { createGrainTexture, woodMaterialProvider } from '@/engine/materials';
import { explodedPositions } from '@/engine/explode';
import { isSoftwareRenderer } from '@/engine/EditorEngine';
import { scenePalette, type ThemeName } from '@/engine/theme';
import { frameCount, planFilm, poseAt, type Caption, type FilmPlan } from './timeline';

export const FILM_FPS = 30;

export interface FilmOptions {
    width: number;
    height: number;
    seconds: number;
    theme: ThemeName;
    /** The design's name, on the opening and closing cards. */
    title: string;
    /** Under the title: the overall size. */
    subtitle: string;
    /** Called with the share done, 0 to 1. */
    onProgress?: (done: number) => void;
    signal?: AbortSignal;
}

/** H.264 in the profiles a phone and every social site play, best first. Level 4.0 covers 1080p30. */
const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];

/** The first H.264 configuration this system can encode at `width` × `height`, or null. */
export async function videoConfig(width: number, height: number): Promise<VideoEncoderConfig | null> {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const codec of CODECS) {
        const config: VideoEncoderConfig = {
            codec,
            width,
            height,
            bitrate: Math.round(width * height * FILM_FPS * 0.12),
            framerate: FILM_FPS,
            avc: { format: 'avc' },
        };
        try {
            const support = await VideoEncoder.isConfigSupported(config);
            if (support.supported === true) return config;
        } catch {
            // An unknown codec string throws on some engines: try the next.
        }
    }
    return null;
}

/** The finished MP4, as bytes. Throws `AbortError` when `signal` aborts. */
export async function renderAssemblyFilm(spec: Spec, options: FilmOptions): Promise<Uint8Array> {
    const { width, height } = options;
    const config = await videoConfig(width, height);
    if (config === null) {
        throw new Error('This computer cannot encode H.264 video here.');
    }
    const plan = planFilm(assemblyOrder(spec), options.seconds);
    const stage = new FilmStage(spec, width, height, options.theme);
    const card = new CaptionCard(width, height, options.theme, options.title, options.subtitle);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
        target,
        video: { codec: 'avc', width, height, frameRate: FILM_FPS },
        fastStart: 'in-memory',
    });
    let failure: unknown = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
            failure = e;
        },
    });
    encoder.configure(config);

    try {
        const frames = frameCount(plan, FILM_FPS);
        for (let i = 0; i < frames; i++) {
            if (options.signal?.aborted === true) throw new DOMException('Cancelled', 'AbortError');
            if (failure !== null) throw failure;
            const t = i / FILM_FPS;
            const pose = poseAt(plan, t);
            stage.draw(pose);
            card.compose(stage.canvas, pose.caption, t, plan);
            const frame = new VideoFrame(card.canvas, {
                timestamp: Math.round((i * 1_000_000) / FILM_FPS),
                duration: Math.round(1_000_000 / FILM_FPS),
            });
            encoder.encode(frame, { keyFrame: i % (FILM_FPS * 2) === 0 });
            frame.close();
            // Let the encoder catch up rather than queue the whole film in memory.
            while (encoder.encodeQueueSize > 8) {
                await new Promise((resolve) => setTimeout(resolve, 4));
            }
            if (i % 5 === 0) {
                options.onProgress?.(i / frames);
                // Give the page a moment to paint the progress.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
        await encoder.flush();
        if (failure !== null) throw failure;
        muxer.finalize();
        options.onProgress?.(1);
        return new Uint8Array(target.buffer);
    } finally {
        if (encoder.state !== 'closed') encoder.close();
        stage.dispose();
    }
}

interface Band {
    /** Half-width the piece may take, and the top and bottom it must stay between (NDC). */
    x: number;
    top: number;
    bottom: number;
}

/** The clear part of the frame: below the title card, or above the step caption. */
function safeBand(width: number, height: number, clear: 'title' | 'caption'): Band {
    const tall = height > width;
    const unit = Math.min(width, height) / 1080;
    const edge = 0.06;
    if (clear === 'title') {
        const title = (tall ? 0.14 : 0.12) + (110 * unit) / height;
        return { x: 0.88, top: 1 - 2 * title, bottom: -1 + 2 * edge };
    }
    // The caption box is about 270 px on a 1080 short side, plus its gap to the bottom edge.
    const caption = (270 * unit) / height + (tall ? 0.09 : 0.05);
    return { x: 0.88, top: 1 - 2 * edge, bottom: -1 + 2 * caption };
}

/** The 3D half: the design, lit, with a camera that circles it. */
class FilmStage {
    readonly canvas: HTMLCanvasElement;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera: THREE.PerspectiveCamera;
    private readonly parts: THREE.Group;
    /** Each part's place, and where it flies in from. */
    private readonly paths = new Map<
        string,
        { home: THREE.Vector3; from: THREE.Vector3; exploded: THREE.Vector3 }
    >();
    private readonly centre: THREE.Vector3;
    private readonly box: THREE.Box3;
    /**
     * The camera's distance, and how far the picture moves up to centre the piece in the clear
     * band (NDC): clear of the title card, then clear of the step captions.
     */
    private readonly fits: { distance: number; shift: number }[];
    private readonly grain: THREE.Texture | null;

    constructor(spec: Spec, width: number, height: number, theme: ThemeName) {
        const palette = scenePalette(theme);
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            preserveDrawingBuffer: true,
        });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(width, height, false);
        const rich = !isSoftwareRenderer(this.renderer);
        this.renderer.shadowMap.enabled = rich;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.scene.background = new THREE.Color(palette.background);

        const light = palette.lighting;
        if (rich) {
            const pmrem = new THREE.PMREMGenerator(this.renderer);
            this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            pmrem.dispose();
            this.scene.environmentIntensity = light.environmentIntensity;
        }
        this.scene.add(
            new THREE.HemisphereLight(
                light.hemiSky,
                light.hemiGround,
                rich ? light.hemiIntensity : light.hemiIntensity + light.environmentIntensity,
            ),
        );
        const fill = new THREE.DirectionalLight(light.fillColor, light.fillIntensity);
        fill.position.set(-50, 30, -40);
        this.scene.add(fill);

        this.grain = createGrainTexture();
        this.parts = buildSpecGroup(spec, woodMaterialProvider(this.grain));
        this.scene.add(this.parts);

        const box = new THREE.Box3().setFromObject(this.parts);
        this.centre = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 6);

        const key = new THREE.DirectionalLight(light.keyColor, light.keyIntensity);
        const towardKey = new THREE.Vector3(60, 90, 40).normalize();
        key.position.copy(this.centre).addScaledVector(towardKey, radius * 3);
        key.target.position.copy(this.centre);
        key.castShadow = rich;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.radius = 4;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.04;
        const shadowCam = key.shadow.camera;
        shadowCam.left = shadowCam.bottom = -radius * 2.2;
        shadowCam.right = shadowCam.top = radius * 2.2;
        shadowCam.near = radius * 0.5;
        shadowCam.far = radius * 6;
        this.scene.add(key, key.target);

        if (rich) {
            const floor = new THREE.Mesh(
                new THREE.PlaneGeometry(2000, 2000),
                new THREE.ShadowMaterial({ opacity: light.shadowOpacity }),
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = 0.01;
            floor.receiveShadow = true;
            this.scene.add(floor);
        }
        const grid = new THREE.GridHelper(480, 80, palette.gridMajor, palette.gridMinor);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.35;
        this.scene.add(grid);

        // Parts fly in along the same line the exploded view pushes them out on, and from above.
        const exploded = explodedPositions(
            spec.parts.map((p) => ({ id: p.id, pos: p.transform.pos as [number, number, number] })),
            1,
        );
        const lift = radius * 0.9;
        for (const child of this.parts.children) {
            const home = child.position.clone();
            const out = exploded.get(child.name);
            const away = out === undefined ? new THREE.Vector3() : new THREE.Vector3(...out).sub(home);
            if (away.lengthSq() < 1e-6) away.set(0, 1, 0);
            const from = home
                .clone()
                .addScaledVector(away.normalize(), radius * 0.6)
                .add(new THREE.Vector3(0, lift, 0));
            this.paths.set(child.name, {
                home,
                from,
                exploded: out === undefined ? home.clone() : new THREE.Vector3(...out),
            });
        }

        // Back far enough that the piece stays between the title and the caption all the way round,
        // then shift the picture so it sits in the middle of that band.
        this.camera = new THREE.PerspectiveCamera(35, width / height, 0.5, 8000);
        this.box = box;
        this.fits = (['title', 'caption'] as const).map((clear) => {
            const band = safeBand(width, height, clear);
            const distance = this.fitDistance(radius, band);
            return { distance, shift: this.bandShift(distance, band) };
        });
    }

    /** Three-quarter view from above the front-right, turned `orbit` degrees to the left. */
    private aim(orbit: number, distance: number): void {
        const angle = THREE.MathUtils.degToRad(35 - orbit);
        const up = THREE.MathUtils.degToRad(24);
        this.camera.position.set(
            this.centre.x + distance * Math.cos(up) * Math.sin(angle),
            this.centre.y + distance * Math.sin(up),
            this.centre.z + distance * Math.cos(up) * Math.cos(angle),
        );
        this.camera.lookAt(this.centre);
        this.camera.updateMatrixWorld();
    }

    /** The piece's on-screen extent (NDC) over the camera's whole path at `distance`. */
    private extent(distance: number): { x: number; yMin: number; yMax: number } {
        const out = { x: 0, yMin: Infinity, yMax: -Infinity };
        const corner = new THREE.Vector3();
        for (const orbit of [0, 20, 40, 60, 80, 100, 110]) {
            this.aim(orbit, distance);
            for (let k = 0; k < 8; k++) {
                corner
                    .set(
                        k & 1 ? this.box.max.x : this.box.min.x,
                        k & 2 ? this.box.max.y : this.box.min.y,
                        k & 4 ? this.box.max.z : this.box.min.z,
                    )
                    .project(this.camera);
                out.x = Math.max(out.x, Math.abs(corner.x));
                out.yMin = Math.min(out.yMin, corner.y);
                out.yMax = Math.max(out.yMax, corner.y);
            }
        }
        return out;
    }

    private fitDistance(radius: number, band: Band): number {
        const fits = (d: number) => {
            const e = this.extent(d);
            return e.x <= band.x && e.yMax - e.yMin <= band.top - band.bottom;
        };
        let near = radius;
        let far = radius * 40;
        for (let i = 0; i < 30; i++) {
            const mid = (near + far) / 2;
            if (fits(mid)) far = mid;
            else near = mid;
        }
        return far;
    }

    private bandShift(distance: number, band: Band): number {
        const e = this.extent(distance);
        return (band.top + band.bottom) / 2 - (e.yMin + e.yMax) / 2;
    }

    draw(pose: { arrival: Map<string, number>; explode: number; orbit: number; framing: number }): void {
        for (const child of this.parts.children) {
            const path = this.paths.get(child.name);
            if (path === undefined) continue;
            const arrived = pose.arrival.get(child.name) ?? 1;
            child.visible = arrived > 0;
            if (pose.explode > 0) {
                child.position.lerpVectors(path.home, path.exploded, pose.explode);
            } else {
                child.position.lerpVectors(path.from, path.home, arrived);
            }
        }
        const [title, caption] = this.fits;
        const distance = THREE.MathUtils.lerp(title.distance, caption.distance, pose.framing);
        const shift = THREE.MathUtils.lerp(title.shift, caption.shift, pose.framing);
        this.aim(pose.orbit, distance);
        // The view window moves up by half the frame per unit of shift, so the picture moves down.
        const { width, height } = this.canvas;
        this.camera.setViewOffset(width, height, 0, (shift * height) / 2, width, height);
        this.renderer.render(this.scene, this.camera);
    }

    dispose(): void {
        this.parts.traverse((object) => {
            const mesh = object as THREE.Mesh;
            mesh.geometry?.dispose();
            const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
            for (const m of Array.isArray(material) ? material : material ? [material] : []) {
                (m as THREE.MeshStandardMaterial).map?.dispose();
                m.dispose();
            }
        });
        this.grain?.dispose();
        this.scene.environment?.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }
}

/** The 2D half: the 3D frame with its title, step caption or closing card on top. */
class CaptionCard {
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    /** Type scale: 1 on a 1080-pixel short side. */
    private readonly unit: number;
    private readonly ink: string;
    private readonly panel: string;
    private readonly accent = '#d97706';

    constructor(
        private readonly width: number,
        private readonly height: number,
        theme: ThemeName,
        private readonly title: string,
        private readonly subtitle: string,
    ) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d')!;
        this.unit = Math.min(width, height) / 1080;
        this.ink = theme === 'dark' ? '#f5f0e8' : '#1c1917';
        this.panel = theme === 'dark' ? 'rgba(12, 10, 9, 0.78)' : 'rgba(255, 252, 247, 0.9)';
    }

    compose(scene: HTMLCanvasElement, caption: Caption, t: number, plan: FilmPlan): void {
        const { ctx, unit } = this;
        ctx.drawImage(scene, 0, 0);
        const font = '-apple-system, "Segoe UI", system-ui, Roboto, Helvetica, Arial, sans-serif';
        ctx.textBaseline = 'alphabetic';
        if (caption.kind === 'title' || caption.kind === 'end') {
            // The title is there from the first frame (a site's preview picture) and fades as the
            // build starts; the closing card fades in and stays.
            const alpha = caption.kind === 'title' ? (plan.intro - t) / 0.4 : (t - plan.finale) / 0.4;
            ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
            ctx.textAlign = 'center';
            const top = this.height * (this.height > this.width ? 0.14 : 0.12);
            ctx.fillStyle = this.ink;
            ctx.font = `700 ${Math.round(68 * unit)}px ${font}`;
            const titleLines = this.wrap(this.title, this.width / 2, top, this.width * 0.86, 78 * unit, 2);
            ctx.font = `500 ${Math.round(36 * unit)}px ${font}`;
            ctx.fillStyle = this.accent;
            const second = caption.kind === 'title' ? this.subtitle : 'Made with Woodshop';
            ctx.fillText(second, this.width / 2, top + (titleLines - 1) * 78 * unit + 64 * unit);
            ctx.globalAlpha = 1;
            return;
        }

        const { step } = caption;
        const pad = 36 * unit;
        const boxWidth = Math.min(this.width - 2 * pad, 980 * unit);
        const x = (this.width - boxWidth) / 2;
        ctx.textAlign = 'left';
        ctx.font = `700 ${Math.round(46 * unit)}px ${font}`;
        const headingLines = this.lines(step.heading, boxWidth - 2 * pad, 2);
        ctx.font = `400 ${Math.round(32 * unit)}px ${font}`;
        const detailLines = step.detail === null ? [] : this.lines(step.detail, boxWidth - 2 * pad, 2);
        const boxHeight =
            pad * 2 + 30 * unit + headingLines.length * 56 * unit + detailLines.length * 42 * unit + 8 * unit;
        const y = this.height - boxHeight - this.height * (this.height > this.width ? 0.09 : 0.05);

        ctx.globalAlpha = Math.min(1, (t - plan.intro) / 0.3);
        ctx.fillStyle = this.panel;
        ctx.beginPath();
        ctx.roundRect(x, y, boxWidth, boxHeight, 28 * unit);
        ctx.fill();

        let line = y + pad + 26 * unit;
        ctx.fillStyle = this.accent;
        ctx.font = `700 ${Math.round(26 * unit)}px ${font}`;
        ctx.fillText(step.counter.toUpperCase(), x + pad, line);
        line += 14 * unit;
        ctx.fillStyle = this.ink;
        ctx.font = `700 ${Math.round(46 * unit)}px ${font}`;
        for (const text of headingLines) {
            line += 56 * unit;
            ctx.fillText(text, x + pad, line);
        }
        ctx.font = `400 ${Math.round(32 * unit)}px ${font}`;
        ctx.globalAlpha *= 0.8;
        for (const text of detailLines) {
            line += 42 * unit;
            ctx.fillText(text, x + pad, line);
        }
        ctx.globalAlpha = 1;
    }

    /** Breaks `text` into at most `max` lines that fit `width` in the current font. */
    private lines(text: string, width: number, max: number): string[] {
        const words = text.split(/\s+/);
        const out: string[] = [];
        let current = '';
        for (const word of words) {
            const next = current === '' ? word : `${current} ${word}`;
            if (this.ctx.measureText(next).width > width && current !== '') {
                out.push(current);
                current = word;
            } else {
                current = next;
            }
        }
        if (current !== '') out.push(current);
        if (out.length > max) {
            const kept = out.slice(0, max);
            kept[max - 1] = `${kept[max - 1]}…`;
            return kept;
        }
        return out;
    }

    /** Draws `text` wrapped, centred on `x`; returns how many lines it took. */
    private wrap(text: string, x: number, y: number, width: number, leading: number, max: number): number {
        const lines = this.lines(text, width, max);
        lines.forEach((l, i) => this.ctx.fillText(l, x, y + i * leading));
        return lines.length;
    }
}
