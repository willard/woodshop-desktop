import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { isSoftwareRenderer } from '@/engine/EditorEngine';

/** A renderer whose GL context reports `name`, optionally hiding the debug extension. */
function renderer(name: string, hidden = false): THREE.WebGLRenderer {
    const gl = {
        RENDERER: 0x1f01,
        getExtension: () => (hidden ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 }),
        getParameter: (p: number) => (p === 0x9246 ? name : hidden ? 'WebKit WebGL' : 'masked'),
    };
    return { getContext: () => gl } as unknown as THREE.WebGLRenderer;
}

describe('software WebGL detection', () => {
    it.each([
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)',
        'llvmpipe (LLVM 15.0.7, 256 bits)',
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)',
    ])('takes the quick path on %s', (name) => {
        expect(isSoftwareRenderer(renderer(name))).toBe(true);
    });

    it.each(['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)', 'ANGLE (NVIDIA, GeForce RTX 3060)'])(
        'keeps room light and shadows on %s',
        (name) => {
            expect(isSoftwareRenderer(renderer(name))).toBe(false);
        },
    );

    it('assumes a GPU when the browser hides the renderer', () => {
        expect(isSoftwareRenderer(renderer('', true))).toBe(false);
    });
});
