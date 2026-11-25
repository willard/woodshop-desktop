#!/usr/bin/env node
/**
 * Cuts the promo video together from what `record.ts` left in out/: each shot of `script.json`
 * made into a 1080 × 1920 clip with its caption, then the clips crossfaded into
 * out/woodshop-promo.mp4 (H.264, 30 fps, silent: add music where you post it). Needs ffmpeg.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const script = JSON.parse(readFileSync(new URL('./script.json', import.meta.url), 'utf8'));
const { width: W, height: H, fade } = script;
const FPS = 30;
/** The films' dark background, so a film set under its caption has no edge. */
const BG = '0x191716';
/** Where a recorded app scene sits: full width, under the caption, and no taller than this. */
const CLIP_TOP = 480;
const CLIP_MAX = H - CLIP_TOP;
/** The recordings are at twice the app's CSS pixels. */
const SCALE = 2;

function ffmpeg(args) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** The `crop=` filter for a shot's [x, y, width, height], checked to fit under the caption. */
function crop(box) {
    if (!box) return '';
    const [x, y, w, h] = box.map((v) => v * SCALE);
    if ((h * W) / w > CLIP_MAX + 1)
        throw new Error(`Crop ${box} is too tall: keep height under ${(box[2] * CLIP_MAX) / W}`);
    return `crop=${w}:${h}:${x}:${y},`;
}

const encode = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

/** Each shot as its own clip, `fade` longer than its share so neighbours can overlap. */
const clips = script.shots.map((shot, i) => {
    const file = `${OUT}shot-${i}.mp4`;
    const seconds = shot.seconds + (i < script.shots.length - 1 ? fade : 0);
    const caption = `${OUT}caption-${i}.png`;
    const inputs = [];
    let graph;
    if (shot.source === 'end') {
        inputs.push('-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${seconds}`);
        inputs.push('-loop', '1', '-t', String(seconds), '-i', `${OUT}end.png`);
        graph = `[1]format=rgba,fade=in:st=0.15:d=0.5:alpha=1[e];[0][e]overlay=0:0[v]`;
    } else if (shot.source.startsWith('film-')) {
        const speed = shot.speed ?? 1;
        inputs.push('-ss', String(shot.from ?? 0), '-i', `${OUT}${shot.source}.mp4`);
        const timed = `setpts=PTS/${speed},fps=${FPS},tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds}`;
        if (shot.inset) {
            // Smaller, under the caption, so parts flying in from above stay clear of it.
            const w = Math.round((CLIP_MAX * W) / H / 2) * 2;
            graph = `[0]${timed},scale=${w}:${CLIP_MAX},pad=${W}:${H}:${(W - w) / 2}:${CLIP_TOP}:color=${BG}[v0]`;
        } else {
            graph = `[0]${timed},scale=${W}:${H}[v0]`;
        }
    } else {
        const dir = `${OUT}${shot.source}/`;
        if (!existsSync(`${dir}frames.txt`))
            throw new Error(`No recording for ${shot.source}: run record.ts`);
        inputs.push('-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${seconds}`);
        inputs.push('-f', 'concat', '-safe', '0', '-i', `${dir}frames.txt`);
        graph =
            `[1]fps=${FPS},trim=start=${shot.from ?? 0},setpts=PTS-STARTPTS,` +
            `tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},` +
            `${crop(shot.crop)}scale=${W}:-2:flags=lanczos[app];[0][app]overlay=0:${CLIP_TOP}:shortest=1[v0]`;
    }
    if (!shot.title && shot.source !== 'end') graph = graph.replace(/\[v0\]$/, '[v]');
    if (shot.title) {
        inputs.push('-loop', '1', '-t', String(seconds), '-i', caption);
        const n = inputs.filter((a) => a === '-i').length - 1;
        // The caption rises in a little after the cut.
        graph +=
            `;[${n}]format=rgba,fade=in:st=0.1:d=0.35:alpha=1[c]` +
            `;[v0][c]overlay=x=0:y='max(0,30-120*t)':shortest=1[v]`;
    }
    ffmpeg([...inputs, '-filter_complex', graph, '-map', '[v]', '-t', String(seconds), ...encode, file]);
    return { file, seconds };
});

// Crossfade the clips one into the next.
const inputs = clips.flatMap((c) => ['-i', c.file]);
let graph = '';
let last = '[0]';
let offset = 0;
for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].seconds - fade;
    const out = i === clips.length - 1 ? '[v]' : `[x${i}]`;
    graph += `${last}[${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${out};`;
    last = out;
}
const final = `${OUT}woodshop-promo.mp4`;
ffmpeg([
    ...inputs,
    '-filter_complex',
    graph.slice(0, -1),
    '-map',
    '[v]',
    ...encode,
    '-movflags',
    '+faststart',
    final,
]);
console.log(`Saved ${final}`);
