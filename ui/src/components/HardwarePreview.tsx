/**
 * A small still 3D view of one catalog item, so the browser shows what a name means. One
 * renderer per preview, drawn once per item: nothing animates, so nothing keeps running.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { HardwareItem } from '@/hardware/catalog';
import { buildHardwareGeometry } from '@/engine/geometry/hardwareModels';
import { createHardwareMaterial } from '@/engine/geometry/movableHardware';

export function HardwarePreview({ item, className = '' }: { item: HardwareItem | null; className?: string }) {
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const el = canvas.current;
        if (el === null || item === null) return;
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
        } catch {
            return; // no WebGL (a test runner): the list still works without the picture
        }
        const width = el.clientWidth || 240;
        const height = el.clientHeight || 160;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height, false);

        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(2, 3, 4);
        scene.add(key);

        const geometry = buildHardwareGeometry(item.model);
        const material = createHardwareMaterial();
        const piece = new THREE.Mesh(geometry, material);
        // Stand it up as it would sit on a door front: mounting surface behind, facing the viewer.
        scene.add(piece);

        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const centre = box.getCenter(new THREE.Vector3());
        const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.3);

        // A patch of the surface it mounts on, for scale and so "which way is out" is obvious.
        const pad = radius * 1.25;
        const backing = new THREE.Mesh(
            new THREE.PlaneGeometry(pad * 2.4, pad * 2),
            new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9 }),
        );
        backing.position.set(centre.x, centre.y, -0.01);
        scene.add(backing);

        const camera = new THREE.PerspectiveCamera(32, width / height, 0.05, 500);
        const distance = radius / Math.sin((camera.fov * Math.PI) / 360) + radius * 0.2;
        camera.position
            .copy(centre)
            .add(new THREE.Vector3(0.55, -0.45, 0.7).normalize().multiplyScalar(distance));
        camera.up.set(0, 1, 0);
        camera.lookAt(centre);
        renderer.render(scene, camera);

        return () => {
            geometry.dispose();
            material.dispose();
            backing.geometry.dispose();
            (backing.material as THREE.Material).dispose();
            renderer.dispose();
        };
    }, [item]);

    return (
        <canvas
            ref={canvas}
            className={`bg-surface-0 border-fg/8 rounded-lg border ${className}`}
            data-testid="hardware-preview"
            aria-label={item ? `Preview of ${item.name}` : 'No hardware selected'}
        />
    );
}
